import { describe, it, expect } from 'vitest';
import { buildImportSummary } from '@/components/orders/import-summary';

describe('buildImportSummary', () => {
  it('세 채널 모두 성공하면 채널별 결과와 총 신규 건수를 집계한다', () => {
    const summary = buildImportSummary([
      { channel: 'RG', json: { success: true, data: { imported: 3, skipped: 1, total: 4 } } },
      { channel: '윙', json: { success: true, data: { imported: 2, skipped: 0, total: 2 } } },
      { channel: '네이버', json: { success: true, data: { imported: 0, skipped: 5, total: 5 } } },
    ]);
    expect(summary.channels).toEqual([
      { channel: 'RG', success: true, imported: 3, skipped: 1, total: 4, voided: 0 },
      { channel: '윙', success: true, imported: 2, skipped: 0, total: 2, voided: 0 },
      { channel: '네이버', success: true, imported: 0, skipped: 5, total: 5, voided: 0 },
    ]);
    expect(summary.totalImported).toBe(5);
    expect(summary.hasError).toBe(false);
  });

  it('실패한 채널은 error를 담고 hasError를 true로 만든다', () => {
    const summary = buildImportSummary([
      { channel: 'RG', json: { success: true, data: { imported: 1, skipped: 0, total: 1 } } },
      { channel: '윙', json: { success: false, error: '토큰 만료' } },
    ]);
    expect(summary.channels[1]).toEqual({
      channel: '윙', success: false, imported: 0, skipped: 0, total: 0, voided: 0, error: '토큰 만료',
    });
    expect(summary.hasError).toBe(true);
    expect(summary.totalImported).toBe(1);
  });

  it('data가 없거나 error가 없어도 안전한 기본값을 채운다', () => {
    const summary = buildImportSummary([
      { channel: '네이버', json: { success: false } },
    ]);
    expect(summary.channels[0]).toEqual({
      channel: '네이버', success: false, imported: 0, skipped: 0, total: 0, voided: 0, error: '실패',
    });
  });

  it('voided 건수를 채널별로 집계한다', () => {
    const summary = buildImportSummary([
      { channel: 'RG', json: { success: true, data: { imported: 1, skipped: 0, total: 1, voided: 0 } } },
      { channel: '윙', json: { success: true, data: { imported: 2, skipped: 0, total: 2, voided: 3 } } },
    ]);
    expect(summary.channels[1].voided).toBe(3);
    expect(summary.totalVoided).toBe(3);
  });

  it('voided 필드가 없으면 0으로 처리', () => {
    const summary = buildImportSummary([
      { channel: '네이버', json: { success: true, data: { imported: 0, skipped: 0, total: 0 } } },
    ]);
    expect(summary.channels[0].voided).toBe(0);
    expect(summary.totalVoided).toBe(0);
  });
});
