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

const DEFAULT_STATISTICS: PersistedStatistics = {
  totalDiscovered: 0,
  totalDownloaded: 0,
  totalFailed: 0,
  lastScanAt: null,
};

export class StorageService {
  constructor(
    private readonly driver: StorageDriver,
    private readonly logger: ILogger,
  ) {}

  async getSettings(): Promise<Settings> {
    const stored = await this.safeGet<Partial<Settings>>(STORAGE_KEYS.settings);
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.safeSet(STORAGE_KEYS.settings, settings);
  }

  async getFilters(): Promise<FilterState> {
    const stored = await this.safeGet<Partial<FilterState>>(STORAGE_KEYS.filters);
    return { ...DEFAULT_FILTERS, ...stored };
  }

  async saveFilters(filters: FilterState): Promise<void> {
    await this.safeSet(STORAGE_KEYS.filters, filters);
  }

  async getPanelState(): Promise<PanelState> {
    const stored = await this.safeGet<Partial<PanelState>>(STORAGE_KEYS.panel);
    return { ...DEFAULT_PANEL_STATE, ...stored };
  }

  async savePanelState(state: PanelState): Promise<void> {
    await this.safeSet(STORAGE_KEYS.panel, state);
  }

  async getStatistics(): Promise<PersistedStatistics> {
    const stored = await this.safeGet<Partial<PersistedStatistics>>(
      STORAGE_KEYS.statistics,
    );
    return { ...DEFAULT_STATISTICS, ...stored };
  }

  async saveStatistics(stats: PersistedStatistics): Promise<void> {
    await this.safeSet(STORAGE_KEYS.statistics, stats);
  }

  async updateStatistics(
    update: (current: PersistedStatistics) => PersistedStatistics,
  ): Promise<PersistedStatistics> {
    const current = await this.getStatistics();
    const next = update(current);
    await this.saveStatistics(next);
    return next;
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
