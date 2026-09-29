import { describe, it, expect } from 'vitest';
import {
  MessageDateReader,
  parseDay,
  parseTimeOfDay,
} from '../../src/content/media-scanner.js';
import { selectorsFor } from '../../src/shared/constants/selectors.js';

const NOW = new Date(2026, 0, 10, 12, 0, 0);

describe('parseDay', () => {
  it.each([
    ['2025-06-05T10:00:00Z', { year: 2025, month: 6, day: 5 }],
    ['05.06.2025, 10:00', { year: 2025, month: 6, day: 5 }],
    ['6/5/25', { year: 2025, month: 6, day: 5 }],
    ['25/12/2025', { year: 2025, month: 12, day: 25 }],
    ['Thursday, June 5, 2025 at 10:00 AM', { year: 2025, month: 6, day: 5 }],
    ['5 June 2025, 10:00:02', { year: 2025, month: 6, day: 5 }],
    ['Jun 5th', { year: 2025, month: 6, day: 5 }],
    ['January 3', { year: 2026, month: 1, day: 3 }],
    ['Today', { year: 2026, month: 1, day: 10 }],
    ['Yesterday', { year: 2026, month: 1, day: 9 }],
    ['четверг, 5 июня', undefined],
    ['10:00', undefined],
    ['', undefined],
    ['31.13.2025', undefined],
  ])('%s', (text, expected) => {
    expect(parseDay(text, NOW)).toEqual(expected);
  });
});

describe('parseTimeOfDay', () => {
  it.each([
    ['10:00', { hours: 10, minutes: 0, seconds: 0 }],
    ['edited 09:15', { hours: 9, minutes: 15, seconds: 0 }],
    ['8:30 PM', { hours: 20, minutes: 30, seconds: 0 }],
    ['12:05 a.m.', { hours: 0, minutes: 5, seconds: 0 }],
    ['10:00:02', { hours: 10, minutes: 0, seconds: 2 }],
    ['10:00 at home', { hours: 10, minutes: 0, seconds: 0 }],
    ['25:00', undefined],
    ['no time', undefined],
  ])('%s', (text, expected) => {
    expect(parseTimeOfDay(text)).toEqual(expected);
  });
});

describe('MessageDateReader', () => {
  const reader = new MessageDateReader(
    selectorsFor('webk'),
    () => false,
    () => NOW,
  );

  function bubble(html: string, attrs: Record<string, string> = {}): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bubble';
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  it('prefers the message element attribute over descendants', () => {
    const el = bubble('<span class="time" data-timestamp="1700000000"></span>', {
      'data-timestamp': '1749117600',
    });
    expect(reader.read(el, el).timestamp).toBe(1749117600 * 1000);
  });

  it('accepts millisecond timestamps and ISO datetime attributes', () => {
    expect(
      reader.read(bubble('', { 'data-timestamp': '1749117600000' }), bubble(''))
        .timestamp,
    ).toBe(1749117600000);
    const iso = bubble('<time datetime="2025-06-05T10:00:00Z"></time>');
    expect(reader.read(iso, iso).date).toBe('2025-06-05T10:00:00.000Z');
  });

  it('does not Date.parse localised datetime strings', () => {
    const el = bubble('<time datetime="5 juin 2025"></time>');
    expect(reader.read(el, el)).toEqual({});
  });

  it('uses the time title when it carries a full date', () => {
    const el = bubble('<span class="time" title="5 June 2025, 10:00:02">10:00</span>');
    expect(reader.read(el, el).timestamp).toBe(new Date(2025, 5, 5, 10, 0, 2).getTime());
  });

  it('reads a data-timestamp on the date group header', () => {
    const group = document.createElement('section');
    group.className = 'bubbles-date-group';
    const header = document.createElement('div');
    header.className = 'bubble service is-date';
    header.setAttribute('data-timestamp', String(new Date(2025, 2, 1).getTime() / 1000));
    group.appendChild(header);
    const el = bubble('<span class="time">18:45</span>');
    group.appendChild(el);
    document.body.appendChild(group);
    expect(reader.read(el, el).timestamp).toBe(new Date(2025, 2, 1, 18, 45).getTime());
  });

  it('returns nothing when no source is parseable', () => {
    const el = bubble('<span class="time">10:00</span>');
    expect(reader.read(el, el)).toEqual({});
  });
});
