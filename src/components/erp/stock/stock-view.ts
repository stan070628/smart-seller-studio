// src/components/erp/stock/stock-view.ts
// 재고현황 화면의 순수 계산 — 필터·KPI·편집 차이·요청 본문·내보내기. 컴포넌트는 그리기만 한다(PC·휴대폰 공용).
import type { StockListRow, RgReconResponse } from '@/lib/erp/stock/queries';
import type { OpeningIssue } from '@/lib/erp/ledger/opening';
import type { UserReason } from '@/lib/erp/ledger/adjust';
import type { AdjustItemBody } from './api';

export type StockRow = StockListRow;
/** 사람이 고치는 위치. RG는 「RG 실재고 대조」로만 고친다 */
export type EditLocation = 'self' | 'rg_inbound';

export interface RgRecon {
  fetchedAt: string;
  actual: Map<number, number>;
  issues: OpeningIssue[];
  inactive: { skuId: number; qty: number }[];
}

export interface Filters {
  q: string;
  onlyStocked: boolean;
  onlyRgMismatch: boolean;
}

export interface StagedEdit {
  skuId: number;
  location: EditLocation;
  mode: 'count' | 'delta';
  value: number;
  /** 편집을 시작할 때 화면이 본 원장 재고 — 서버가 다르면 409 */
  expected: number;
  reason: UserReason;
  note: string;
  /** 늘어날 때만 */
  unitCost: number | null;
}

export const won = (n: number) => n.toLocaleString('ko-KR');
export const stageKey = (skuId: number, loc: EditLocation) => `${skuId}:${loc}`;
export const defaultCost = (r: StockRow): number | null => r.lotCost ?? r.legacyCost;
export const onHandAt = (r: StockRow, loc: EditLocation): number => (loc === 'self' ? r.self : r.rgInbound);
export const totalOf = (r: StockRow): number => r.self + r.rgInbound + r.rg;
export const LOC_LABEL: Record<'self' | 'rg_inbound' | 'rg', string> = { self: '집', rg_inbound: 'RG입고중', rg: 'RG' };

export function rgActual(r: StockRow, recon: RgRecon | null): number | null {
  return recon ? (recon.actual.get(r.skuId) ?? 0) : null;
}

export function rgDiff(r: StockRow, recon: RgRecon | null): number | null {
  const a = rgActual(r, recon);
  return a === null ? null : a - r.rg;
}

/**
 * 「입고 완료 m개 옮기기」의 m = min(RG입고중, RG 실재고 − 원장 RG). 대조 전이거나 RG 실재고가 원장 이하, 입고중 0이면 0.
 * 보낸 물건이 RG에 들어가 실재고가 늘어난 것을 「반영」(rg 지금 개수 조정)으로 맞추면 입고중이 그대로 남아 두 번 센다 —
 * 먼저 입고중에서 옮기고, 남은 차이만 「반영」한다.
 */
export function rgArriveQty(r: StockRow, recon: RgRecon | null): number {
  const d = rgDiff(r, recon);
  if (d === null || d <= 0 || r.rgInbound <= 0) return 0;
  return Math.min(r.rgInbound, d);
}

export function editDiff(e: Pick<StagedEdit, 'mode' | 'value' | 'expected'>): number {
  return e.mode === 'count' ? e.value - e.expected : e.value;
}

