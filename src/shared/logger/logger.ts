import type { LogLevel } from '../types/index.js';
import { LOG_LEVELS } from '../types/index.js';
import { PERF } from '../constants/index.js';

export interface LogEntry {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly data?: unknown;
}

export type LogListener = (entry: LogEntry) => void;

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface ILogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;

  child(scope: string): ILogger;

  getEntries(): readonly LogEntry[];

  subscribe(listener: LogListener): () => void;

  setLevel(level: LogLevel): void;

  clear(): void;
}

export class Logger implements ILogger {
  private readonly buffer: LogEntry[] = [];
  private readonly listeners = new Set<LogListener>();

  constructor(
    private level: LogLevel = 'info',
    private readonly scope: string = 'app',
    private readonly maxEntries: number = PERF.maxLogEntries,
    private readonly sink: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console,
  ) {}

  debug(message: string, data?: unknown): void {
    this.record('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.record('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.record('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.record('error', message, data);
  }

  child(scope: string): ILogger {
    const childScope = this.scope === 'app' ? scope : `${this.scope}:${scope}`;
    return new ChildLogger(this, childScope);
  }

  getEntries(): readonly LogEntry[] {
    return this.buffer.slice();
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  clear(): void {
    this.buffer.length = 0;
  }

  recordScoped(level: LogLevel, scope: string, message: string, data?: unknown): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;

    const entry: LogEntry =
      data === undefined
        ? { timestamp: Date.now(), level, scope, message }
        : { timestamp: Date.now(), level, scope, message, data };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }

    const line = `[${scope}] ${message}`;
    if (data === undefined) this.sink[level](line);
    else this.sink[level](line, data);

    for (const listener of this.listeners) listener(entry);
  }

  private record(level: LogLevel, message: string, data?: unknown): void {
    this.recordScoped(level, this.scope, message, data);
  }
}
class ChildLogger implements ILogger {
  constructor(
    private readonly root: Logger,
    private readonly scope: string,
  ) {}

  debug(message: string, data?: unknown): void {
    this.root.recordScoped('debug', this.scope, message, data);
  }
  info(message: string, data?: unknown): void {
    this.root.recordScoped('info', this.scope, message, data);
  }
  warn(message: string, data?: unknown): void {
    this.root.recordScoped('warn', this.scope, message, data);
  }
  error(message: string, data?: unknown): void {
    this.root.recordScoped('error', this.scope, message, data);
  }
  child(scope: string): ILogger {
    return new ChildLogger(this.root, `${this.scope}:${scope}`);
  }
  getEntries(): readonly LogEntry[] {
    return this.root.getEntries();
  }
  subscribe(listener: LogListener): () => void {
    return this.root.subscribe(listener);
  }
  setLevel(level: LogLevel): void {
    this.root.setLevel(level);
  }
  clear(): void {
    this.root.clear();
  }
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
