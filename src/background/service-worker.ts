import { Logger } from '../shared/logger/index.js';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants/index.js';
import type { RuntimeMessage, MessageResponse } from '../shared/types/index.js';
import { toMessage } from '../shared/errors/index.js';
import {
  StorageService,
  createDefaultStorageDriver,
} from '../features/local-storage/index.js';
import { DownloadManager } from './download-manager.js';

const logger = new Logger('info', 'sw');
const storage = new StorageService(createDefaultStorageDriver(), logger);
const downloadManager = new DownloadManager(logger.child('downloads'));

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    try {
      const existing = await chrome.storage.local.get(STORAGE_KEYS.settings);
      if (existing[STORAGE_KEYS.settings] === undefined) {
        await storage.saveSettings(DEFAULT_SETTINGS);
        logger.info('Seeded default settings');
      }
      logger.info(`Installed/updated: ${details.reason}`);
    } catch (error) {
      logger.error('onInstalled failed', toMessage(error));
    }
  })();
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse: (r: MessageResponse) => void) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ ok: true });
        return false;

      case 'DOWNLOAD_FILE': {
        downloadManager
          .download(message.url, message.fileName)
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) =>
            sendResponse({ ok: false, error: toMessage(error) }),
          );
        return true; // Keep the message channel open for the async response.
      }

      case 'LOG':
        logger[message.level](`[${message.scope}] ${message.message}`);
        sendResponse({ ok: true });
        return false;

      default:
        sendResponse({ ok: false, error: 'Unhandled message type' });
        return false;
    }
  },
);

logger.info('Service worker initialised');
