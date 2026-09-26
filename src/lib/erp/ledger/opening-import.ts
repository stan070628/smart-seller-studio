// src/lib/erp/ledger/opening-import.ts
// 화면의 「실사표 불러오기」 = 기초재고 한꺼번에. 1-B opening.ts(실사표 CSV·단가 결정·RG 환산)를 그대로 쓴다.
// 1-B 스크립트(opening-apply)와 다른 점: 단가 덮어쓰기와 실사 시각은 화면 입력이다(docs 파일 없음) ·
// self_count 빈칸 행과 실사표에 없는 SKU는 건너뛴다(빈 위치의 첫 입력이 곧 기초재고라 나중에 적으면 된다) ·
// RG 매핑 이슈는 경고다 · 원장에 전표가 이미 있는 SKU는 빼고 「조정으로 고친다」로 안내한다.
import type { Location } from './fifo';
import {
  checkCountedAt, groupSkus, resolveOpeningCosts, rgOutsideActive,
  type CountRow, type LegacyFacts, type OpeningIssue, type OpeningSku, type ResolvedCost,
} from './opening';
import { randomUUID } from 'node:crypto';
import { lockSku, postLotCreate, type Db } from './store';
import { ensureCutover, recordCount } from './adjust-store';
import { openingIdemKey } from './adjust';

/** 기초재고 적재 전역 잠금 — 1-B scripts/erp/opening-apply.ts와 같은 값(겹친 실행이 서로를 기다린다) */
export const OPENING_LOCK = 7102;

export interface ImportPlanRow {
  skuId: number;
  key: string;
  location: Location;
  qty: number;
  unitCost: number;
}

export interface ImportTotals {
  self: number;
  rgInbound: number;
  rg: number;
  value: number;
  entries: number;
}

export interface ImportPreview {
  plan: ImportPlanRow[];
  errors: string[];
  warnings: string[];
  excluded: { skuKey: string; reason: string }[];
  /** 보유 수량이 있는 SKU의 적재 단가와 출처(화면이 단가 입력 칸을 그린다) */
  costs: ResolvedCost[];
  totals: ImportTotals;
  /** 불러올 SKU의 집 센 개수(0 포함) — 적재 때 센 기록(erp.stock_counts)으로 남긴다. 응답에는 싣지 않는다 */
  selfCounts: { skuId: number; qty: number }[];
}

/** /api/erp/stock/import 응답 */
export interface ImportSummary extends Omit<ImportPreview, 'plan' | 'selfCounts'> {
  committed: number;
  cutoverAt: string;
}

export class ImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportConflictError';
  }
}

