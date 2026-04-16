import { describe, it, expect } from 'vitest';
import {
  UIError,
  NetworkError,
  ScanError,
  DownloadError,
  StorageError,
  isAppError,
  toMessage,
} from '../../src/shared/errors/errors.js';

describe('errors', () => {
  it('assigns the correct category and default user key', () => {
    expect(new UIError('x').category).toBe('UIError');
    expect(new NetworkError('x').category).toBe('NetworkError');
    expect(new ScanError('x').category).toBe('ScanError');
    expect(new DownloadError('x').category).toBe('DownloadError');
    expect(new StorageError('x').category).toBe('StorageError');
    expect(new UIError('x').userMessageKey).toBe('error_generic');
  });

  it('carries cause, context and custom user key', () => {
    const cause = new Error('root');
    const err = new ScanError('failed', {
      cause,
      userMessageKey: 'error_scan_failed',
      context: { selector: '.x' },
    });
    expect(err.cause).toBe(cause);
    expect(err.userMessageKey).toBe('error_scan_failed');
    expect(err.context).toEqual({ selector: '.x' });
  });

  it('serialises to JSON', () => {
    const json = new DownloadError('boom').toJSON();
    expect(json).toMatchObject({ category: 'DownloadError', message: 'boom' });
  });

  it('isAppError narrows app errors only', () => {
    expect(isAppError(new UIError('x'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('x')).toBe(false);
  });

  it('toMessage normalises any value', () => {
    expect(toMessage(new UIError('a'))).toBe('a');
    expect(toMessage(new Error('b'))).toBe('b');
    expect(toMessage('c')).toBe('c');
    expect(toMessage({ d: 1 })).toBe('{"d":1}');
  });
});
