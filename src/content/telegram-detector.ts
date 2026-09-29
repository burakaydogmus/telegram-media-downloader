import type { DetectionResult, TelegramClient } from '../shared/types/index.js';
import { selectorsFor } from '../shared/constants/selectors.js';
import { query } from '../shared/utils/index.js';
import type { ILogger } from '../shared/logger/index.js';

const WEBA_PATH = /^\/(a|z)(\/|$)/i;
const WEBK_PATH = /^\/k(\/|$)/i;

export class TelegramDetector {
  constructor(
    private readonly doc: Document = document,
    private readonly logger?: ILogger,
  ) {}

  detect(): DetectionResult {
    const host = (this.doc.location?.hostname ?? '').toLowerCase();
    if (host !== 'web.telegram.org' && !host.endsWith('.web.telegram.org')) {
      return this.unsupported('unknown', 'Not a Telegram Web host');
    }

    const client = this.detectClient();
    if (client === 'unknown') {
      return this.unsupported('unknown', 'Unrecognised Telegram client');
    }

    const selectors = selectorsFor(client);
    const authVisible = query(this.doc, selectors.loggedOut) !== null;
    const loggedIn = !authVisible && query(this.doc, selectors.loggedIn) !== null;
    const domReady = query(this.doc, selectors.messageContainer) !== null;

    const result: DetectionResult = loggedIn
      ? { supported: true, client, loggedIn, domReady }
      : { supported: true, client, loggedIn, domReady, reason: 'User is not logged in' };

    this.logger?.info('Detection result', result);
    return result;
  }

  private detectClient(): TelegramClient {
    const path = this.doc.location?.pathname ?? '';
    if (WEBA_PATH.test(path)) return 'weba';
    if (WEBK_PATH.test(path)) return 'webk';

    // DOM-signature fallback when the path is ambiguous (e.g. `/`). Web A is
    // checked first: its ids are unique, while Web K's classes are generic.
    if (query(this.doc, selectorsFor('weba').signature) !== null) return 'weba';
    if (query(this.doc, selectorsFor('webk').signature) !== null) return 'webk';
    return 'unknown';
  }

  private unsupported(client: TelegramClient, reason: string): DetectionResult {
    this.logger?.warn(`Telegram not detected: ${reason}`);
    return { supported: false, client, loggedIn: false, domReady: false, reason };
  }
}
