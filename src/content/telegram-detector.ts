import type { DetectionResult, TelegramClient } from '../shared/types/index.js';
import { selectorsFor } from '../shared/constants/selectors.js';
import { query } from '../shared/utils/index.js';
import type { ILogger } from '../shared/logger/index.js';

export class TelegramDetector {
  constructor(
    private readonly doc: Document = document,
    private readonly logger?: ILogger,
  ) {}

  detect(): DetectionResult {
    const host = this.doc.location?.hostname ?? '';
    if (!host.endsWith('web.telegram.org')) {
      return this.unsupported('unknown', 'Not a Telegram Web host');
    }

    const client = this.detectClient();
    if (client === 'unknown') {
      return this.unsupported('unknown', 'Unrecognised Telegram client');
    }

    const selectors = selectorsFor(client);
    const loggedIn = query(this.doc, selectors.loggedIn) !== null;
    const domReady = query(this.doc, selectors.messageContainer) !== null;

    const result: DetectionResult = loggedIn
      ? {
          supported: true,
          client,
          loggedIn,
          domReady,
        }
      : {
          supported: true,
          client,
          loggedIn,
          domReady,
          reason: 'User is not logged in',
        };

    this.logger?.info('Detection result', result);
    return result;
  }

  private detectClient(): TelegramClient {
    const path = this.doc.location?.pathname ?? '';
    if (path.startsWith('/a')) return 'weba';
    if (path.startsWith('/k')) return 'webk';

    // DOM-signature fallback when the path is ambiguous (e.g. `/`).
    if (query(this.doc, '#Main, #MiddleColumn, .Main') !== null) return 'weba';
    if (query(this.doc, '#page-chats, #column-center, .whole') !== null) return 'webk';
    return 'unknown';
  }

  private unsupported(client: TelegramClient, reason: string): DetectionResult {
    this.logger?.warn(`Telegram not detected: ${reason}`);
    return { supported: false, client, loggedIn: false, domReady: false, reason };
  }
}
