import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ChromeStorageDriver,
  MemoryStorageDriver,
  createDefaultStorageDriver,
} from '../../src/features/local-storage/storage-driver.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MemoryStorageDriver', () => {
  it('stores, retrieves, removes and clears', async () => {
    const driver = new MemoryStorageDriver();
    await driver.set('k', { a: 1 });
    expect(await driver.get<{ a: number }>('k')).toEqual({ a: 1 });
    await driver.remove('k');
    expect(await driver.get('k')).toBeUndefined();
    await driver.set('x', 1);
    await driver.clear();
    expect(await driver.get('x')).toBeUndefined();
  });

  it('clones values on set (no aliasing)', async () => {
    const driver = new MemoryStorageDriver();
    const value = { nested: { n: 1 } };
    await driver.set('k', value);
    value.nested.n = 99;
    expect((await driver.get<typeof value>('k'))?.nested.n).toBe(1);
  });
});

describe('ChromeStorageDriver', () => {
  function stubChrome() {
    const store: Record<string, unknown> = {};
    const local = {
      get: vi.fn((key: string) => Promise.resolve({ [key]: store[key] })),
      set: vi.fn((obj: Record<string, unknown>) => {
        Object.assign(store, obj);
        return Promise.resolve();
      }),
      remove: vi.fn((key: string) => {
        delete store[key];
        return Promise.resolve();
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(store)) delete store[k];
        return Promise.resolve();
      }),
    };
    vi.stubGlobal('chrome', { storage: { local } });
    return local;
  }

  it('delegates to chrome.storage.local', async () => {
    const local = stubChrome();
    const driver = new ChromeStorageDriver();
    await driver.set('k', 42);
    expect(local.set).toHaveBeenCalledWith({ k: 42 });
    expect(await driver.get<number>('k')).toBe(42);
    await driver.remove('k');
    expect(local.remove).toHaveBeenCalledWith('k');
    await driver.clear();
    expect(local.clear).toHaveBeenCalled();
  });

  it('createDefaultStorageDriver picks Chrome when available', () => {
    stubChrome();
    expect(createDefaultStorageDriver()).toBeInstanceOf(ChromeStorageDriver);
  });

  it('createDefaultStorageDriver falls back to memory without chrome', () => {
    vi.stubGlobal('chrome', undefined);
    expect(createDefaultStorageDriver()).toBeInstanceOf(MemoryStorageDriver);
  });
});
