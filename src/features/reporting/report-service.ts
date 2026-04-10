import type { MediaItem } from '../../shared/types/index.js';

export type ReportFormat = 'csv' | 'json';

export interface GeneratedReport {
  readonly content: string;
  readonly mimeType: string;
  readonly fileName: string;
}

const COLUMNS = ['filename', 'type', 'date', 'size', 'messageId'] as const;

export class ReportService {
  generate(items: readonly MediaItem[], format: ReportFormat): GeneratedReport {
    return format === 'csv' ? this.toCsv(items) : this.toJson(items);
  }

  private toCsv(items: readonly MediaItem[]): GeneratedReport {
    const header = COLUMNS.join(',');
    const rows = items.map((item) =>
      COLUMNS.map((column) => escapeCsv(fieldValue(item, column))).join(','),
    );
    const content = [header, ...rows].join('\r\n');
    return {
      content,
      mimeType: 'text/csv;charset=utf-8',
      fileName: `telegram-media-${timestamp()}.csv`,
    };
  }

  private toJson(items: readonly MediaItem[]): GeneratedReport {
    const data = items.map((item) => ({
      filename: item.fileName ?? '',
      type: item.type,
      date: item.date ?? '',
      size: item.size ?? '',
      messageId: item.messageId ?? '',
    }));
    return {
      content: JSON.stringify(data, null, 2),
      mimeType: 'application/json;charset=utf-8',
      fileName: `telegram-media-${timestamp()}.json`,
    };
  }
}

function fieldValue(item: MediaItem, column: (typeof COLUMNS)[number]): string {
  switch (column) {
    case 'filename':
      return item.fileName ?? '';
    case 'type':
      return item.type;
    case 'date':
      return item.date ?? '';
    case 'size':
      return item.size ?? '';
    case 'messageId':
      return item.messageId ?? '';
    default:
      return '';
  }
}

function escapeCsv(value: string): string {
  // Neutralise spreadsheet formula injection (=, +, -, @ leading chars).
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
