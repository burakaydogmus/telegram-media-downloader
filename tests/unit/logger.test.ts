import { describe, it, expect, vi } from 'vitest';
import { Logger, isLogLevel } from '../../src/shared/logger/logger.js';

function silentSink() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('Logger', () => {
  it('respects the minimum level', () => {
    const sink = silentSink();
    const logger = new Logger('warn', 'app', 100, sink);
    logger.debug('skip');
    logger.info('skip');
    logger.warn('keep');
    logger.error('keep');
    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledOnce();
    expect(sink.error).toHaveBeenCalledOnce();
    expect(logger.getEntries()).toHaveLength(2);
  });

  it('buffers entries up to the cap', () => {
    const logger = new Logger('debug', 'app', 3, silentSink());
    for (let i = 0; i < 5; i += 1) logger.info(`m${i}`);
    const entries = logger.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0]?.message).toBe('m2');
  });

  it('creates scoped child loggers', () => {
    const sink = silentSink();
    const logger = new Logger('debug', 'app', 100, sink);
    const child = logger.child('scanner');
    child.info('hello');
    expect(logger.getEntries()[0]?.scope).toBe('scanner');
  });

  it('notifies subscribers and supports unsubscribe', () => {
    const logger = new Logger('debug', 'app', 100, silentSink());
    const listener = vi.fn();
    const unsub = logger.subscribe(listener);
    logger.info('a');
    unsub();
    logger.info('b');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('changes level at runtime and clears', () => {
    const sink = silentSink();
    const logger = new Logger('error', 'app', 100, sink);
    logger.info('skip');
    logger.setLevel('debug');
    logger.info('keep');
    expect(logger.getEntries()).toHaveLength(1);
    logger.clear();
    expect(logger.getEntries()).toHaveLength(0);
  });

  it('validates log levels', () => {
    expect(isLogLevel('debug')).toBe(true);
    expect(isLogLevel('nope')).toBe(false);
  });
});
