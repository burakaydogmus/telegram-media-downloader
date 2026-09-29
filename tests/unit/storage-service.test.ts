import { describe, it, expect } from 'vitest';
import { StorageService } from '../../src/features/local-storage/storage-service.js';
import { MemoryStorageDriver } from '../../src/features/local-storage/storage-driver.js';
import { Logger } from '../../src/shared/logger/logger.js';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/index.js';

function build(): StorageService {
  return new StorageService(new MemoryStorageDriver(), new Logger('error'));
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
});
