import type { TranslationKey, TranslationParams } from '../shared/i18n/index.js';
import type {
  ContentState,
  MessageResponse,
  SelectorHealthReport,
} from '../shared/types/index.js';
import { clearChildren, createElement } from '../shared/utils/index.js';

export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

export type PopupStatus =
  | { readonly kind: 'active'; readonly state: ContentState }
  | { readonly kind: 'notTelegram' }
  | { readonly kind: 'notInjected' }
  | { readonly kind: 'noResponse' };

export type SendOutcome<T> =
  | { readonly ok: true; readonly response: MessageResponse<T> | undefined }
  | { readonly ok: false; readonly error: unknown };

export interface PopupElements {
  readonly status: HTMLElement;
  readonly stats: HTMLElement;
  readonly statTotal: HTMLElement;
  readonly statSelected: HTMLElement;
  readonly notice: HTMLElement;
  readonly noticeText: HTMLElement;
  readonly reload: HTMLButtonElement;
  readonly health: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly rescan: HTMLButtonElement;
}

const CHECK_LABELS: Readonly<Record<string, TranslationKey>> = {
  appRoot: 'health_check_appRoot',
  loggedIn: 'health_check_loggedIn',
  observeRoot: 'health_check_observeRoot',
  messageContainer: 'health_check_messageContainer',
  message: 'health_check_message',
};

export function isTelegramUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'web.telegram.org';
  } catch {
    return false;
  }
}

/** Chrome's error when no content script listens in the target tab. */
export function isReceivingEndMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}

/**
 * Non-Telegram tabs have no readable URL (no `tabs` permission), so an unknown
 * URL counts as "not Telegram".
 */
export function classifyStatus(
  tabUrl: string | undefined,
  outcome: SendOutcome<ContentState>,
): PopupStatus {
  if (!isTelegramUrl(tabUrl)) return { kind: 'notTelegram' };
  if (!outcome.ok) {
    return isReceivingEndMissing(outcome.error)
      ? { kind: 'notInjected' }
      : { kind: 'noResponse' };
  }
  const data = outcome.response?.ok ? outcome.response.data : undefined;
  return data?.detected ? { kind: 'active', state: data } : { kind: 'noResponse' };
}

export function renderPopup(els: PopupElements, status: PopupStatus, t: Translate): void {
  const active = status.kind === 'active';
  els.status.textContent = t(active ? 'popup_status_active' : 'popup_status_inactive');
  els.status.classList.toggle('is-active', active);
  els.stats.hidden = !active;
  els.toggle.disabled = !active;
  els.rescan.disabled = !active;

  if (status.kind === 'active') {
    els.statTotal.textContent = String(status.state.totalMedia);
    els.statSelected.textContent = String(status.state.selected);
  }

  const notice = noticeKey(status);
  els.notice.hidden = notice === undefined;
  els.notice.dataset.kind = status.kind;
  els.noticeText.textContent = notice ? t(notice) : '';
  els.reload.hidden = status.kind !== 'notInjected' && status.kind !== 'noResponse';

  renderHealth(els.health, status.kind === 'active' ? status.state.health : undefined, t);
}

export function renderHealth(
  container: HTMLElement,
  report: SelectorHealthReport | undefined,
  t: Translate,
): void {
  clearChildren(container);
  if (!report || report.ok) {
    container.hidden = true;
    return;
  }

  const failed = report.checks.filter((check) => check.critical && !check.matched);
  const items = failed.map((check) => {
    const labelKey = CHECK_LABELS[check.name];
    return createElement('li', {
      children: [
        createElement('span', { text: labelKey ? t(labelKey) : check.name }),
        document.createTextNode(' '),
        createElement('code', {
          className: 'popup__health-selector',
          text: check.selector,
        }),
      ],
    });
  });

  container.append(
    createElement('h2', {
      id: 'health-title',
      className: 'popup__health-title',
      text: t('health_title'),
    }),
    createElement('p', { text: t('health_failed_intro') }),
    createElement('ul', { className: 'popup__health-list', children: items }),
    createElement('p', { className: 'popup__health-hint', text: t('health_hint') }),
  );
  container.hidden = false;
}

function noticeKey(status: PopupStatus): TranslationKey | undefined {
  switch (status.kind) {
    case 'notTelegram':
      return 'popup_not_telegram';
    case 'notInjected':
      return 'popup_not_injected';
    case 'noResponse':
      return 'popup_no_response';
    case 'active':
      return undefined;
  }
}
