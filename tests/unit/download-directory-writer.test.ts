import { describe, it, expect, vi } from 'vitest';
import {
  DirectoryWriter,
  type HandleStore,
} from '../../src/features/download/directory-writer.js';
import { isAbortError } from '../../src/shared/utils/async.js';

class FakeWritable {
  chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;
  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  async abort(): Promise<void> {
    this.aborted = true;
  }
}

class FakeFile {
  writable = new FakeWritable();
  constructor(readonly name: string) {}
  async createWritable(): Promise<FakeWritable> {
    return this.writable;
  }
}

class FakeDir {
  dirs = new Map<string, FakeDir>();
  files = new Map<string, FakeFile>();
  permission: 'granted' | 'prompt' | 'denied' = 'granted';
  requestResult: 'granted' | 'denied' = 'granted';
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    let dir = this.dirs.get(name);
    if (!dir && opts?.create) {
      dir = new FakeDir(name);
      this.dirs.set(name, dir);
    }
    if (!dir) throw new DOMException('missing', 'NotFoundError');
    return dir;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    let file = this.files.get(name);
    if (!file && opts?.create) {
      file = new FakeFile(name);
      this.files.set(name, file);
    }
    if (!file) throw new DOMException('missing', 'NotFoundError');
    return file;
  }
  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
  }
  async queryPermission(): Promise<string> {
    return this.permission;
  }
  async requestPermission(): Promise<string> {
    this.permission = this.requestResult;
    return this.requestResult;
  }
}

class MemoryStore implements HandleStore {
  map = new Map<string, FileSystemDirectoryHandle>();
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, value: FileSystemDirectoryHandle) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts[i++];
      if (part === undefined) controller.close();
      else controller.enqueue(encoder.encode(part));
    },
  });
}

function setup(root = new FakeDir('root')) {
  const store = new MemoryStore();
  const host = {
    showDirectoryPicker: vi.fn(async () => root as unknown as FileSystemDirectoryHandle),
  };
  const writer = new DirectoryWriter({ host, store });
  return { writer, store, host, root };
}

describe('DirectoryWriter', () => {
  it('is unsupported without showDirectoryPicker and degrades gracefully', async () => {
    const writer = new DirectoryWriter({ host: undefined, store: new MemoryStore() });
    expect(writer.isSupported()).toBe(false);
    expect(await writer.pick()).toBe(false);
    expect(await writer.restore()).toBe(false);
    expect(writer.hasHandle()).toBe(false);
    expect(await writer.isWritable()).toBe(false);
    await expect(
      writer.writeStream('a.txt', streamOf('x'), vi.fn(), new AbortController().signal),
    ).rejects.toThrow(/No download folder/);
  });

  it('pick() stores the handle; restore() reloads it', async () => {
    const { writer, store, root } = setup();
    expect(await writer.pick()).toBe(true);
    expect(writer.hasHandle()).toBe(true);
    expect(writer.directoryName).toBe('root');
    expect(store.map.size).toBe(1);

    const again = new DirectoryWriter({
      host: { showDirectoryPicker: vi.fn() },
      store,
    });
    expect(await again.restore()).toBe(true);
    root.permission = 'prompt';
    expect(await again.isWritable()).toBe(false);
  });

  it('restore() only requests permission when interactive', async () => {
    const { writer, store, root } = setup();
    await writer.pick();
    root.permission = 'prompt';
    const restored = new DirectoryWriter({
      host: { showDirectoryPicker: vi.fn() },
      store,
    });
    expect(await restored.restore()).toBe(false);
    expect(await restored.restore(true)).toBe(true);
    root.permission = 'prompt';
    root.requestResult = 'denied';
    expect(await restored.restore(true)).toBe(false);
  });

  it('pick() returns false when the user dismisses the picker', async () => {
    const writer = new DirectoryWriter({
      host: {
        showDirectoryPicker: async () => {
          throw new DOMException('no', 'AbortError');
        },
      },
      store: new MemoryStore(),
    });
    expect(await writer.pick()).toBe(false);
  });

  it('clear() forgets the handle', async () => {
    const { writer, store } = setup();
    await writer.pick();
    await writer.clear();
    expect(writer.hasHandle()).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('streams into nested folders with progress', async () => {
    const { writer, root } = setup();
    await writer.pick();
    const progress = vi.fn();
    const saved = await writer.writeStream(
      'Telegram/Chat/a.txt',
      streamOf('hello', ' world'),
      progress,
      new AbortController().signal,
    );
    expect(saved).toBe('Telegram/Chat/a.txt');
    const file = root.dirs.get('Telegram')!.dirs.get('Chat')!.files.get('a.txt')!;
    expect(file.writable.closed).toBe(true);
    expect(new TextDecoder().decode(file.writable.chunks[0])).toBe('hello');
    expect(progress).toHaveBeenLastCalledWith(11);
  });

  it('never overwrites an existing file', async () => {
    const { writer, root } = setup();
    await writer.pick();
    await root.getFileHandle('a.txt', { create: true });
    await root.getFileHandle('a (1).txt', { create: true });
    const saved = await writer.writeStream(
      'a.txt',
      streamOf('x'),
      vi.fn(),
      new AbortController().signal,
    );
    expect(saved).toBe('a (2).txt');
  });

  it('removes the partial file on abort', async () => {
    const { writer, root } = setup();
    await writer.pick();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1]));
      },
    });
    const pending = writer.writeStream(
      'p.bin',
      stream,
      () => controller.abort(),
      controller.signal,
    );
    await expect(pending).rejects.toSatisfy(isAbortError);
    expect(root.files.has('p.bin')).toBe(false);
  });

  it('removes the partial file when the stream errors', async () => {
    const { writer, root } = setup();
    await writer.pick();
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new Error('net down'));
      },
    });
    await expect(
      writer.writeStream('e.bin', stream, vi.fn(), new AbortController().signal),
    ).rejects.toThrow('net down');
    expect(root.files.has('e.bin')).toBe(false);
  });

  it('refuses to write when permission was revoked', async () => {
    const { writer, root } = setup();
    await writer.pick();
    root.permission = 'denied';
    await expect(
      writer.writeStream('a.txt', streamOf('x'), vi.fn(), new AbortController().signal),
    ).rejects.toThrow(/revoked/);
  });
});
