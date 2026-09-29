import { IDB } from '../../shared/constants/index.js';
import { IdbStore, abortError } from '../../shared/utils/index.js';
import type { ILogger } from '../../shared/logger/index.js';
import { toMessage } from '../../shared/errors/index.js';

type PermissionMode = 'read' | 'readwrite';
type PermissionResult = 'granted' | 'denied' | 'prompt';

/** File System Access API members missing from lib.dom. */
export interface PermissionedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?(descriptor: { mode: PermissionMode }): Promise<PermissionResult>;
  requestPermission?(descriptor: { mode: PermissionMode }): Promise<PermissionResult>;
}

export interface DirectoryPickerHost {
  showDirectoryPicker?(options?: {
    id?: string;
    mode?: PermissionMode;
    startIn?: string;
  }): Promise<FileSystemDirectoryHandle>;
}

export interface HandleStore {
  get(key: string): Promise<FileSystemDirectoryHandle | undefined>;
  set(key: string, value: FileSystemDirectoryHandle): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DirectoryWriterOptions {
  readonly host?: DirectoryPickerHost | undefined;
  readonly store?: HandleStore;
  readonly logger?: ILogger;
}

const HANDLE_KEY = 'downloadDirectory';
const MAX_NAME_ATTEMPTS = 100;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { name?: unknown }).name === 'NotFoundError' ||
      (error as { name?: unknown }).name === 'TypeMismatchError')
  );
}

function withSuffix(fileName: string, n: number): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0
    ? `${fileName.slice(0, dot)} (${n})${fileName.slice(dot)}`
    : `${fileName} (${n})`;
}

/**
 * Saves files straight into a user-picked folder via the File System Access
 * API, streaming (never buffering) and creating sub-folders on demand. The
 * handle persists in IndexedDB; permission is re-checked on restore and before
 * each write. Every method degrades to a no-op/`false` when unsupported.
 */
export class DirectoryWriter {
  private handle: PermissionedDirectoryHandle | null = null;
  private readonly host: DirectoryPickerHost | undefined;
  private readonly store: HandleStore;

  constructor(private readonly options: DirectoryWriterOptions = {}) {
    this.host =
      'host' in options
        ? options.host
        : (globalThis as unknown as DirectoryPickerHost | undefined);
    this.store =
      options.store ?? new IdbStore<FileSystemDirectoryHandle>(IDB.stores.handles);
  }

  isSupported(): boolean {
    return typeof this.host?.showDirectoryPicker === 'function';
  }

  hasHandle(): boolean {
    return this.handle !== null;
  }

  get directoryName(): string | undefined {
    return this.handle?.name;
  }

  /** Opens the folder picker; must run inside a user gesture. */
  async pick(): Promise<boolean> {
    const picker = this.host?.showDirectoryPicker;
    if (typeof picker !== 'function') return false;
    try {
      const handle = (await picker.call(this.host, {
        id: 'tgmd-downloads',
        mode: 'readwrite',
      })) as PermissionedDirectoryHandle;
      this.handle = handle;
      await this.store.set(HANDLE_KEY, handle).catch((error: unknown) => {
        this.options.logger?.warn('Could not persist download folder', toMessage(error));
      });
      return true;
    } catch (error) {
      if ((error as { name?: unknown })?.name !== 'AbortError') {
        this.options.logger?.warn('Folder picker failed', toMessage(error));
      }
      return false;
    }
  }

  /**
   * Loads the persisted handle. `requestPermission` only succeeds inside a user
   * gesture, so pass `interactive` from click handlers.
   */
  async restore(interactive = false): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const stored = (await this.store.get(HANDLE_KEY)) as
        | PermissionedDirectoryHandle
        | undefined;
      if (!stored) return false;
      if (await this.ensurePermission(stored, interactive)) {
        this.handle = stored;
        return true;
      }
    } catch (error) {
      this.options.logger?.debug('Folder restore failed', toMessage(error));
    }
    this.handle = null;
    return false;
  }

  async clear(): Promise<void> {
    this.handle = null;
    await this.store.delete(HANDLE_KEY).catch(() => undefined);
  }

  /** True when a folder is set and write permission is currently granted. */
  async isWritable(): Promise<boolean> {
    return this.handle !== null && this.ensurePermission(this.handle, false);
  }

  /**
   * Streams `stream` to `relativePath` (segments already sanitized, `/`
   * separated) below the picked folder. Never overwrites: picks "name (n).ext".
   * On failure or abort the partial file is removed. Returns the saved path.
   */
  async writeStream(
    relativePath: string,
    stream: ReadableStream<Uint8Array>,
    onProgress: (bytesWritten: number) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const root = this.handle;
    if (!root) throw new Error('No download folder selected');
    if (!(await this.ensurePermission(root, false))) {
      throw new Error('Permission to the download folder was revoked');
    }
    if (signal.aborted) throw abortError();

    const segments = relativePath.split('/').filter((s) => s.length > 0);
    const requested = segments.pop();
    if (!requested) throw new Error('Empty file name');

    let dir: FileSystemDirectoryHandle = root;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }
    const fileName = await this.uniqueName(dir, requested);
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    const reader = stream.getReader();
    const onAbort = (): void => void reader.cancel().catch(() => undefined);
    signal.addEventListener('abort', onAbort, { once: true });

    let written = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (signal.aborted) throw abortError();
        if (done) break;
        if (value && value.byteLength > 0) {
          await writable.write(value as Uint8Array<ArrayBuffer>);
          written += value.byteLength;
          onProgress(written);
        }
      }
      await writable.close();
      return [...segments, fileName].join('/');
    } catch (error) {
      await writable.abort().catch(() => undefined);
      await dir.removeEntry(fileName).catch(() => undefined);
      throw signal.aborted ? abortError() : error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        // A cancelled reader may still hold a pending read.
      }
    }
  }

  private async uniqueName(
    dir: FileSystemDirectoryHandle,
    name: string,
  ): Promise<string> {
    for (let n = 0; n < MAX_NAME_ATTEMPTS; n += 1) {
      const candidate = n === 0 ? name : withSuffix(name, n);
      try {
        await dir.getFileHandle(candidate);
      } catch (error) {
        if (isNotFound(error)) return candidate;
        throw error;
      }
    }
    return withSuffix(name, Date.now());
  }

  private async ensurePermission(
    handle: PermissionedDirectoryHandle,
    interactive: boolean,
  ): Promise<boolean> {
    const descriptor = { mode: 'readwrite' as const };
    if (typeof handle.queryPermission !== 'function') return true;
    const state = await handle.queryPermission(descriptor);
    if (state === 'granted') return true;
    if (!interactive || typeof handle.requestPermission !== 'function') return false;
    try {
      return (await handle.requestPermission(descriptor)) === 'granted';
    } catch {
      return false;
    }
  }
}
