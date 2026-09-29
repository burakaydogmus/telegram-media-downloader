import type {
  Settings,
  FilterState,
  PanelState,
  PersistedStatistics,
} from '../../shared/types/index.js';
import {
  DEFAULT_SETTINGS,
  DEFAULT_FILTERS,
  DEFAULT_PANEL_STATE,
  STORAGE_KEYS,
} from '../../shared/constants/index.js';
import { StorageError } from '../../shared/errors/index.js';
import type { ILogger } from '../../shared/logger/index.js';
import type { StorageDriver } from './storage-driver.js';
import { KeyMutex, type LockManagerLike } from './key-mutex.js';
import { mergeDefaults } from './merge-defaults.js';

export const DEFAULT_STATISTICS: PersistedStatistics = {
  totalDiscovered: 0,
  totalDownloaded: 0,
  totalFailed: 0,
  lastScanAt: null,
};

export interface StorageServiceOptions {
  /**
   * Optional Web Locks manager (usually `navigator.locks`). When given,
   * read-modify-write operations also serialize across same-origin contexts.
   */
  readonly locks?: LockManagerLike;
}

/**
 * Typed facade over a `StorageDriver`.
 *
 * All writes and read-modify-write updates are serialized per key within this
 * instance, so concurrent `updateStatistics` calls never lose increments.
 * Across contexts (content script vs. service worker vs. options page)
 * chrome.storage offers no atomic update; pass `locks` to cover same-origin
 * contexts, and otherwise keep read-modify-write of a key in a single context.
 */
export class StorageService {
  private readonly mutex: KeyMutex;

  constructor(
    private readonly driver: StorageDriver,
    private readonly logger: ILogger,
    options: StorageServiceOptions = {},
  ) {
    this.mutex = new KeyMutex(options.locks);
  }

  async getSettings(): Promise<Settings> {
    return mergeDefaults(DEFAULT_SETTINGS, await this.safeGet(STORAGE_KEYS.settings));
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.write(STORAGE_KEYS.settings, settings);
  }

  onSettingsChanged(listener: (settings: Settings) => void): () => void {
    return this.watch(STORAGE_KEYS.settings, (raw) =>
      listener(mergeDefaults(DEFAULT_SETTINGS, raw)),
    );
  }

  async getFilters(): Promise<FilterState> {
    return mergeDefaults(DEFAULT_FILTERS, await this.safeGet(STORAGE_KEYS.filters));
  }

  async saveFilters(filters: FilterState): Promise<void> {
    await this.write(STORAGE_KEYS.filters, filters);
  }

  async resetFilters(): Promise<FilterState> {
    const filters = mergeDefaults(DEFAULT_FILTERS, undefined);
    await this.saveFilters(filters);
    return filters;
  }

  onFiltersChanged(listener: (filters: FilterState) => void): () => void {
    return this.watch(STORAGE_KEYS.filters, (raw) =>
      listener(mergeDefaults(DEFAULT_FILTERS, raw)),
    );
  }

  async getPanelState(): Promise<PanelState> {
    return mergeDefaults(DEFAULT_PANEL_STATE, await this.safeGet(STORAGE_KEYS.panel));
  }

  async savePanelState(state: PanelState): Promise<void> {
    await this.write(STORAGE_KEYS.panel, state);
  }

  async getStatistics(): Promise<PersistedStatistics> {
    return mergeDefaults(DEFAULT_STATISTICS, await this.safeGet(STORAGE_KEYS.statistics));
  }

  async saveStatistics(stats: PersistedStatistics): Promise<void> {
    await this.write(STORAGE_KEYS.statistics, stats);
  }

  updateStatistics(
    update: (current: PersistedStatistics) => PersistedStatistics,
  ): Promise<PersistedStatistics> {
    return this.mutex.run(STORAGE_KEYS.statistics, async () => {
      const next = update(await this.getStatistics());
      await this.safeSet(STORAGE_KEYS.statistics, next);
      return next;
    });
  }

  private write<T>(key: string, value: T): Promise<void> {
    return this.mutex.run(key, () => this.safeSet(key, value));
  }

  private watch(key: string, callback: (raw: unknown) => void): () => void {
    if (!this.driver.watch) return () => undefined;
    return this.driver.watch(key, (raw) => {
      try {
        callback(raw);
      } catch (error) {
        this.logger.error(`Storage change listener for "${key}" threw`, error);
      }
    });
  }

  private async safeGet<T>(key: string): Promise<T | undefined> {
    try {
      return await this.driver.get<T>(key);
    } catch (cause) {
      this.logger.error(`Failed to read storage key "${key}"`, cause);
      throw new StorageError(`read failed for ${key}`, {
        cause,
        userMessageKey: 'error_storage_failed',
      });
    }
  }

  private async safeSet<T>(key: string, value: T): Promise<void> {
    try {
      await this.driver.set<T>(key, value);
    } catch (cause) {
      this.logger.error(`Failed to write storage key "${key}"`, cause);
      throw new StorageError(`write failed for ${key}`, {
        cause,
        userMessageKey: 'error_storage_failed',
      });
    }
  }
}
