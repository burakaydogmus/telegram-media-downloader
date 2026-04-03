export type ErrorCategory =
  | 'UIError'
  | 'NetworkError'
  | 'ScanError'
  | 'DownloadError'
  | 'StorageError';

export interface AppErrorOptions {
  readonly userMessageKey?: string;

  readonly cause?: unknown;

  readonly context?: Readonly<Record<string, unknown>>;
}

export abstract class AppError extends Error {
  abstract readonly category: ErrorCategory;
  readonly userMessageKey: string;
  readonly context: Readonly<Record<string, unknown>>;

  protected constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.userMessageKey = options.userMessageKey ?? 'error_generic';
    this.context = options.context ?? {};
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      category: this.category,
      message: this.message,
      userMessageKey: this.userMessageKey,
      context: this.context,
    };
  }
}

export class UIError extends AppError {
  override readonly category = 'UIError' as const;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class NetworkError extends AppError {
  override readonly category = 'NetworkError' as const;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class ScanError extends AppError {
  override readonly category = 'ScanError' as const;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class DownloadError extends AppError {
  override readonly category = 'DownloadError' as const;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class StorageError extends AppError {
  override readonly category = 'StorageError' as const;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, options);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toMessage(value: unknown): string {
  if (isAppError(value)) return value.message;
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
