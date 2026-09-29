import { describe, it, expect } from 'vitest';
import { TelegramDetector } from '../../src/content/telegram-detector.js';

function mockDoc(hostname: string, pathname: string, html: string): Document {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return {
    location: { hostname, pathname, hash: '' },
    querySelector: (selector: string) => container.querySelector(selector),
    querySelectorAll: (selector: string) => container.querySelectorAll(selector),
  } as unknown as Document;
}

describe('TelegramDetector', () => {
  it('rejects non-telegram hosts', () => {
    const detector = new TelegramDetector(mockDoc('example.com', '/', ''));
    const result = detector.detect();
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/Telegram Web host/);
  });

  it('detects Web K via path', () => {
    const detector = new TelegramDetector(
      mockDoc(
        'web.telegram.org',
        '/k/',
        '<div id="column-center"></div><div class="bubbles"></div>',
      ),
    );
    const result = detector.detect();
    expect(result.supported).toBe(true);
    expect(result.client).toBe('webk');
    expect(result.loggedIn).toBe(true);
    expect(result.domReady).toBe(true);
  });

  it('detects Web A via path', () => {
    const detector = new TelegramDetector(
      mockDoc(
        'web.telegram.org',
        '/a/',
        '<div id="MiddleColumn"></div><div class="MessageList"></div>',
      ),
    );
    const result = detector.detect();
    expect(result.client).toBe('weba');
    expect(result.supported).toBe(true);
  });

  it('flags supported-but-not-logged-in', () => {
    const detector = new TelegramDetector(
      mockDoc('web.telegram.org', '/k/', '<div class="bubbles"></div>'),
    );
    const result = detector.detect();
    expect(result.supported).toBe(true);
    expect(result.loggedIn).toBe(false);
    expect(result.reason).toMatch(/not logged in/);
  });

  it('falls back to DOM signatures when path is ambiguous', () => {
    const detector = new TelegramDetector(
      mockDoc(
        'web.telegram.org',
        '/',
        '<div id="page-chats"></div><div class="bubbles"></div><div id="column-center"></div>',
      ),
    );
    expect(detector.detect().client).toBe('webk');
  });

  it('falls back to Web A DOM signatures on an ambiguous path', () => {
    const detector = new TelegramDetector(
      mockDoc(
        'web.telegram.org',
        '/',
        '<div id="Main" class="Main"><div id="LeftColumn"></div><div id="MiddleColumn"><div class="MessageList"></div></div></div>',
      ),
    );
    const result = detector.detect();
    expect(result.client).toBe('weba');
    expect(result.loggedIn).toBe(true);
    expect(result.domReady).toBe(true);
  });

  it('treats the legacy /z/ path as Web A and ignores look-alike paths', () => {
    expect(
      new TelegramDetector(mockDoc('web.telegram.org', '/z/', '')).detect().client,
    ).toBe('weba');
    expect(
      new TelegramDetector(mockDoc('web.telegram.org', '/about', '')).detect().client,
    ).toBe('unknown');
  });

  it('rejects look-alike hosts', () => {
    const result = new TelegramDetector(
      mockDoc('evilweb.telegram.org.example.com', '/k/', ''),
    ).detect();
    expect(result.supported).toBe(false);
    expect(
      new TelegramDetector(mockDoc('notweb.telegram.org', '/k/', '')).detect().supported,
    ).toBe(false);
  });

  it('reports Web K as logged out while an auth page is active', () => {
    const detector = new TelegramDetector(
      mockDoc(
        'web.telegram.org',
        '/k/',
        '<div id="auth-pages"><div class="tabs-container"><div class="tabs-tab page-signQR active"></div></div></div>' +
          '<div id="page-chats"><div id="main-columns"><div id="column-center"></div></div></div>',
      ),
    );
    const result = detector.detect();
    expect(result.client).toBe('webk');
    expect(result.loggedIn).toBe(false);
    expect(result.reason).toMatch(/not logged in/);
  });

  it('reports Web A as logged out on the QR login screen', () => {
    const detector = new TelegramDetector(
      mockDoc('web.telegram.org', '/', '<div id="auth-qr-form"></div>'),
    );
    const result = detector.detect();
    expect(result.client).toBe('weba');
    expect(result.loggedIn).toBe(false);
  });
});
