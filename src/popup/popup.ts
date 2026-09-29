import { I18n } from '../shared/i18n/index.js';
import type { TranslationKey } from '../shared/i18n/index.js';
import {
  StorageService,
  createDefaultStorageDriver,
} from '../features/local-storage/index.js';
import { Logger } from '../shared/logger/index.js';
import type {
  RuntimeMessage,
  MessageResponse,
  ContentState,
} from '../shared/types/index.js';
import {
  classifyStatus,
  renderPopup,
  type PopupElements,
  type SendOutcome,
} from './popup-view.js';

const logger = new Logger('warn', 'popup');
const storage = new StorageService(createDefaultStorageDriver(), logger);

async function init(): Promise<void> {
  const settings = await storage.getSettings();
  const i18n = new I18n(settings.language);
  applyTranslations(i18n);
  wireActions(i18n);
  await refreshStatus(i18n);
}

function applyTranslations(i18n: I18n): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as TranslationKey | undefined;
    if (key) el.textContent = i18n.t(key);
  }
  document.documentElement.lang = i18n.language;
}

function wireActions(i18n: I18n): void {
  byId('toggle').addEventListener('click', () => void send({ type: 'TOGGLE_PANEL' }));
  byId('rescan').addEventListener('click', () => void rescan(i18n));
  byId('reload').addEventListener('click', () => void reloadTab());
  byId('open-telegram').addEventListener('click', () => {
    void chrome.tabs.create({ url: 'https://web.telegram.org/k/' });
  });
  byId('options').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
}

async function rescan(i18n: I18n): Promise<void> {
  await send({ type: 'START_SCAN' });
  // Give the content script a moment to scan, then refresh.
  setTimeout(() => void refreshStatus(i18n), 400);
}

async function reloadTab(): Promise<void> {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  await chrome.tabs.reload(tab.id);
  window.close();
}

async function refreshStatus(i18n: I18n): Promise<void> {
  const tab = await activeTab();
  const outcome = await send<ContentState>({ type: 'GET_STATE' }, tab);
  renderPopup(elements(), classifyStatus(tab?.url, outcome), i18n.t);
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  } catch (error) {
    logger.warn('Could not query the active tab', error);
    return undefined;
  }
}

async function send<T = unknown>(
  message: RuntimeMessage,
  knownTab?: chrome.tabs.Tab,
): Promise<SendOutcome<T>> {
  try {
    const tab = knownTab ?? (await activeTab());
    if (tab?.id === undefined) return { ok: false, error: new Error('No active tab') };
    const response = (await chrome.tabs.sendMessage(tab.id, message)) as
      | MessageResponse<T>
      | undefined;
    return { ok: true, response };
  } catch (error) {
    logger.warn('Message to content script failed', error);
    return { ok: false, error };
  }
}

function elements(): PopupElements {
  return {
    status: byId('status'),
    stats: byId('stats'),
    statTotal: byId('stat-total'),
    statSelected: byId('stat-selected'),
    notice: byId('notice'),
    noticeText: byId('notice-text'),
    reload: byId('reload') as HTMLButtonElement,
    health: byId('health'),
    toggle: byId('toggle') as HTMLButtonElement,
    rescan: byId('rescan') as HTMLButtonElement,
  };
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

void init();
