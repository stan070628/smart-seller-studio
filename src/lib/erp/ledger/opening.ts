// src/lib/erp/ledger/opening.ts
// 전환일 기초재고. RG = 쿠팡 RG 실재고 API, 자체보관 = 실사(기존 계산값을 미리 채운 실사표를 사람이 고친다).
// lot 단가 = 옛 입고(cost_entries)를 최근부터 거슬러 보유 수량만큼의 가중평균. 배송비·RG 물류비는 넣지 않는다(기존 FIFO stock_value와 같은 정의).

export interface OpeningSku {
  id: number;
  key: string;
  name: string;
  optionLabel: string;
  legacyProductCostIds: string[];
}

/** RG 리스팅(vendorItemId) ↔ SKU 연결 한 줄. multiplier = 리스팅 1개가 뜻하는 SKU 기준 단위 수 */
export interface RgLink {
  vid: string;
  skuId: number;
  multiplier: number;
}

export interface RgStock {
  vid: string;
  qty: number;
}

export interface LegacyFacts {
  productCostId: string;
  entries: { receivedAt: string; quantity: number; unitCost: number }[];
  /** 무효가 아닌 판매 수량 합계(모든 채널, 배수 적용된 SKU 기준 단위) */
  soldQty: number;
  /** 무효 처리된 판매 수량 합계 — 추정이 부풀었을 수 있다는 신호 */
  voidedQty: number;
}

export type OpeningIssueKind =
  | 'rg_vid_unmapped'
  | 'rg_listing_multi_sku'
  | 'self_estimate_negative'
  | 'group_spans_skus'
  | 'cost_unknown'
  | 'cost_partial';

export interface OpeningIssue {
  kind: OpeningIssueKind;
  ref: string;
  detail: string;
}

export interface SkuGroup {
  id: string;
  skuIds: number[];
  productCostIds: string[];
}

export interface CountRow {
  skuId: number;
  skuKey: string;
  name: string;
  option: string;
  group: string;
  rgActual: number;
  /** 그룹 단위 추정(입고 − 판매 − 그룹 RG). 입고 기록이 없으면 null */
  selfEstimate: number | null;
  /** 사람이 확정하는 자체보관 실사. null = 아직 안 적음 */
  selfCount: number | null;
  /** RG로 보냈으나 아직 판매 가능 수량에 안 잡힌 수량(사람이 적는다) */
  rgInbound: number;
  unitCost: number | null;
  note: string;
}

export function rgQtyBySku(links: RgLink[], stock: RgStock[], ignore: Set<string>): { bySku: Map<number, number>; issues: OpeningIssue[] } {
  const byVid = new Map<string, RgLink[]>();
  for (const l of links) byVid.set(l.vid, [...(byVid.get(l.vid) ?? []), l]);
  const bySku = new Map<number, number>();
  const issues: OpeningIssue[] = [];
  for (const s of stock) {
    if (s.qty === 0 || ignore.has(s.vid)) continue;
    const ls = byVid.get(s.vid) ?? [];
    if (ls.length === 0) {
      issues.push({ kind: 'rg_vid_unmapped', ref: s.vid, detail: `RG 재고 ${s.qty}개인 vendorItemId가 어느 RG 리스팅에도 없다` });
      continue;
    }
    if (ls.length > 1) {
      issues.push({ kind: 'rg_listing_multi_sku', ref: s.vid, detail: `RG 재고 ${s.qty}개 — 리스팅이 SKU ${ls.map((l) => l.skuId).join(', ')}에 걸쳐 나눌 수 없다` });
      continue;
    }
    bySku.set(ls[0].skuId, (bySku.get(ls[0].skuId) ?? 0) + s.qty * ls[0].multiplier);
  }
  return { bySku, issues };
}

