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
}

function wireActions(i18n: I18n): void {
  byId('toggle').addEventListener('click', () => void send({ type: 'TOGGLE_PANEL' }));
  byId('rescan').addEventListener('click', () => void rescan(i18n));
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

async function refreshStatus(i18n: I18n): Promise<void> {
  const status = byId('status');
  const stats = byId('stats');
  const response = await send<ContentState>({ type: 'GET_STATE' });

  if (response?.ok && response.data?.detected) {
    const state = response.data;
    status.textContent = i18n.t('popup_status_active');
    status.classList.add('is-active');
    stats.hidden = false;
    byId('stat-total').textContent = String(state.totalMedia);
    byId('stat-selected').textContent = String(state.selected);
    setEnabled(['toggle', 'rescan'], true);
  } else {
    status.textContent = i18n.t('popup_status_inactive');
    status.classList.remove('is-active');
    stats.hidden = true;
    setEnabled(['toggle', 'rescan'], false);
  }
}

async function send<T = unknown>(
  message: RuntimeMessage,
): Promise<MessageResponse<T> | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return undefined;
    return (await chrome.tabs.sendMessage(tab.id, message)) as MessageResponse<T>;
  } catch (error) {
    logger.warn('Message to content script failed', error);
    return undefined;
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setEnabled(ids: readonly string[], enabled: boolean): void {
  for (const id of ids) {
    const el = byId(id) as HTMLButtonElement;
    el.disabled = !enabled;
  }
}

void init();
