import { APP_ID } from '../shared/constants/index.js';

export interface Expectation {
  readonly taskId: string;
  readonly tabId: number;
  readonly relativePath: string;
  readonly token?: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ActiveDownload {
  readonly taskId: string;
  readonly tabId: number;
  readonly downloadId: number;
  readonly filename: string;
  readonly bytesReceived?: number;
}

export interface TrackerState {
  readonly expectations: readonly Expectation[];
  readonly active: readonly ActiveDownload[];
}

export const EMPTY_STATE: TrackerState = { expectations: [], active: [] };

export const TRACKER_STATE_KEY = `${APP_ID}:downloadTracking` as const;

/** Minimal subset of `chrome.storage.StorageArea` the store relies on. */
export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ExpectationStore {
  load(): Promise<TrackerState>;
  save(state: TrackerState): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isExpectation(value: unknown): value is Expectation {
  return (
    isRecord(value) &&
    typeof value['taskId'] === 'string' &&
    typeof value['tabId'] === 'number' &&
    typeof value['relativePath'] === 'string' &&
    typeof value['createdAt'] === 'number' &&
    typeof value['expiresAt'] === 'number' &&
    (value['token'] === undefined || typeof value['token'] === 'string')
  );
}

function isActive(value: unknown): value is ActiveDownload {
  return (
    isRecord(value) &&
    typeof value['taskId'] === 'string' &&
    typeof value['tabId'] === 'number' &&
    typeof value['downloadId'] === 'number' &&
    typeof value['filename'] === 'string'
  );
}

export function parseState(raw: unknown): TrackerState {
  if (!isRecord(raw)) return EMPTY_STATE;
  const expectations = Array.isArray(raw['expectations'])
    ? raw['expectations'].filter(isExpectation)
    : [];
  const active = Array.isArray(raw['active']) ? raw['active'].filter(isActive) : [];
  return { expectations, active };
}

export class MemoryExpectationStore implements ExpectationStore {
  private state: TrackerState = EMPTY_STATE;

  async load(): Promise<TrackerState> {
    return this.state;
  }

  async save(state: TrackerState): Promise<void> {
    this.state = state;
  }
}

/** Persists tracker state so it survives MV3 service-worker restarts. */
export class SessionExpectationStore implements ExpectationStore {
  private readonly memory = new MemoryExpectationStore();
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly area: KeyValueArea | undefined) {}

  async load(): Promise<TrackerState> {
    if (!this.area) return this.memory.load();
    try {
      const items = await this.area.get(TRACKER_STATE_KEY);
      return parseState(items[TRACKER_STATE_KEY]);
    } catch {
      return this.memory.load();
    }
  }

  save(state: TrackerState): Promise<void> {
    void this.memory.save(state);
    const area = this.area;
    if (!area) return Promise.resolve();
    // Serialise writes so a slow earlier write never overwrites a newer state.
    this.writes = this.writes
      .then(() => area.set({ [TRACKER_STATE_KEY]: state }))
      .catch(() => undefined);
    return this.writes;
  }
}

export function createSessionStore(): ExpectationStore {
  const area = typeof chrome !== 'undefined' ? chrome.storage?.session : undefined;
  return new SessionExpectationStore(area);
}
