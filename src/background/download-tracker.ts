import type { ILogger } from '../shared/logger/index.js';
import type { NativeDownloadPhase, RuntimeMessage } from '../shared/types/index.js';
import { PERF } from '../shared/constants/index.js';
import { toMessage } from '../shared/errors/index.js';
import {
  extractToken,
  resolveTargetPath,
  sanitizeRelativePath,
  stripToken,
} from './download-path.js';
import type {
  ActiveDownload,
  Expectation,
  ExpectationStore,
  TrackerState,
} from './expectation-store.js';

type DownloadItem = chrome.downloads.DownloadItem;
type DownloadDelta = chrome.downloads.DownloadDelta;
type Suggest = (suggestion?: chrome.downloads.DownloadFilenameSuggestion) => void;
type DownloadUpdate = Extract<RuntimeMessage, { type: 'DOWNLOAD_UPDATE' }>;
type ExpectRequest = Extract<RuntimeMessage, { type: 'EXPECT_DOWNLOAD' }>;

export interface DownloadsApi {
  search(query: chrome.downloads.DownloadQuery): Promise<DownloadItem[]>;
  cancel(downloadId: number): Promise<void>;
}

export interface DownloadTrackerDeps {
  readonly downloads: DownloadsApi;
  readonly sendToTab: (tabId: number, message: DownloadUpdate) => Promise<unknown>;
  readonly store: ExpectationStore;
  readonly logger: ILogger;
  readonly now?: () => number;
  readonly pollIntervalMs?: number;
}

const TELEGRAM_ORIGIN = 'https://web.telegram.org/';
const MAX_TIMEOUT_MS = 30 * 60_000;

export function isTelegramUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith(TELEGRAM_ORIGIN) || url.startsWith(`blob:${TELEGRAM_ORIGIN}`);
}

export function isTelegramDownload(item: DownloadItem): boolean {
  return (
    isTelegramUrl(item.url) ||
    isTelegramUrl(item.finalUrl) ||
    isTelegramUrl(item.referrer)
  );
}

/**
 * Matches browser downloads started by the page to `EXPECT_DOWNLOAD`
 * registrations, renames them and relays progress to the owning tab.
 * Chrome APIs are injected so the logic is testable and restart-safe.
 */
export class DownloadTracker {
  private expectations: Expectation[] = [];
  private active: ActiveDownload[] = [];
  private hydrated = false;
  private polling = false;
  private readonly ready: Promise<void>;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;

  constructor(private readonly deps: DownloadTrackerDeps) {
    this.now = deps.now ?? Date.now;
    this.pollIntervalMs = deps.pollIntervalMs ?? PERF.downloadPollMs;
    this.ready = this.hydrate();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  async expect(tabId: number, request: ExpectRequest): Promise<void> {
    await this.ready;
    const now = this.now();
    const timeout = Math.min(Math.max(request.timeoutMs, 0), MAX_TIMEOUT_MS);
    const expectation: Expectation = {
      taskId: request.taskId,
      tabId,
      relativePath: sanitizeRelativePath(request.relativePath),
      ...(request.token ? { token: request.token } : {}),
      createdAt: now,
      expiresAt: now + timeout,
    };
    this.expectations = [
      ...this.expectations.filter((e) => e.taskId !== request.taskId),
      expectation,
    ];
    this.sweepExpired();
    await this.persist();
  }

  async cancel(taskId: string): Promise<void> {
    await this.ready;
    this.expectations = this.expectations.filter((e) => e.taskId !== taskId);
    const match = this.active.find((a) => a.taskId === taskId);
    if (match) {
      this.active = this.active.filter((a) => a !== match);
      try {
        const [item] = await this.deps.downloads.search({ id: match.downloadId });
        if (item?.state === 'in_progress') {
          await this.deps.downloads.cancel(match.downloadId);
        }
      } catch (error) {
        this.deps.logger.warn(`Cancel ${match.downloadId} failed`, toMessage(error));
      }
      this.updatePolling();
    }
    this.scheduleExpiry();
    await this.persist();
  }

  /** `chrome.downloads.onDeterminingFilename` handler; returns true when async. */
  onDeterminingFilename(item: DownloadItem, suggest: Suggest): boolean {
    if (item.byExtensionId || !isTelegramDownload(item)) {
      suggest();
      return false;
    }
    if (this.hydrated) {
      this.determine(item, suggest);
      return false;
    }
    void this.ready.then(() => this.determine(item, suggest));
    return true;
  }

  onChanged(delta: DownloadDelta): void {
    if (!this.hydrated) {
      void this.ready.then(() => this.onChanged(delta));
      return;
    }
    const match = this.active.find((a) => a.downloadId === delta.id);
    if (!match) return;

    const filename = delta.filename?.current;
    if (filename) this.replaceActive(match, { ...match, filename });

    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') {
      void this.refreshAndFinish(match.downloadId, state, delta.error?.current);
    } else if (filename) {
      void this.persist();
    }
  }

