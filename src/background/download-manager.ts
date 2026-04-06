import type { ILogger } from '../shared/logger/index.js';
import { sanitizeFileName } from '../shared/utils/index.js';
import { DownloadError, toMessage } from '../shared/errors/index.js';

export class DownloadManager {
  private readonly pending = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private listenerAttached = false;

  constructor(private readonly logger: ILogger) {}

  async download(url: string, fileName: string): Promise<void> {
    if (!url) {
      throw new DownloadError('Missing URL', { userMessageKey: 'error_download_failed' });
    }
    this.ensureListener();

    const safeName = sanitizeFileName(fileName);
    let downloadId: number;
    try {
      downloadId = await chrome.downloads.download({
        url,
        filename: safeName,
        conflictAction: 'uniquify',
        saveAs: false,
      });
    } catch (cause) {
      this.logger.error('chrome.downloads.download failed', toMessage(cause));
      throw new DownloadError(`Failed to start download: ${toMessage(cause)}`, {
        cause,
        userMessageKey: 'error_download_failed',
      });
    }

    return new Promise<void>((resolve, reject) => {
      this.pending.set(downloadId, { resolve, reject });
    });
  }

  private ensureListener(): void {
    if (this.listenerAttached) return;
    this.listenerAttached = true;
    chrome.downloads.onChanged.addListener((delta) => this.onChanged(delta));
  }

  private onChanged(delta: chrome.downloads.DownloadDelta): void {
    const entry = this.pending.get(delta.id);
    if (!entry) return;

    if (delta.state?.current === 'complete') {
      this.pending.delete(delta.id);
      this.logger.info(`Download ${delta.id} complete`);
      entry.resolve();
    } else if (delta.state?.current === 'interrupted') {
      this.pending.delete(delta.id);
      const reason = delta.error?.current ?? 'interrupted';
      this.logger.warn(`Download ${delta.id} interrupted: ${reason}`);
      entry.reject(
        new DownloadError(`Download interrupted: ${reason}`, {
          userMessageKey: 'error_download_failed',
        }),
      );
    }
  }
}
