import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type DomFixture = 'webk-chat' | 'weba-chat';

interface HappyDomWindow {
  readonly happyDOM?: { setURL(url: string): void };
}

const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures/dom');

/** Replaces `<body>` with a Telegram chat snapshot from `tests/fixtures/dom`. */
export function loadDomFixture(name: DomFixture): void {
  const html = readFileSync(resolve(FIXTURE_DIR, `${name}.html`), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.replaceChildren(...Array.from(parsed.body.childNodes));
}

export function setLocation(url: string): void {
  (window as unknown as HappyDomWindow).happyDOM?.setURL(url);
}
