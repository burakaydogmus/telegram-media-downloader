import { Logger } from '../shared/logger/index.js';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants/index.js';
import type { RuntimeMessage, MessageResponse } from '../shared/types/index.js';
import { toMessage } from '../shared/errors/index.js';
import {
  StorageService,
  createDefaultStorageDriver,
} from '../features/local-storage/index.js';
import { DownloadManager } from './download-manager.js';
import { DownloadTracker } from './download-tracker.js';
import { createSessionStore } from './expectation-store.js';

const logger = new Logger('info', 'sw');
const storage = new StorageService(createDefaultStorageDriver(), logger);
const downloadManager = new DownloadManager(logger.child('downloads'));
const tracker = new DownloadTracker({
  downloads: {
    search: (query) => chrome.downloads.search(query),
    cancel: (id) => chrome.downloads.cancel(id),
  },
  sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  store: createSessionStore(),
  logger: logger.child('tracker'),
});

// MV3: every listener is registered synchronously at top level.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) =>
  tracker.onDeterminingFilename(item, suggest),
);
chrome.downloads.onChanged.addListener((delta) => tracker.onChanged(delta));

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
  (message: RuntimeMessage, sender, sendResponse: (r: MessageResponse) => void) => {
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

      case 'EXPECT_DOWNLOAD': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse({ ok: false, error: 'EXPECT_DOWNLOAD requires a tab sender' });
          return false;
        }
        tracker
          .expect(tabId, message)
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) =>
            sendResponse({ ok: false, error: toMessage(error) }),
          );
        return true;
      }

      case 'CANCEL_EXPECTED_DOWNLOAD':
        tracker
          .cancel(message.taskId)
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) =>
            sendResponse({ ok: false, error: toMessage(error) }),
          );
        return true;

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
