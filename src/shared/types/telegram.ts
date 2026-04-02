export const TELEGRAM_CLIENTS = ['webk', 'weba', 'unknown'] as const;
export type TelegramClient = (typeof TELEGRAM_CLIENTS)[number];

export interface DetectionResult {
  readonly supported: boolean;

  readonly client: TelegramClient;

  readonly loggedIn: boolean;

  readonly domReady: boolean;

  readonly reason?: string;
}
