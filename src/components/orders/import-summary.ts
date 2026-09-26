export interface BulkImportJson {
  success: boolean;
  data?: { imported: number; skipped: number; total: number; voided?: number };
  error?: string;
}

export interface ChannelImportResult {
  channel: string;
  success: boolean;
  imported: number;
  skipped: number;
  total: number;
  voided: number;
  error?: string;
}

export interface ImportSummary {
  channels: ChannelImportResult[];
  totalImported: number;
  totalVoided: number;
  hasError: boolean;
}

export function buildImportSummary(
  results: { channel: string; json: BulkImportJson }[],
): ImportSummary {
  const channels: ChannelImportResult[] = results.map(({ channel, json }) => {
    if (json.success) {
      return {
        channel,
        success: true,
        imported: json.data?.imported ?? 0,
        skipped: json.data?.skipped ?? 0,
        total: json.data?.total ?? 0,
        voided: json.data?.voided ?? 0,
      };
    }
    return {
      channel,
      success: false,
      imported: 0,
      skipped: 0,
      total: 0,
      voided: 0,
      error: json.error ?? '실패',
    };
  });

  return {
    channels,
    totalImported: channels.reduce((sum, c) => sum + c.imported, 0),
    totalVoided: channels.reduce((sum, c) => sum + c.voided, 0),
    hasError: channels.some((c) => !c.success),
  };
}

/** 주문 수집 보고서(ERP 1-C2a, /api/erp/orders/sync)에서 결과 창에 필요한 칸만 */
export interface OrdersSyncReportLike {
  channel: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  legacy?: { voided: number; [key: string]: unknown };
  error: string | null;
}

const SYNC_LABEL: Record<string, string> = { coupang_wing: '윙', coupang_rg: 'RG', naver: '네이버', toss: '토스' };

/** 원가관리 「판매 가져오기」 결과 창을 새 수집 결과로 채운다. 신규 = 새 라인 · 스킵 = 이미 있던 라인 갱신 · 취소 = 옛 장부 무효화 */
export function summarizeOrdersSync(reports: OrdersSyncReportLike[]): ImportSummary {
  const channels: ChannelImportResult[] = reports.map((r) =>
    r.ok
      ? { channel: SYNC_LABEL[r.channel] ?? r.channel, success: true, imported: r.inserted, skipped: r.updated, total: r.fetched, voided: r.legacy?.voided ?? 0 }
      : { channel: SYNC_LABEL[r.channel] ?? r.channel, success: false, imported: 0, skipped: 0, total: 0, voided: 0, error: r.error ?? '실패' },
  );
  return {
    channels,
    totalImported: channels.reduce((s, c) => s + c.imported, 0),
    totalVoided: channels.reduce((s, c) => s + c.voided, 0),
    hasError: channels.some((c) => !c.success),
  };
}
