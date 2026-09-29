import type { TelegramClient } from './telegram.js';

export interface SelectorCheck {
  readonly name: string;
  readonly selector: string;
  readonly matched: boolean;
  /** Critical checks failing means the extension cannot work at all. */
  readonly critical: boolean;
}

export interface SelectorHealthReport {
  readonly client: TelegramClient;
  readonly ok: boolean;
  readonly checks: readonly SelectorCheck[];
  readonly checkedAt: number;
}
