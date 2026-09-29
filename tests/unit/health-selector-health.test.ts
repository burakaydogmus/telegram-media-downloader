import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  runSelectorHealth,
  watchSelectorHealth,
  failedCriticalChecks,
} from '../../src/content/selector-health.js';
import type { SelectorHealthReport } from '../../src/shared/types/index.js';

const WEBK_HEALTHY = `
  <div class="whole" id="page-chats">
    <div id="main-columns">
      <div id="column-center">
        <div class="chat">
          <div class="bubbles">
            <div class="bubbles-inner">
              <div class="bubble" data-mid="10"><img class="media-photo" src="https://x/a.jpg" /></div>
              <div class="bubble" data-mid="11"><div class="document"></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

const WEBA_HEALTHY = `
  <div id="root">
    <div id="Main">
      <div id="MiddleColumn">
        <div class="MessageList">
          <div class="Message" data-message-id="1">
            <div class="media-inner"><img class="full-media" src="https://x/a.jpg" /></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

function byName(report: SelectorHealthReport, name: string) {
  return report.checks.find((check) => check.name === name);
}

function setHash(hash: string): void {
  window.location.hash = hash;
}

describe('runSelectorHealth', () => {
  afterEach(() => setHash(''));

  it('reports a healthy Web K chat', () => {
    setHash('#-100123');
    document.body.innerHTML = WEBK_HEALTHY;
    const report = runSelectorHealth(document, 'webk', () => 42);
    expect(report.ok).toBe(true);
    expect(report.client).toBe('webk');
    expect(report.checkedAt).toBe(42);
    expect(byName(report, 'messageContainer')).toMatchObject({
      matched: true,
      critical: true,
    });
    expect(byName(report, 'message')).toMatchObject({ matched: true, critical: true });
    expect(byName(report, 'photo')).toMatchObject({ matched: true, critical: false });
    expect(byName(report, 'video')).toMatchObject({ matched: false, critical: false });
    expect(report.checks.some((check) => check.name.startsWith('contextMenu'))).toBe(
      false,
    );
  });

  it('reports a healthy Web A chat', () => {
    setHash('#12345');
    document.body.innerHTML = WEBA_HEALTHY;
    const report = runSelectorHealth(document, 'weba');
    expect(report.ok).toBe(true);
    expect(byName(report, 'photo')?.matched).toBe(true);
    expect(failedCriticalChecks(report)).toEqual([]);
  });

  it('fails when the Web K layout changed', () => {
    setHash('#-100123');
    document.body.innerHTML =
      '<div class="renamed-root"><div class="Bubbles2"></div></div>';
    const report = runSelectorHealth(document, 'webk');
    expect(report.ok).toBe(false);
    expect(failedCriticalChecks(report)).toEqual([
      'appRoot',
      'loggedIn',
      'observeRoot',
      'messageContainer',
    ]);
  });

  it('does not require a message list when no chat is open', () => {
    document.body.innerHTML =
      '<div id="root"><div id="Main"><div id="MiddleColumn"></div></div></div>';
    const report = runSelectorHealth(document, 'weba');
    expect(report.ok).toBe(true);
    expect(byName(report, 'messageContainer')).toMatchObject({
      matched: false,
      critical: false,
    });
  });

  it('flags renamed message nodes only when the container has children', () => {
    setHash('#1');
    document.body.innerHTML = `
      <div id="root"><div id="Main"><div id="MiddleColumn">
        <div class="MessageList"><div class="ChatMessage"></div></div>
      </div></div></div>`;
    const broken = runSelectorHealth(document, 'weba');
    expect(broken.ok).toBe(false);
    expect(failedCriticalChecks(broken)).toEqual(['message']);

    document.querySelector('.ChatMessage')?.remove();
    const empty = runSelectorHealth(document, 'weba');
    expect(empty.ok).toBe(true);
    expect(byName(empty, 'message')?.critical).toBe(false);
  });

  it('falls back to Web K selectors for an unknown client', () => {
    document.body.innerHTML = WEBK_HEALTHY;
    const report = runSelectorHealth(document, 'unknown');
    expect(report.client).toBe('unknown');
    expect(report.ok).toBe(true);
  });
});

describe('watchSelectorHealth', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setHash('');
  });

  it('emits immediately, then only when the failure set changes', () => {
    document.body.innerHTML = WEBK_HEALTHY;
    const reports: SelectorHealthReport[] = [];
    const stop = watchSelectorHealth(document, 'webk', (r) => reports.push(r), {
      intervalMs: 1000,
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]?.ok).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(reports).toHaveLength(1);

    document.body.innerHTML = '<div></div>';
    vi.advanceTimersByTime(1000);
    expect(reports).toHaveLength(2);
    expect(reports[1]?.ok).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(reports).toHaveLength(2);

    document.body.innerHTML = WEBK_HEALTHY;
    vi.advanceTimersByTime(1000);
    expect(reports).toHaveLength(3);
    expect(reports[2]?.ok).toBe(true);

    stop();
    document.body.innerHTML = '';
    vi.advanceTimersByTime(5000);
    expect(reports).toHaveLength(3);
  });

  it('re-checks on hashchange and again after the settle delay', () => {
    document.body.innerHTML = `
      <div id="root"><div id="Main"><div id="MiddleColumn"></div></div></div>`;
    const onReport = vi.fn();
    const stop = watchSelectorHealth(document, 'weba', onReport, {
      intervalMs: 60_000,
      settleMs: 500,
    });
    expect(onReport).toHaveBeenCalledTimes(1);

    // Chat opened but its message list has not rendered yet: now critical.
    setHash('#777');
    window.dispatchEvent(new Event('hashchange'));
    expect(onReport).toHaveBeenCalledTimes(2);
    expect((onReport.mock.lastCall?.[0] as SelectorHealthReport).ok).toBe(false);

    const list = document.createElement('div');
    list.className = 'MessageList';
    document.getElementById('MiddleColumn')?.appendChild(list);
    vi.advanceTimersByTime(500);
    expect(onReport).toHaveBeenCalledTimes(3);
    expect((onReport.mock.lastCall?.[0] as SelectorHealthReport).ok).toBe(true);

    stop();
    window.dispatchEvent(new Event('hashchange'));
    expect(onReport).toHaveBeenCalledTimes(3);
  });
});
