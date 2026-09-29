import { describe, it, expect, beforeEach } from 'vitest';
import {
  currentChatTitle,
  currentPeerId,
  parsePeerHash,
  splitSelectorList,
} from '../../src/content/peer.js';
import { loadDomFixture, setLocation } from '../fixtures/dom/load-fixture.js';

describe('parsePeerHash', () => {
  it.each([
    ['', undefined],
    ['#', undefined],
    ['#123', '123'],
    ['#777000', '777000'],
    ['#-100123', '-100123'],
    ['#-1234567890', '-1234567890'],
    ['#@durov', '@durov'],
    ['#@Some_Channel', '@some_channel'],
    ['#durov', '@durov'],
    ['#-100123_456', '-100123'],
    ['#123_456', '123'],
    ['#-1001234_2_thread', '-1001234'],
    ['#-100123?start=abc', '-100123'],
    ['#%40encoded_name', '@encoded_name'],
    ['#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3Dtelegram', '@telegram'],
    ['#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3Dtelegram%26post%3D5', '@telegram'],
    ['#?tgaddr=tg%3A%2F%2Fprivatepost%3Fchannel%3D1234%26post%3D9', '-1234'],
    ['#?tgaddr=tg%3A%2F%2Fuser%3Fid%3D42', '42'],
    ['#?tgaddr=tg%3A%2F%2Fresolve%3Fphone%3D15551234', '+15551234'],
    ['#?tgaddr=tg%3A%2F%2Fjoin%3Finvite%3Dabc', undefined],
    ['#?tgaddr=%25%25bad', undefined],
    ['#?foo=bar', undefined],
    ['#!/weird', undefined],
    ['#ab', undefined],
  ])('%s → %s', (hash, expected) => {
    expect(parsePeerHash(hash)).toBe(expected);
  });
});

describe('currentPeerId / currentChatTitle', () => {
  beforeEach(() => setLocation('https://web.telegram.org/k/'));

  it('reads the peer from the hash first', () => {
    setLocation('https://web.telegram.org/k/#@durov');
    loadDomFixture('webk-chat');
    expect(currentPeerId(document, 'webk')).toBe('@durov');
  });

  it('falls back to the chat header avatar on Web K', () => {
    loadDomFixture('webk-chat');
    expect(currentPeerId(document, 'webk')).toBe('-1001234567890');
    expect(currentChatTitle(document, 'webk')).toBe('Design Team');
  });

  it('reads Web A header peer and title', () => {
    setLocation('https://web.telegram.org/a/');
    loadDomFixture('weba-chat');
    expect(currentPeerId(document, 'weba')).toBe('-1009876543210');
    expect(currentChatTitle(document, 'weba')).toBe('Photo Club');
  });

  it('returns undefined without a chat', () => {
    document.body.innerHTML = '<div class="bubbles"></div>';
    expect(currentPeerId(document, 'webk')).toBeUndefined();
    expect(currentChatTitle(document, 'webk')).toBeUndefined();
  });

  it('splits priority selector lists', () => {
    expect(splitSelectorList(' .a .b, .c ,, #d ')).toEqual(['.a .b', '.c', '#d']);
  });
});
