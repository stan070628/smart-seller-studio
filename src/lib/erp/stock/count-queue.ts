// src/lib/erp/stock/count-queue.ts
// 「오늘 셀 목록」(순환 실사, 2026-09-26 결정 5) — 집(self)에서 오늘 셀 SKU N개를 고른다. 날마다 저장하지 않고 요청 때 계산한다.
// 우선순위: ① 한 번도 안 센 SKU — 집 재고 금액 큰 순 ② 마지막 실사가 오래된 순(같으면 금액 큰 순). 그래도 같으면 SKU id 순.
// 빠지는 것: 오늘(KST) 이미 센 SKU · 원장 전표가 하나도 없는 SKU(재고 0이고 전표도 없다 = 판매하지 않는 옵션).
// 순수 함수 — 서버(라우트)와 화면(마지막 실사 날짜 표시)이 같이 쓴다.
import type { StockListRow } from './queries';

export const DEFAULT_QUEUE_N = 8;
export const MAX_QUEUE_N = 30;

export type QueueCandidate = Pick<StockListRow, 'skuId' | 'selfValue' | 'hasLedger'>;

/** GET /api/erp/stock/count-queue 응답 */
export interface CountQueueResponse {
  /** 오늘(KST, YYYY-MM-DD) */
  today: string;
  n: number;
  items: StockListRow[];
}

/** ISO(또는 Date) → KST 날짜 YYYY-MM-DD */
export function kstDate(v: string | Date): string {
  const t = typeof v === 'string' ? Date.parse(v) : v.getTime();
  return new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * @param counts SKU → 집 마지막 실사 시각(ISO). 없으면 한 번도 안 셌다
 * @param opts.today 오늘(KST YYYY-MM-DD) — 이날 센 SKU는 빠진다
 */
export function pickCountQueue<T extends QueueCandidate>(
  rows: T[],
  counts: ReadonlyMap<number, string>,
  opts: { n?: number; today: string },
): T[] {
  const n = opts.n ?? DEFAULT_QUEUE_N;
  const last = (r: T): number | null => {
    const v = counts.get(r.skuId);
    return v === undefined ? null : Date.parse(v);
  };
  return rows
    .filter((r) => {
      if (!r.hasLedger) return false;
      const v = counts.get(r.skuId);
      return v === undefined || kstDate(v) < opts.today;
    })
    .sort((a, b) => {
      const la = last(a);
      const lb = last(b);
      if ((la === null) !== (lb === null)) return la === null ? -1 : 1;
      if (la !== null && lb !== null && la !== lb) return la - lb;
      if (a.selfValue !== b.selfValue) return b.selfValue - a.selfValue;
      return a.skuId - b.skuId;
    })
    .slice(0, Math.max(0, n));
}
