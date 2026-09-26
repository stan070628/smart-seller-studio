// src/components/erp/stock/api.ts
// 재고 화면의 서버 호출. 실패는 던지지 않고 { ok: false }로 돌려준다 — 화면이 메시지를 그대로 보인다.
import type { AdjustResult } from '@/lib/erp/ledger/adjust-store';
import type { HistoryRow, RecentAdjust, RgReconResponse, StockListRow } from '@/lib/erp/stock/queries';
import type { ImportSummary } from '@/lib/erp/ledger/opening-import';
import type { CountQueueResponse } from '@/lib/erp/stock/count-queue';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string; index?: number };

export interface AdjustItemBody {
  skuId: number;
  location: 'self' | 'rg_inbound';
  mode: 'count' | 'delta';
  value: number;
  expected?: number;
  reason: string;
  note?: string;
  unitCost: number | null;
  requestId: string;
}

export interface RgApplyItem {
  skuId: number;
  expected: number;
  actual: number;
  requestId: string;
  unitCost: number | null;
}

export interface RgArriveItem {
  skuId: number;
  qty: number;
  requestId: string;
}

export interface ImportBody {
  csv: string;
  fileName: string;
  countedAt: string;
  unitCostOverrides: Record<string, number>;
  commit: boolean;
}

async function call<T>(url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(
      url,
      body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      return { ok: false, status: res.status, error: json?.error ?? `요청 실패 (${res.status})`, code: json?.code, index: json?.index };
    }
    return { ok: true, data: json.data as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : '네트워크 오류' };
  }
}

export const fetchStock = () => call<StockListRow[]>('/api/erp/stock');
export const postAdjust = (items: AdjustItemBody[]) => call<AdjustResult[]>('/api/erp/stock/adjust', { items });
export const fetchHistory = (skuId: number) => call<HistoryRow[]>(`/api/erp/stock/${skuId}/history`);
export const postReverse = (idemKey: string) => call<{ ids: number[] }>('/api/erp/stock/reverse', { idemKey });
export const fetchRecent = (limit: number) => call<RecentAdjust[]>(`/api/erp/stock/recent?limit=${limit}`);
export const fetchRecon = () => call<RgReconResponse>('/api/erp/stock/rg-reconcile');
export const postRgApply = (items: RgApplyItem[]) => call<AdjustResult[]>('/api/erp/stock/rg-reconcile', { items });
export const postRgArrive = (items: RgArriveItem[]) =>
  call<{ skuId: number; qty: number; requestId: string; outcome: 'posted' | 'duplicate' }[]>('/api/erp/stock/rg-arrive', { items });
export const fetchCountQueue = (n: number) => call<CountQueueResponse>(`/api/erp/stock/count-queue?n=${n}`);

/**
 * 실사표 불러오기. `commit:true`인데 검사 오류가 있으면 서버가 422 `{ success:false, data:<오류가 담긴 요약> }`로
 * 응답한다 — 실패가 아니라 「오류를 보여줄 요약」이다. 화면이 오류 목록을 그리려면 이 data가 필요하므로
 * 여기서만 422+data를 성공으로 취급한다(다른 라우트의 실패 응답에는 data가 없다).
 */
export async function postImport(body: ImportBody): Promise<ApiResult<ImportSummary>> {
  try {
    const res = await fetch('/api/erp/stock/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (res.status === 422 && json?.data) return { ok: true, data: json.data as ImportSummary };
    if (!res.ok || !json?.success) {
      return { ok: false, status: res.status, error: json?.error ?? `요청 실패 (${res.status})`, code: json?.code, index: json?.index };
    }
    return { ok: true, data: json.data as ImportSummary };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : '네트워크 오류' };
  }
}