/** 옛 원가 행을 공유하는 SKU를 한 그룹으로 묶는다(합집합-찾기). 그룹 순서는 첫 SKU id 순. */
export function groupSkus(skus: OpeningSku[]): SkuGroup[] {
  const parent = new Map<number, number>(skus.map((s) => [s.id, s.id]));
  const find = (x: number): number => {
    while (parent.get(x)! !== x) x = parent.get(x)!;
    return x;
  };
  const firstSkuOfPc = new Map<string, number>();
  for (const s of skus) {
    for (const pc of s.legacyProductCostIds) {
      const other = firstSkuOfPc.get(pc);
      if (other === undefined) firstSkuOfPc.set(pc, s.id);
      else parent.set(find(s.id), find(other));
    }
  }
  const groups = new Map<number, SkuGroup>();
  for (const s of [...skus].sort((a, b) => a.id - b.id)) {
    const root = find(s.id);
    const g = groups.get(root) ?? { id: '', skuIds: [], productCostIds: [] };
    g.skuIds.push(s.id);
    g.productCostIds = [...new Set([...g.productCostIds, ...s.legacyProductCostIds])].sort();
    groups.set(root, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.skuIds[0] - b.skuIds[0])
    .map((g, i) => ({ ...g, id: `g${i + 1}` }));
}

export function openingUnitCost(entries: LegacyFacts['entries'], onHand: number): { unitCost: number | null; partial: boolean } {
  if (onHand <= 0 || entries.length === 0) return { unitCost: null, partial: false };
  const newestFirst = [...entries].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
  let left = onHand;
  let cost = 0;
  for (const e of newestFirst) {
    if (left === 0) break;
    const q = Math.min(left, e.quantity);
    cost += q * e.unitCost;
    left -= q;
  }
  const partial = left > 0;
  if (partial) cost += left * newestFirst[0].unitCost;
  return { unitCost: Math.round(cost / onHand), partial };
}

export function buildCountSheet(
  skus: OpeningSku[],
  groups: SkuGroup[],
  rgBySku: Map<number, number>,
  legacy: LegacyFacts[],
): { rows: CountRow[]; issues: OpeningIssue[] } {
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const facts = new Map(legacy.map((f) => [f.productCostId, f]));
  const rows: CountRow[] = [];
  const issues: OpeningIssue[] = [];
  for (const g of groups) {
    const fs = g.productCostIds.map((pc) => facts.get(pc)).filter((f): f is LegacyFacts => !!f);
    const entries = fs.flatMap((f) => f.entries);
    const rgTotal = g.skuIds.reduce((s, id) => s + (rgBySku.get(id) ?? 0), 0);
    const hasHistory = entries.length > 0;
    const estimate = hasHistory
      ? entries.reduce((s, e) => s + e.quantity, 0) - fs.reduce((s, f) => s + f.soldQty, 0) - rgTotal
      : null;
    const voided = fs.reduce((s, f) => s + f.voidedQty, 0);
    const single = g.skuIds.length === 1;
    const prefill = !hasHistory ? 0 : single ? Math.max(estimate!, 0) : null;
    const cost = openingUnitCost(entries, (prefill ?? Math.max(estimate ?? 0, 0)) + rgTotal);

    const firstKey = skuById.get(g.skuIds[0])!.key;
    if (estimate !== null && estimate < 0) {
      issues.push({ kind: 'self_estimate_negative', ref: firstKey, detail: `자체보관 추정 ${estimate} — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다` });
    }
    if (!single) issues.push({ kind: 'group_spans_skus', ref: g.id, detail: `SKU ${g.skuIds.length}개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다` });
    if (cost.partial) issues.push({ kind: 'cost_partial', ref: g.id, detail: '보유 수량이 옛 입고 합계보다 많아 모자란 만큼 최근 단가로 채웠다' });

    const notes: string[] = [];
    if (!hasHistory) notes.push('입고 기록 없음');
    if (!single) notes.push(`${g.skuIds.length}개 옵션 그룹 — 그룹 추정 ${estimate}을 옵션별로 나눠 적는다`);
    if (voided > 0) notes.push(`무효 판매 ${voided}개 — 추정이 부풀었을 수 있다`);

    for (const id of g.skuIds) {
      const s = skuById.get(id)!;
      const rgActual = rgBySku.get(id) ?? 0;
      if (cost.unitCost === null && rgActual + (prefill ?? 0) > 0) {
        issues.push({ kind: 'cost_unknown', ref: s.key, detail: '재고는 있는데 옛 입고 기록이 없어 단가를 모른다 — 실사표 unit_cost에 적는다' });
      }
      rows.push({
        skuId: id, skuKey: s.key, name: s.name, option: s.optionLabel, group: g.id,
        rgActual, selfEstimate: estimate, selfCount: prefill, rgInbound: 0, unitCost: cost.unitCost, note: notes.join(' · '),
      });
    }
  }
  const needsLook = (r: CountRow) => r.selfCount === null || r.selfCount > 0 || r.rgActual > 0;
  rows.sort((a, b) => Number(needsLook(b)) - Number(needsLook(a)) || a.skuId - b.skuId);
  return { rows, issues };
}

const COLUMNS = ['sku_id', 'sku_key', 'name', 'option', 'group', 'rg_actual', 'self_estimate', 'self_count', 'rg_inbound', 'unit_cost', 'note'] as const;

const cell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: CountRow[]): string {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([r.skuId, r.skuKey, r.name, r.option, r.group, r.rgActual, r.selfEstimate, r.selfCount, r.rgInbound, r.unitCost, r.note].map(cell).join(','));
  }
  return `﻿${lines.join('\n')}\n`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCountCsv(text: string): CountRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]);
  if (header.join(',') !== COLUMNS.join(',')) throw new Error(`실사표 머리글이 다르다: ${header.join(',')}`);
  const int = (v: string, col: string, line: number, nullable: boolean): number | null => {
    const t = v.trim();
    if (t === '') {
      if (nullable) return null;
      throw new Error(`${line}행 ${col}이 비어 있다`);
    }
    if (!/^-?\d+$/.test(t)) throw new Error(`${line}행 ${col} 값 '${t}'은 정수가 아니다`);
    return Number(t);
  };
  return lines.slice(1).map((l, i) => {
    const c = splitCsvLine(l);
    const n = i + 2;
    return {
      skuId: int(c[0], 'sku_id', n, false)!,
      skuKey: c[1], name: c[2], option: c[3], group: c[4],
      rgActual: int(c[5], 'rg_actual', n, false)!,
      selfEstimate: int(c[6], 'self_estimate', n, true),
      selfCount: int(c[7], 'self_count', n, true),
      rgInbound: int(c[8], 'rg_inbound', n, false)!,
      unitCost: int(c[9], 'unit_cost', n, true),
      note: c[10] ?? '',
    };
  });
}

/** 원장 RG와 실재고가 다른 SKU만. 순서는 SKU id 순. */
export function reconcileRg(ledger: Map<number, number>, actual: Map<number, number>): { skuId: number; ledger: number; actual: number; diff: number }[] {
  const ids = [...new Set([...ledger.keys(), ...actual.keys()])].sort((a, b) => a - b);
  return ids
    .map((skuId) => ({ skuId, ledger: ledger.get(skuId) ?? 0, actual: actual.get(skuId) ?? 0 }))
    .filter((r) => r.ledger !== r.actual)
    .map((r) => ({ ...r, diff: r.actual - r.ledger }));
}
