import type { MediaItem } from '../../shared/types/index.js';

export type ReportFormat = 'csv' | 'json';

export interface GeneratedReport {
  readonly content: string;
  readonly mimeType: string;
  readonly fileName: string;
}

export interface ReportContext {
  /** Download-history lookup; without it the `downloaded` column stays empty. */
  readonly isDownloaded?: (id: string) => boolean;
}

/** Excel only detects UTF-8 (e.g. Turkish characters) when a BOM is present. */
export const CSV_BOM = '﻿';

export const REPORT_COLUMNS = [
  'filename',
  'type',
  'date',
  'size',
  'messageId',
  'chat',
  'peerId',
  'albumIndex',
  'url',
  'downloaded',
] as const;

type Column = (typeof REPORT_COLUMNS)[number];

/** One report record; JSON uses it verbatim, CSV stringifies each column. */
export interface ReportRow {
  readonly filename: string;
  readonly type: string;
  readonly date: string;
  readonly size: string;
  readonly messageId: string;
  readonly chat: string;
  readonly peerId: string;
  readonly albumIndex: number | null;
  /** Only http(s) URLs; blob/data URLs are meaningless outside the tab. */
  readonly url: string;
  readonly downloaded: boolean | null;
}

export class ReportService {
  generate(
    items: readonly MediaItem[],
    format: ReportFormat,
    ctx: ReportContext = {},
  ): GeneratedReport {
    const rows = items.map((item) => toRow(item, ctx));
    return format === 'csv' ? toCsv(rows) : toJson(rows);
  }
}

function toRow(item: MediaItem, ctx: ReportContext): ReportRow {
  return {
    filename: item.fileName ?? '',
    type: item.type,
    date: item.date ?? '',
    size: item.size ?? '',
    messageId: item.messageId ?? '',
    chat: item.chatTitle ?? '',
    peerId: item.peerId ?? '',
    albumIndex: item.albumIndex ?? null,
    url: item.url !== undefined && /^https?:\/\//i.test(item.url) ? item.url : '',
    downloaded: ctx.isDownloaded ? ctx.isDownloaded(item.id) : null,
  };
}

function toCsv(rows: readonly ReportRow[]): GeneratedReport {
  const lines = [REPORT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      REPORT_COLUMNS.map((column) => escapeCsv(cellText(row, column))).join(','),
    );
  }
  return {
    content: CSV_BOM + lines.join('\r\n'),
    mimeType: 'text/csv;charset=utf-8',
    fileName: `telegram-media-${timestamp()}.csv`,
  };
}

function toJson(rows: readonly ReportRow[]): GeneratedReport {
  return {
    content: JSON.stringify(rows, null, 2),
    mimeType: 'application/json;charset=utf-8',
    fileName: `telegram-media-${timestamp()}.json`,
  };
}

function cellText(row: ReportRow, column: Column): string {
  const value = row[column];
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function escapeCsv(value: string): string {
  // Neutralise spreadsheet formula injection (= + - @ TAB CR leading chars).
  // Plain negative numbers (e.g. channel peer ids) are not formulas.
  const risky = /^[=+\-@\t\r]/.test(value) && !/^-\d+(\.\d+)?$/.test(value);
  const guarded = risky ? `'${value}` : value;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
