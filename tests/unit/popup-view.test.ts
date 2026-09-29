import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyStatus,
  isReceivingEndMissing,
  isTelegramUrl,
  renderHealth,
  renderPopup,
  type PopupElements,
} from '../../src/popup/popup-view.js';
import { I18n, CATALOGS } from '../../src/shared/i18n/index.js';
import type { ContentState, SelectorHealthReport } from '../../src/shared/types/index.js';

const POPUP_HTML = readFileSync(
  resolve(__dirname, '../../src/popup/popup.html'),
  'utf-8',
);
const TG = 'https://web.telegram.org/k/#-100123';
const { t } = new I18n('en');

const BROKEN: SelectorHealthReport = {
  client: 'webk',
  ok: false,
  checkedAt: 1,
  checks: [
    { name: 'appRoot', selector: '.whole', matched: true, critical: true },
    { name: 'messageContainer', selector: '.bubbles', matched: false, critical: true },
    { name: 'photo', selector: '.media-photo', matched: false, critical: false },
  ],
};

function mountPopup(): PopupElements {
  const body = /<body>([\s\S]*)<\/body>/.exec(POPUP_HTML)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  const get = <E extends HTMLElement>(id: string): E => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing #${id}`);
    return el as E;
  };
  return {
    status: get('status'),
    stats: get('stats'),
    statTotal: get('stat-total'),
    statSelected: get('stat-selected'),
    notice: get('notice'),
    noticeText: get('notice-text'),
    reload: get('reload'),
    health: get('health'),
    toggle: get('toggle'),
    rescan: get('rescan'),
  };
}

function state(extra: Partial<ContentState> = {}): ContentState {
  return { detected: true, client: 'webk', totalMedia: 7, selected: 2, ...extra };
}

describe('popup status classification', () => {
  it('recognises Telegram Web URLs only', () => {
    expect(isTelegramUrl(TG)).toBe(true);
    expect(isTelegramUrl('https://web.telegram.org/a/')).toBe(true);
    expect(isTelegramUrl('https://example.com/web.telegram.org')).toBe(false);
    expect(isTelegramUrl('http://web.telegram.org/k/')).toBe(false);
    expect(isTelegramUrl(undefined)).toBe(false);
    expect(isTelegramUrl('not a url')).toBe(false);
  });

  it('detects the missing-receiver error', () => {
    expect(
      isReceivingEndMissing(
        new Error('Could not establish connection. Receiving end does not exist.'),
      ),
    ).toBe(true);
    expect(isReceivingEndMissing('Receiving end does not exist.')).toBe(true);
    expect(isReceivingEndMissing(new Error('The message port closed'))).toBe(false);
  });

  it('classifies every outcome', () => {
    const missing = new Error('Receiving end does not exist.');
    expect(classifyStatus(undefined, { ok: false, error: missing }).kind).toBe(
      'notTelegram',
    );
    expect(
      classifyStatus('https://example.com', { ok: true, response: undefined }).kind,
    ).toBe('notTelegram');
    expect(classifyStatus(TG, { ok: false, error: missing }).kind).toBe('notInjected');
    expect(classifyStatus(TG, { ok: false, error: new Error('boom') }).kind).toBe(
      'noResponse',
    );
    expect(classifyStatus(TG, { ok: true, response: undefined }).kind).toBe('noResponse');
    expect(
      classifyStatus(TG, {
        ok: true,
        response: { ok: true, data: state({ detected: false }) },
      }).kind,
    ).toBe('noResponse');
    expect(
      classifyStatus(TG, { ok: true, response: { ok: false, error: 'x' } }).kind,
    ).toBe('noResponse');
    const active = classifyStatus(TG, {
      ok: true,
      response: { ok: true, data: state() },
    });
    expect(active).toEqual({ kind: 'active', state: state() });
  });
});

describe('popup rendering', () => {
  it('uses only translation keys that exist in both catalogs', () => {
    mountPopup();
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = el.dataset.i18n ?? '';
      expect(CATALOGS.en).toHaveProperty(key);
      expect(CATALOGS.tr).toHaveProperty(key);
    }
  });

  it('renders an active, healthy tab', () => {
    const els = mountPopup();
    renderPopup(els, { kind: 'active', state: state() }, t);
    expect(els.status.textContent).toBe(t('popup_status_active'));
    expect(els.status.classList.contains('is-active')).toBe(true);
    expect(els.stats.hidden).toBe(false);
    expect(els.statTotal.textContent).toBe('7');
    expect(els.statSelected.textContent).toBe('2');
    expect(els.toggle.disabled).toBe(false);
    expect(els.notice.hidden).toBe(true);
    expect(els.health.hidden).toBe(true);
  });

  it('shows the health warning with failed critical checks only', () => {
    const els = mountPopup();
    renderPopup(els, { kind: 'active', state: state({ health: BROKEN }) }, t);
    expect(els.health.hidden).toBe(false);
    expect(els.health.getAttribute('role')).toBe('alert');
    expect(els.health.querySelector('h2')?.id).toBe('health-title');
    const items = [...els.health.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['Message list .bubbles']);
    expect(els.health.textContent).toContain('src/shared/constants/selectors.ts');
  });

  it('falls back to the raw check name for unknown checks', () => {
    const container = document.createElement('section');
    renderHealth(
      container,
      {
        ...BROKEN,
        checks: [{ name: 'newCheck', selector: '.x', matched: false, critical: true }],
      },
      new I18n('tr').t,
    );
    expect(container.querySelector('li')?.textContent).toBe('newCheck .x');
    expect(container.querySelector('h2')?.textContent).toBe(CATALOGS.tr.health_title);

    renderHealth(container, { ...BROKEN, ok: true }, t);
    expect(container.hidden).toBe(true);
    expect(container.childElementCount).toBe(0);
  });

  it('distinguishes non-Telegram tabs from missing content scripts', () => {
    const els = mountPopup();
    renderPopup(els, { kind: 'notTelegram' }, t);
    expect(els.status.textContent).toBe(t('popup_status_inactive'));
    expect(els.notice.hidden).toBe(false);
    expect(els.noticeText.textContent).toBe(t('popup_not_telegram'));
    expect(els.reload.hidden).toBe(true);
    expect(els.toggle.disabled).toBe(true);
    expect(els.rescan.disabled).toBe(true);
    expect(els.stats.hidden).toBe(true);

    renderPopup(els, { kind: 'notInjected' }, t);
    expect(els.noticeText.textContent).toBe(t('popup_not_injected'));
    expect(els.reload.hidden).toBe(false);

    renderPopup(els, { kind: 'noResponse' }, t);
    expect(els.noticeText.textContent).toBe(t('popup_no_response'));
    expect(els.reload.hidden).toBe(false);
    expect(els.health.hidden).toBe(true);
  });
});
