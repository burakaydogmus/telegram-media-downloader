import { describe, it, expect, vi } from 'vitest';
import { StorageService } from '../../src/features/local-storage/storage-service.js';
import { MemoryStorageDriver } from '../../src/features/local-storage/storage-driver.js';
import { Logger } from '../../src/shared/logger/logger.js';
import {
  DEFAULT_FILTERS,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
} from '../../src/shared/constants/index.js';
import type { Settings } from '../../src/shared/types/index.js';

function build(driver = new MemoryStorageDriver()): StorageService {
  return new StorageService(driver, new Logger('error'));
}

describe('StorageService', () => {
  it('returns defaults when nothing is stored', async () => {
    const storage = build();
    expect(await storage.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect((await storage.getFilters()).dateRange).toBe('all');
    expect((await storage.getPanelState()).visible).toBe(true);
    expect((await storage.getStatistics()).totalDiscovered).toBe(0);
  });

  it('persists and merges partial settings', async () => {
    const storage = build();
    await storage.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect((await storage.getSettings()).theme).toBe('dark');
  });

  it('round-trips filters and panel state', async () => {
    const storage = build();
    await storage.saveFilters({
      types: ['photo'],
      dateRange: 'today',
      query: 'x',
      scope: 'all',
      hideDownloaded: false,
    });
    expect(await storage.getFilters()).toEqual({
      types: ['photo'],
      dateRange: 'today',
      query: 'x',
      scope: 'all',
      hideDownloaded: false,
    });

    await storage.savePanelState({ x: 10, y: 20, collapsed: true, visible: false });
    expect(await storage.getPanelState()).toEqual({
      x: 10,
      y: 20,
      collapsed: true,
      visible: false,
    });
  });

  it('updates statistics functionally', async () => {
    const storage = build();
    const next = await storage.updateStatistics((current) => ({
      ...current,
      totalDownloaded: current.totalDownloaded + 5,
    }));
    expect(next.totalDownloaded).toBe(5);
    expect((await storage.getStatistics()).totalDownloaded).toBe(5);
  });

  it('wraps driver errors in StorageError', async () => {
    const failing = {
      get: () => Promise.reject(new Error('disk')),
      set: () => Promise.reject(new Error('disk')),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const storage = new StorageService(failing, new Logger('error'));
    await expect(storage.getSettings()).rejects.toMatchObject({
      category: 'StorageError',
    });
  });

  it('does not lose concurrent statistics increments', async () => {
    const storage = build();
    await Promise.all(
      Array.from({ length: 50 }, () =>
        storage.updateStatistics((current) => ({
          ...current,
          totalDownloaded: current.totalDownloaded + 1,
        })),
      ),
    );
    expect((await storage.getStatistics()).totalDownloaded).toBe(50);
  });

  it('keeps serializing after an updater throws', async () => {
    const storage = build();
    const failing = storage.updateStatistics(() => {
      throw new Error('boom');
    });
    const ok = storage.updateStatistics((c) => ({
      ...c,
      totalFailed: c.totalFailed + 1,
    }));
    await expect(failing).rejects.toThrow('boom');
    expect((await ok).totalFailed).toBe(1);
  });

  it('serializes updates through a cross-context lock manager when given', async () => {
    const names: string[] = [];
    const locks = {
      request: <T>(name: string, cb: () => Promise<T>): Promise<T> => {
        names.push(name);
        return cb();
      },
    };
    const storage = new StorageService(new MemoryStorageDriver(), new Logger('error'), {
      locks,
    });
    await storage.updateStatistics((c) => ({ ...c, totalDiscovered: 3 }));
    await storage.saveSettings(DEFAULT_SETTINGS);
    expect(names).toEqual([
      `tgmd-lock:${STORAGE_KEYS.statistics}`,
      `tgmd-lock:${STORAGE_KEYS.settings}`,
    ]);
  });

  it('fills missing fields of older stored objects with defaults', async () => {
    const driver = new MemoryStorageDriver();
    await driver.set(STORAGE_KEYS.settings, { theme: 'dark', maxRetries: undefined });
    await driver.set(STORAGE_KEYS.filters, { query: 'cat', types: 'photo' });
    const storage = build(driver);
    expect(await storage.getSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(await storage.getFilters()).toEqual({ ...DEFAULT_FILTERS, query: 'cat' });
  });

  it('ignores corrupt non-object stored values', async () => {
    const driver = new MemoryStorageDriver();
    await driver.set(STORAGE_KEYS.panel, 'garbage');
    await driver.set(STORAGE_KEYS.statistics, [1, 2]);
    const storage = build(driver);
    expect((await storage.getPanelState()).visible).toBe(true);
    expect((await storage.getStatistics()).lastScanAt).toBeNull();
  });

  it('resetFilters persists the defaults', async () => {
    const storage = build();
    await storage.saveFilters({ ...DEFAULT_FILTERS, query: 'x', types: ['audio'] });
    expect(await storage.resetFilters()).toEqual(DEFAULT_FILTERS);
    expect(await storage.getFilters()).toEqual(DEFAULT_FILTERS);
  });

  it('notifies settings and filter listeners with defaults merged', async () => {
    const driver = new MemoryStorageDriver();
    const storage = build(driver);
    const settings: Settings[] = [];
    const onFilters = vi.fn();
    const off = storage.onSettingsChanged((s) => settings.push(s));
    storage.onFiltersChanged(onFilters);

    await driver.set(STORAGE_KEYS.settings, { theme: 'light' });
    await storage.saveFilters({ ...DEFAULT_FILTERS, hideDownloaded: true });
    off();
    await storage.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });

    expect(settings).toEqual([{ ...DEFAULT_SETTINGS, theme: 'light' }]);
    expect(onFilters).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, hideDownloaded: true });
  });

  it('isolates throwing change listeners', async () => {
    const storage = build();
    const good = vi.fn();
    storage.onSettingsChanged(() => {
      throw new Error('listener');
    });
    storage.onSettingsChanged(good);
    await expect(storage.saveSettings(DEFAULT_SETTINGS)).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op unsubscribe when the driver cannot watch', () => {
    const driver = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const storage = new StorageService(driver, new Logger('error'));
    expect(() => storage.onFiltersChanged(() => undefined)()).not.toThrow();
  });

  it('wraps write errors in StorageError', async () => {
    const failing = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error('quota')),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const storage = new StorageService(failing, new Logger('error'));
    await expect(
      storage.savePanelState({ x: 0, y: 0, collapsed: false, visible: true }),
    ).rejects.toMatchObject({ category: 'StorageError' });
  });
});