  private determine(item: DownloadItem, suggest: Suggest): void {
    let suggested = false;
    try {
      this.sweepExpired();
      const token = extractToken(item.filename);
      const expectation = token
        ? this.expectations.find((e) => e.token === token)
        : this.expectations.find((e) => e.token === undefined);

      if (!expectation) {
        if (token) {
          // Our own anchor whose expectation is gone: at least drop the marker.
          suggest({
            filename: sanitizeRelativePath(stripToken(item.filename)),
            conflictAction: 'uniquify',
          });
        } else {
          suggest();
        }
        suggested = true;
        return;
      }

      const filename = resolveTargetPath(
        expectation.relativePath,
        item.filename,
        item.mime,
      );
      suggest({ filename, conflictAction: 'uniquify' });
      suggested = true;

      this.expectations = this.expectations.filter((e) => e !== expectation);
      this.active = [
        ...this.active.filter((a) => a.downloadId !== item.id),
        {
          taskId: expectation.taskId,
          tabId: expectation.tabId,
          downloadId: item.id,
          filename,
        },
      ];
      this.send(expectation.tabId, expectation.taskId, 'started', {
        downloadId: item.id,
        filename,
      });
      this.scheduleExpiry();
      this.updatePolling();
      void this.persist();
    } catch (error) {
      this.deps.logger.error('onDeterminingFilename failed', toMessage(error));
      if (!suggested) suggest();
    }
  }

  private async hydrate(): Promise<void> {
    try {
      const state = await this.deps.store.load();
      this.expectations = [...state.expectations];
      this.active = [...state.active];
    } catch (error) {
      this.deps.logger.warn('Failed to load download tracking state', toMessage(error));
    }
    this.hydrated = true;
    this.sweepExpired();
    if (this.active.length > 0) {
      await this.poll();
      this.updatePolling();
    }
    await this.persist();
  }

  /** Reports and drops expectations whose timeout elapsed without a match. */
  private sweepExpired(): void {
    const now = this.now();
    const expired = this.expectations.filter((e) => e.expiresAt <= now);
    if (expired.length > 0) {
      this.expectations = this.expectations.filter((e) => e.expiresAt > now);
      for (const e of expired) this.send(e.tabId, e.taskId, 'expired');
      void this.persist();
    }
    this.scheduleExpiry();
  }

  /** Best-effort in-memory timer; after a SW restart expiry is re-checked lazily. */
  private scheduleExpiry(): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    if (this.expectations.length === 0) return;
    const next = Math.min(...this.expectations.map((e) => e.expiresAt));
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = undefined;
        this.sweepExpired();
      },
      Math.max(next - this.now(), 0),
    );
  }

  private updatePolling(): void {
    if (this.active.length > 0 && this.pollTimer === undefined) {
      this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
    } else if (this.active.length === 0 && this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.pollOnce();
    } finally {
      this.polling = false;
    }
  }

  private async pollOnce(): Promise<void> {
    this.sweepExpired();
    const snapshot = [...this.active];
    for (const match of snapshot) {
      let item: DownloadItem | undefined;
      try {
        [item] = await this.deps.downloads.search({ id: match.downloadId });
      } catch (error) {
        this.deps.logger.warn(`Poll ${match.downloadId} failed`, toMessage(error));
        continue;
      }
      const current = this.active.find((a) => a.downloadId === match.downloadId);
      if (!current) continue;
      if (!item) {
        this.finish(current, 'interrupted', undefined, 'NOT_FOUND');
      } else if (item.state === 'complete' || item.state === 'interrupted') {
        this.finish(current, item.state, item);
      } else if (item.bytesReceived !== current.bytesReceived) {
        this.replaceActive(current, { ...current, bytesReceived: item.bytesReceived });
        this.send(current.tabId, current.taskId, 'progress', {
          downloadId: item.id,
          bytesReceived: item.bytesReceived,
          ...(item.totalBytes > 0 ? { totalBytes: item.totalBytes } : {}),
        });
      }
    }
    this.updatePolling();
    await this.persist();
  }

  private async refreshAndFinish(
    downloadId: number,
    state: 'complete' | 'interrupted',
    error?: string,
  ): Promise<void> {
    let item: DownloadItem | undefined;
    try {
      [item] = await this.deps.downloads.search({ id: downloadId });
    } catch {
      item = undefined;
    }
    const match = this.active.find((a) => a.downloadId === downloadId);
    if (!match) return;
    this.finish(match, state, item, error);
    this.updatePolling();
    await this.persist();
  }

  private finish(
    match: ActiveDownload,
    state: 'complete' | 'interrupted',
    item: DownloadItem | undefined,
    error?: string,
  ): void {
    this.active = this.active.filter((a) => a.downloadId !== match.downloadId);
    const filename = item?.filename || match.filename;
    if (state === 'complete') {
      this.send(match.tabId, match.taskId, 'complete', {
        downloadId: match.downloadId,
        filename,
        ...(item ? { bytesReceived: item.bytesReceived } : {}),
        ...(item && item.totalBytes > 0 ? { totalBytes: item.totalBytes } : {}),
      });
    } else {
      this.send(match.tabId, match.taskId, 'interrupted', {
        downloadId: match.downloadId,
        filename,
        error: error ?? item?.error ?? 'INTERRUPTED',
      });
    }
  }

  private replaceActive(previous: ActiveDownload, next: ActiveDownload): void {
    this.active = this.active.map((a) =>
      a.downloadId === previous.downloadId ? next : a,
    );
  }

  private send(
    tabId: number,
    taskId: string,
    phase: NativeDownloadPhase,
    extra: Omit<DownloadUpdate, 'type' | 'taskId' | 'phase'> = {},
  ): void {
    const message: DownloadUpdate = { type: 'DOWNLOAD_UPDATE', taskId, phase, ...extra };
    this.deps.sendToTab(tabId, message).catch((error: unknown) => {
      this.deps.logger.debug(`DOWNLOAD_UPDATE to tab ${tabId} failed`, toMessage(error));
    });
  }

  private persist(): Promise<void> {
    if (!this.hydrated) return Promise.resolve();
    const state: TrackerState = { expectations: this.expectations, active: this.active };
    return this.deps.store.save(state).catch((error: unknown) => {
      this.deps.logger.warn(
        'Failed to persist download tracking state',
        toMessage(error),
      );
    });
  }
}