export function filterRows(rows: StockRow[], f: Filters, recon: RgRecon | null): StockRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.name} ${r.option} ${r.key}`.toLowerCase().includes(q)) return false;
    if (f.onlyStocked && totalOf(r) === 0) return false;
    if (f.onlyRgMismatch && !rgDiff(r, recon)) return false;
    return true;
  });
}

/** 조회조건이 하나라도 걸려 있다 — 표가 묶음을 모두 펼친다 */
export const filtersActive = (f: Filters): boolean => f.q.trim() !== '' || f.onlyStocked || f.onlyRgMismatch;

/** 상품 단위 묶음 — erp.skus.name(쿠팡 상품명)이 같은 옵션들. 합계는 전체 옵션 기준 */
export interface StockGroup {
  name: string;
  options: StockRow[];
  self: number;
  rgInbound: number;
  /** 원장 RG 합 */
  rg: number;
  value: number;
  /** RG 실재고 합. 대조 전이면 null */
  rgActual: number | null;
  /** RG 차이가 있는 옵션 수(합이 상쇄돼도 옵션 단위로 센다). 대조 전이면 null */
  rgMismatch: number | null;
}

/** 표에 그릴 묶음 하나 — shown은 조회조건에 맞는 옵션만 */
export interface GroupView {
  group: StockGroup;
  shown: StockRow[];
}

/** 상품명으로 묶는다. 순서는 처음 나온 순서(목록 API가 상품명·옵션 순으로 준다). 옵션 1개 상품도 묶음 하나다(표가 한 줄로 그린다) */
export function groupRows(rows: StockRow[], recon: RgRecon | null): StockGroup[] {
  const byName = new Map<string, StockRow[]>();
  for (const r of rows) {
    const list = byName.get(r.name);
    if (list) list.push(r);
    else byName.set(r.name, [r]);
  }
  return [...byName].map(([name, options]) => {
    const sum = (f: (r: StockRow) => number) => options.reduce((s, r) => s + f(r), 0);
    return {
      name,
      options,
      self: sum((r) => r.self),
      rgInbound: sum((r) => r.rgInbound),
      rg: sum((r) => r.rg),
      value: sum((r) => r.value),
      rgActual: recon ? sum((r) => rgActual(r, recon) ?? 0) : null,
      rgMismatch: recon ? options.filter((r) => (rgDiff(r, recon) ?? 0) !== 0).length : null,
    };
  });
}

/** 조회조건은 옵션에 건다 — 맞는 옵션이 하나라도 있으면 묶음을 남기고 그 옵션만 보인다(묶음 합계는 전체 옵션 그대로) */
export function filterGroups(groups: StockGroup[], f: Filters, recon: RgRecon | null): GroupView[] {
  return groups.map((group) => ({ group, shown: filterRows(group.options, f, recon) })).filter((v) => v.shown.length > 0);
}

export interface Kpis {
  total: number;
  self: number;
  rgInbound: number;
  rg: number;
  value: number;
  /** 대조 전이면 null */
  rgMismatch: number | null;
}

export function computeKpis(rows: StockRow[], recon: RgRecon | null): Kpis {
  const sum = (f: (r: StockRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    total: sum(totalOf),
    self: sum((r) => r.self),
    rgInbound: sum((r) => r.rgInbound),
    rg: sum((r) => r.rg),
    value: sum((r) => r.value),
    rgMismatch: recon ? rows.filter((r) => rgDiff(r, recon) !== 0).length : null,
  };
}

/** 편집 → /api/erp/stock/adjust 본문. 요청마다 새 id(멱등 — 두 번 눌러도 한 번만 기록된다) */
export function toAdjustItems(list: StagedEdit[], newId: () => string): AdjustItemBody[] {
  return list.map((e) => ({
    skuId: e.skuId,
    location: e.location,
    mode: e.mode,
    value: e.value,
    ...(e.mode === 'count' ? { expected: e.expected } : {}),
    reason: e.reason,
    ...(e.note ? { note: e.note } : {}),
    unitCost: e.unitCost,
    requestId: newId(),
  }));
}

/** 실사 모드 저장 전 확인 창의 숫자. same = 차이 없는 지금 개수(센 기록만 남는다). 평가액 영향은 추정(줄 때는 최근 단가, 늘 때는 입력 단가) */
export function summarizeStaged(
  list: StagedEdit[],
  rowById: Map<number, StockRow>,
): { count: number; plus: number; minus: number; same: number; valueDelta: number } {
  let plus = 0;
  let minus = 0;
  let same = 0;
  let valueDelta = 0;
  for (const e of list) {
    const d = editDiff(e);
    if (d === 0) {
      same++;
      continue;
    }
    const row = rowById.get(e.skuId);
    const base = row ? defaultCost(row) : null;
    const cost = d > 0 ? (e.unitCost ?? base ?? 0) : (base ?? 0);
    if (d > 0) plus += d;
    else minus += -d;
    valueDelta += d * cost;
  }
  return { count: list.length, plus, minus, same, valueDelta };
}

export function parseRecon(d: RgReconResponse): RgRecon {
  return { fetchedAt: d.fetchedAt, actual: new Map(d.rows.map((r) => [r.skuId, r.actual])), issues: d.issues, inactive: d.inactive };
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 엑셀↓ — 지금 보이는 행 그대로. BOM을 붙여 엑셀이 한글을 깨지 않게 한다 */
export function toExportCsv(rows: StockRow[], recon: RgRecon | null): string {
  const head = ['sku_key', '상품', '옵션', '집', 'RG입고중', 'RG(원장)', 'RG실재고', '차이', '단가', '평가액'];
  const lines = rows.map((r) =>
    [r.key, r.name, r.option, r.self, r.rgInbound, r.rg, rgActual(r, recon), rgDiff(r, recon), defaultCost(r), r.value].map(csvCell).join(','),
  );
  return `﻿${[head.join(','), ...lines].join('\n')}\n`;
}

/** <input type="datetime-local">의 기본값(지금, KST) */
export function toKstLocalInput(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16);
}

/** 'YYYY-MM-DDTHH:mm'(KST) → 오프셋 있는 ISO */
export function localInputToIso(v: string): string {
  return `${v}:00+09:00`;
}

/** 이력·최근 수정의 시각 표시(KST, MM.DD HH:mm) */
export function fmtKst(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
