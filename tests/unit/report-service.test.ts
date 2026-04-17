import { describe, it, expect } from 'vitest';
import { ReportService } from '../../src/features/reporting/report-service.js';
import { makeItem } from '../helpers/factories.js';

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
    }),
  ];

  it('generates CSV with a header row', () => {
    const report = service.generate(items, 'csv');
    expect(report.mimeType).toContain('text/csv');
    const [header, row] = report.content.split('\r\n');
    expect(header).toBe('filename,type,date,size,messageId');
    expect(row).toContain('photo1.jpg');
    expect(row).toContain('2.4 MB');
  });

  it('escapes CSV fields containing commas and quotes', () => {
    const tricky = [makeItem({ id: 'x', type: 'document', fileName: 'a,"b".pdf' })];
    const report = service.generate(tricky, 'csv');
    expect(report.content).toContain('"a,""b"".pdf"');
  });

  it('neutralises formula injection', () => {
    const danger = [makeItem({ id: 'x', type: 'document', fileName: '=SUM(A1)' })];
    const report = service.generate(danger, 'csv');
    expect(report.content).toContain("'=SUM(A1)");
  });

  it('generates JSON', () => {
    const report = service.generate(items, 'json');
    expect(report.mimeType).toContain('application/json');
    const parsed = JSON.parse(report.content) as Array<{
      filename: string;
      type: string;
    }>;
    expect(parsed[0]?.filename).toBe('photo1.jpg');
    expect(parsed[0]?.type).toBe('photo');
  });

  it('produces a timestamped file name', () => {
    const report = service.generate(items, 'csv');
    expect(report.fileName).toMatch(/^telegram-media-.*\.csv$/);
  });
});
