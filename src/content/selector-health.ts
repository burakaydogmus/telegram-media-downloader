import type {
  SelectorCheck,
  SelectorHealthReport,
  TelegramClient,
} from '../shared/types/index.js';
import { selectorsFor, type ClientSelectors } from '../shared/constants/selectors.js';

const MEDIA_KEYS = ['photo', 'video', 'gif', 'document', 'audio'] as const;

export interface WatchSelectorHealthOptions {
  /** Periodic re-check interval. */
  readonly intervalMs?: number;
  /** Extra re-check after a hash change, once Telegram has rendered the chat. */
  readonly settleMs?: number;
  readonly now?: () => number;
}

export const DEFAULT_HEALTH_INTERVAL_MS = 15_000;
export const DEFAULT_HEALTH_SETTLE_MS = 1_500;

/**
 * Probes the client's selectors against the live DOM. Context-menu selectors
 * are skipped: they only match while a menu is open.
 */
export function runSelectorHealth(
  doc: Document,
  client: TelegramClient,
  now: () => number = Date.now,
): SelectorHealthReport {
  const selectors = selectorsFor(client);
  const checks: SelectorCheck[] = [];
  const add = (name: keyof ClientSelectors, critical: boolean): Element | null => {
    const selector = selectors[name];
    const el = safeQuery(doc, selector);
    checks.push({ name, selector, matched: el !== null, critical });
    return el;
  };

  add('appRoot', true);
  add('loggedIn', true);
  add('observeRoot', true);
  const container = add('messageContainer', isChatOpen(doc));
  add('message', container !== null && container.children.length > 0);
  for (const key of MEDIA_KEYS) add(key, false);

  return {
    client,
    ok: checks.every((check) => check.matched || !check.critical),
    checks,
    checkedAt: now(),
  };
}

/** Names of critical checks that failed, in report order. */
export function failedCriticalChecks(report: SelectorHealthReport): string[] {
  return report.checks
    .filter((check) => check.critical && !check.matched)
    .map((check) => check.name);
}

/**
 * Re-runs the self-test on hash changes and at `intervalMs`, calling
 * `onReport` immediately and afterwards only when `ok` or the set of failed
 * checks changes. Returns a disposer.
 */
export function watchSelectorHealth(
  doc: Document,
  client: TelegramClient,
  onReport: (report: SelectorHealthReport) => void,
  options: WatchSelectorHealthOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
  const settleMs = options.settleMs ?? DEFAULT_HEALTH_SETTLE_MS;
  let lastSignature: string | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const check = (): void => {
    const report = runSelectorHealth(doc, client, options.now);
    const signature = signatureOf(report);
    if (signature === lastSignature) return;
    lastSignature = signature;
    onReport(report);
  };

  const onHashChange = (): void => {
    check();
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = setTimeout(check, settleMs);
  };

  const win = doc.defaultView;
  win?.addEventListener('hashchange', onHashChange);
  const interval = setInterval(check, intervalMs);
  check();

  return () => {
    win?.removeEventListener('hashchange', onHashChange);
    clearInterval(interval);
    if (settleTimer !== undefined) clearTimeout(settleTimer);
  };
}

function signatureOf(report: SelectorHealthReport): string {
  const failed = report.checks
    .filter((check) => !check.matched)
    .map((check) => `${check.name}${check.critical ? '!' : ''}`)
    .sort();
  return `${String(report.ok)}|${failed.join(',')}`;
}

function isChatOpen(doc: Document): boolean {
  const hash = doc.location?.hash ?? '';
  return hash.length > 1;
}

function safeQuery(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    // An invalid selector is a failed check, not a crash.
    return null;
  }
}