export function planOpeningImport(input: {
  rows: CountRow[];
  skus: OpeningSku[];
  legacy: LegacyFacts[];
  rgBySku: Map<number, number>;
  rgIssues: OpeningIssue[];
  stockedSkuIds: Set<number>;
  overrides: Record<string, number>;
  countedAt: string;
  now: Date;
  /** 배수 > 1인데 기준 단위가 정해지지 않은 SKU(opening-db readDb가 준다) — 경고로만 남긴다 */
  baseUnitMissing?: { key: string; name: string; maxMultiplier: number }[];
}): ImportPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const excluded: { skuKey: string; reason: string }[] = [];
  const active = new Map(input.skus.map((s) => [s.id, s]));
  const activeKeys = new Set(input.skus.map((s) => s.key));

  const bad = checkCountedAt(input.countedAt, input.now);
  if (bad) errors.push(bad.replace('opening-overrides.json에 ', ''));
  for (const i of input.rgIssues) warnings.push(`${i.kind} ${i.ref} — ${i.detail} (불러오지 않는다)`);
  if (input.baseUnitMissing && input.baseUnitMissing.length > 0) {
    warnings.push(`기준 단위 미정 SKU ${input.baseUnitMissing.length}건(${input.baseUnitMissing.map((m) => m.key).join(', ')}) — 실사 개수를 셀 수 없다`);
  }
  for (const o of rgOutsideActive(input.rgBySku, new Set(active.keys()))) {
    warnings.push(`활성이 아닌 SKU ${o.skuId}에 RG 재고 ${o.qty}개 — 불러오지 않는다`);
  }

  const included: CountRow[] = [];
  for (const r of input.rows) {
    const s = active.get(r.skuId);
    if (!s) { errors.push(`실사표의 SKU ${r.skuId}(${r.skuKey})가 활성 SKU가 아니다`); continue; }
    if (s.key !== r.skuKey) { errors.push(`SKU ${r.skuId} 키가 다르다: 실사표 ${r.skuKey} / DB ${s.key}`); continue; }
    if (input.stockedSkuIds.has(r.skuId)) { excluded.push({ skuKey: r.skuKey, reason: '원장에 이미 전표가 있다 — 재고현황에서 조정으로 고친다' }); continue; }
    if (r.selfCount === null) { excluded.push({ skuKey: r.skuKey, reason: 'self_count 빈칸 — 불러오지 않는다(나중에 화면에서 적으면 기초재고가 된다)' }); continue; }
    if (r.selfCount < 0) { errors.push(`self_count 음수: ${r.skuKey}`); continue; }
    if (r.rgInbound < 0) { errors.push(`rg_inbound 음수: ${r.skuKey}`); continue; }
    included.push(r);
  }
  const includedIds = new Set(included.map((r) => r.skuId));
  for (const [id, q] of input.rgBySku) {
    const s = active.get(id);
    if (q > 0 && s && !includedIds.has(id) && !input.stockedSkuIds.has(id)) {
      warnings.push(`RG 재고 ${q}개인 SKU ${s.key}가 불러올 행에 없다 — RG도 불러오지 않는다`);
    }
  }
  for (const [k, v] of Object.entries(input.overrides)) {
    if (!activeKeys.has(k)) errors.push(`단가 입력의 SKU 키 ${k}가 활성 SKU가 아니다`);
    else if (!Number.isInteger(v) || v < 0) errors.push(`단가 입력 ${k} = ${v} — 0 이상 정수여야 한다`);
  }

  const rgIncluded = new Map([...input.rgBySku].filter(([id]) => includedIds.has(id)));
  const cost = resolveOpeningCosts(input.skus, groupSkus(input.skus), input.legacy, included, rgIncluded, input.overrides);
  const costById = new Map(cost.costs.map((c) => [c.skuId, c]));
  for (const m of cost.missing) errors.push(`재고 ${m.onHand}개인데 단가를 모른다: ${m.skuKey} — 단가를 입력한다`);
  for (const c of cost.baseUnitCheck) {
    errors.push(`${c.skuKey}: 기준 단위 「${c.baseUnitLabel}」인데 단가가 옛 입고 이력(${c.unitCost}원)에서 왔다 — 단가를 입력한다`);
  }

  const plan: ImportPlanRow[] = [];
  for (const r of included) {
    const unitCost = costById.get(r.skuId)?.unitCost;
    if (unitCost === null || unitCost === undefined) continue;
    const rgNow = rgIncluded.get(r.skuId) ?? 0;
    for (const [location, qty] of [['self', r.selfCount ?? 0], ['rg_inbound', r.rgInbound], ['rg', rgNow]] as const) {
      if (qty > 0) plan.push({ skuId: r.skuId, key: r.skuKey, location, qty, unitCost });
    }
  }
  const sum = (loc: Location) => plan.filter((p) => p.location === loc).reduce((s, p) => s + p.qty, 0);
  return {
    plan, errors, warnings, excluded,
    selfCounts: included.map((r) => ({ skuId: r.skuId, qty: r.selfCount ?? 0 })),
    costs: cost.costs.filter((c) => c.onHand > 0),
    totals: { self: sum('self'), rgInbound: sum('rg_inbound'), rg: sum('rg'), value: plan.reduce((s, p) => s + p.qty * p.unitCost, 0), entries: plan.length },
  };
}

/** 호출자 트랜잭션 안에서 기초 전표를 쓴다. 전역 잠금 → SKU 오름차순 잠금·빈 원장 재확인 → 전표 → 집 센 기록 → 커서.
 *  집 0개로 센 SKU는 전표가 없지만 센 기록은 남긴다 — 그 SKU도 잠그고 빈 원장을 다시 확인한다 */
export async function commitOpeningImport(
  db: Db,
  plan: ImportPlanRow[],
  p: { fileName: string; cutoverAt: string; countedAt: string; selfCounts: { skuId: number; qty: number }[] },
): Promise<number> {
  await db.query('select pg_advisory_xact_lock($1::bigint)', [OPENING_LOCK]);
  const ids = [...new Set([...plan.map((r) => r.skuId), ...p.selfCounts.map((c) => c.skuId)])].sort((a, b) => a - b);
  for (const id of ids) {
    await lockSku(db, id);
    const { rows } = await db.query('select count(*)::int as n from erp.stock_ledger where sku_id = $1', [id]);
    if (Number(rows[0].n) > 0) throw new ImportConflictError(`SKU ${id}에 미리보기 뒤 전표가 생겼다 — 다시 미리보기한다`);
  }
  let n = 0;
  for (const r of [...plan].sort((a, b) => a.skuId - b.skuId)) {
    const res = await postLotCreate(db, {
      skuId: r.skuId, location: r.location, qty: r.qty, unitCost: r.unitCost, kind: 'opening', reason: 'opening',
      occurredAt: p.cutoverAt, idemKey: openingIdemKey(r.skuId, r.location), refType: 'opening', refId: p.fileName,
    });
    if (res.posted) n++;
  }
  // 센 시각 = 실사를 마친 시각(기초 전표 시각 cutoverAt과 다르다). 빈 원장을 확인했으니 원장 재고는 0
  const selfPosted = new Set(plan.filter((r) => r.location === 'self').map((r) => r.skuId));
  for (const c of [...p.selfCounts].sort((a, b) => a.skuId - b.skuId)) {
    await recordCount(db, {
      skuId: c.skuId, location: 'self', countedQty: c.qty, ledgerQty: 0,
      idemKey: selfPosted.has(c.skuId) ? openingIdemKey(c.skuId, 'self') : null,
      requestId: randomUUID(), countedAt: p.countedAt,
    });
  }
  if (n > 0) await ensureCutover(db, p.cutoverAt);
  return n;
}
