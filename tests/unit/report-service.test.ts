import { describe, it, expect } from 'vitest';
import {
  ReportService,
  CSV_BOM,
  type ReportRow,
} from '../../src/features/reporting/report-service.js';
import { makeItem } from '../helpers/factories.js';

const HEADER = 'filename,type,date,size,messageId,chat,peerId,albumIndex,url,downloaded';

function csvLines(content: string): string[] {
  return content.slice(CSV_BOM.length).split('\r\n');
}

describe('ReportService', () => {
  const service = new ReportService();
  const items = [
    makeItem({
      id: '1',
      type: 'photo',
      fileName: 'photo1.jpg',
      date: '2026-06-19',
      size: '2.4 MB',
      messageId: '101',
      chatTitle: 'Aile Grubu — Şükrü',
      peerId: '-100123',
      albumIndex: 2,
      url: 'blob:https://web.telegram.org/abc',
    }),
  ];

  it('generates CSV with a UTF-8 BOM and a header row', () => {
    const report = service.generate(items, 'csv');
    expect(report.mimeType).toContain('text/csv');
    expect(report.content.startsWith('﻿')).toBe(true);
    const [header, row] = csvLines(report.content);
    expect(header).toBe(HEADER);
    expect(row).toBe(
      'photo1.jpg,photo,2026-06-19,2.4 MB,101,Aile Grubu — Şükrü,-100123,2,,',
    );
  });

  it('never exports blob URLs but keeps http(s) URLs', () => {
    const report = service.generate(
      [
        makeItem({ id: 'a', url: 'blob:https://web.telegram.org/x' }),
        makeItem({ id: 'b', url: 'data:image/png;base64,AAA' }),
        makeItem({ id: 'c', url: 'https://cdn.example.org/file.jpg' }),
      ],
      'json',
    );
    const rows = JSON.parse(report.content) as ReportRow[];
    expect(rows.map((r) => r.url)).toEqual(['', '', 'https://cdn.example.org/file.jpg']);
  });

  it('exports downloaded yes/no when a history lookup is provided', () => {
    const two = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const ctx = { isDownloaded: (id: string) => id === 'a' };
    const lines = csvLines(service.generate(two, 'csv', ctx).content);
    expect(lines[1]?.endsWith(',yes')).toBe(true);
    expect(lines[2]?.endsWith(',no')).toBe(true);
    const json = JSON.parse(service.generate(two, 'json', ctx).content) as ReportRow[];
    expect(json.map((r) => r.downloaded)).toEqual([true, false]);
    const unknown = JSON.parse(service.generate(two, 'json').content) as ReportRow[];
    expect(unknown[0]?.downloaded).toBeNull();
  });

  it('escapes CSV fields containing commas and quotes', () => {
    const tricky = [makeItem({ id: 'x', type: 'document', fileName: 'a,"b".pdf' })];
    const report = service.generate(tricky, 'csv');
    expect(report.content).toContain('"a,""b"".pdf"');
  });

  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1+2', "'+1+2"],
    ['-2+3', "'-2+3"],
    ['@cmd', "'@cmd"],
    ['\t=1', "'\t=1"],
    ['\r=1', '"\'\r=1"'],
  ])('neutralises formula injection for %j', (value, expected) => {
    const danger = [makeItem({ id: 'x', type: 'document', fileName: value })];
    const row = csvLines(service.generate(danger, 'csv').content)[1] ?? '';
    expect(row.startsWith(`${expected},`)).toBe(true);
  });

  it('does not mangle plain negative numbers such as channel peer ids', () => {
    const row = csvLines(
      service.generate([makeItem({ id: 'x', fileName: '-42', peerId: '-100123' })], 'csv')
        .content,
    )[1];
    expect(row?.startsWith('-42,')).toBe(true);
    expect(row).toContain(',-100123,');
  });

  it('guards injection in every column, not only the file name', () => {
    const report = service.generate(
      [makeItem({ id: 'x', fileName: 'ok', chatTitle: '=HYPERLINK("x")' })],
      'csv',
    );
    expect(report.content).toContain('"\'=HYPERLINK(""x"")"');
  });

  it('generates JSON with the same fields as the CSV header', () => {
    const report = service.generate(items, 'json');
    expect(report.mimeType).toContain('application/json');
    const parsed = JSON.parse(report.content) as ReportRow[];
    expect(Object.keys(parsed[0]!).join(',')).toBe(HEADER);
    expect(parsed[0]).toMatchObject({
      filename: 'photo1.jpg',
      type: 'photo',
      chat: 'Aile Grubu — Şükrü',
      peerId: '-100123',
      albumIndex: 2,
      url: '',
    });
  });

  it('produces a timestamped file name', () => {
    const report = service.generate(items, 'csv');
    expect(report.fileName).toMatch(/^telegram-media-.*\.csv$/);
  });
});
