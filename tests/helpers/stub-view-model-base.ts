import type {
  CrawlOptions,
  CrawlState,
  FilterScope,
  SelectorHealthReport,
} from '../../src/shared/types/index.js';

/**
 * Default no-op implementations of the newer PanelViewModel members so test
 * stubs only need to override what they exercise.
 */
export abstract class StubViewModelBase {
  isDownloaded(_id: string): boolean {
    return false;
  }
  getCurrentPeerId(): string | undefined {
    return undefined;
  }
  setScope(_scope: FilterScope): void {}
  setHideDownloaded(_value: boolean): void {}
  resetFilters(): void {}
  selectRange(_anchorId: string, _targetId: string): void {}
  pauseQueue(): void {}
  resumeQueue(): void {}
  revealItem(_id: string): void {}
  getCrawlState(): CrawlState {
    return { status: 'idle', steps: 0, foundItems: 0 };
  }
  startCrawl(_options?: CrawlOptions): void {}
  pauseCrawl(): void {}
  resumeCrawl(): void {}
  stopCrawl(): void {}
  hasDownloadDirectory(): boolean {
    return false;
  }
  pickDownloadDirectory(): Promise<boolean> {
    return Promise.resolve(false);
  }
  clearDownloadDirectory(): Promise<void> {
    return Promise.resolve();
  }
  getHealth(): SelectorHealthReport | null {
    return null;
  }
}
