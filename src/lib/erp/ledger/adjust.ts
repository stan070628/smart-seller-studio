// src/lib/erp/ledger/adjust.ts
// 재고 조정(사람이 고치는 재고)의 규칙. 무엇을 기록할지만 정한다 — DB는 adjust-store.ts가 쓴다.
// 기본 입력은 「지금 개수」(원장과의 차이를 계산), 보조 입력은 ±수량. 빈 위치의 첫 「지금 개수」는 기초재고다.
import type { Location } from './fifo';
import type { Reason } from './plan';

export const LOCATIONS: readonly Location[] = ['self', 'rg_inbound', 'rg'];

/** 화면에서 고르는 사유. 'opening'은 서버가 정하고 'rg_reconcile'은 RG 대조 반영만 쓴다 */
export const USER_REASONS = ['count_diff', 'damage', 'loss', 'sample', 'return_in', 'other'] as const;
export type UserReason = (typeof USER_REASONS)[number];

export const REASON_LABEL: Record<Reason, string> = {
  opening: '기초재고',
  count_diff: '실사차이',
  damage: '파손',
  loss: '분실',
  sample: '샘플·증정',
  return_in: '반품입고',
  other: '기타',
  rg_reconcile: 'RG 대조',
};

export type AdjustMode = 'count' | 'delta';

export interface AdjustInput {
  skuId: number;
  location: Location;
  mode: AdjustMode;
  /** count: 지금 개수(0 이상) · delta: ±수량(0 아님) */
  value: number;
  /** count에서 필수 — 화면이 본 원장 재고. 저장 시점 재고와 다르면 StaleCountError */
  expected?: number;
  reason: UserReason | 'rg_reconcile';
  note?: string;
  /** 재고가 늘 때 새 lot 단가. 없으면 최근 lot → 옛 입고 순으로 찾는다 */
  unitCost?: number;
  /** 요청 하나 = uuid 하나. 멱등키 adj:<uuid>와 전표 ref_id가 된다 */
  requestId: string;
  /** 오프셋 있는 ISO */
  occurredAt: string;
}

export class AdjustInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdjustInputError';
  }
}

/** 화면이 본 재고와 저장 시점 재고가 다르다 — 다시 보고 적게 한다(HTTP 409) */
export class StaleCountError extends Error {
  constructor(public readonly expected: number, public readonly actual: number) {
    super(`재고가 바뀌었다 — 화면 ${expected}, 지금 ${actual}. 다시 보고 적는다`);
    this.name = 'StaleCountError';
  }
}

/** 늘어난 재고의 단가를 끝내 못 찾았다(HTTP 422) */
export class CostRequiredError extends Error {
  constructor(public readonly skuId: number) {
    super(`SKU ${skuId}: 늘어난 재고의 단가를 모른다 — 단가를 입력한다`);
    this.name = 'CostRequiredError';
  }
}

/** 여러 건 요청에서 몇 번째 항목이 왜 실패했는지 */
export class AdjustItemError extends Error {
  constructor(
    public readonly index: number,
    public readonly skuId: number,
    public readonly location: Location,
    public readonly inner: unknown,
  ) {
    super(`${index + 1}번째(SKU ${skuId} · ${location}): ${inner instanceof Error ? inner.message : String(inner)}`);
    this.name = 'AdjustItemError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_REASONS: readonly string[] = [...USER_REASONS, 'rg_reconcile'];

/** 입력 검사. 통과하면 requestId를 소문자로 맞춘다(대소문자만 다른 재전송도 같은 요청 — 멱등키·ref_id가 한 가지로) */
export function validateAdjustInput(p: AdjustInput): void {
  const bad = (m: string): never => {
    throw new AdjustInputError(m);
  };
  if (!Number.isInteger(p.skuId) || p.skuId <= 0) bad(`skuId가 잘못됐다: ${p.skuId}`);
  if (!LOCATIONS.includes(p.location)) bad(`위치가 잘못됐다: ${String(p.location)}`);
  if (p.mode === 'count') {
    if (!Number.isInteger(p.value) || p.value < 0) bad(`지금 개수는 0 이상 정수다: ${p.value}`);
    if (p.expected === undefined || !Number.isInteger(p.expected) || p.expected < 0) bad('지금 개수 방식은 화면이 본 재고(expected)를 함께 보낸다');
  } else if (p.mode === 'delta') {
    if (!Number.isInteger(p.value) || p.value === 0) bad(`±수량은 0이 아닌 정수다: ${p.value}`);
  } else {
    bad(`방식이 잘못됐다: ${String(p.mode)}`);
  }
  if (!ALLOWED_REASONS.includes(p.reason)) bad(`사유가 잘못됐다: ${String(p.reason)}`);
  // RG 위치는 「RG 실재고 대조」로만 고치고, 그 사유는 RG 위치에만 쓴다
  if ((p.location === 'rg') !== (p.reason === 'rg_reconcile')) bad('RG 위치는 RG 대조 사유로만 고친다(그 사유도 RG 위치 전용이다)');
  if (p.unitCost !== undefined && (!Number.isInteger(p.unitCost) || p.unitCost < 0)) bad(`단가는 0 이상 정수다: ${p.unitCost}`);
  if (typeof p.requestId !== 'string' || !UUID.test(p.requestId)) bad(`요청 id는 uuid다: ${p.requestId}`);
  p.requestId = p.requestId.toLowerCase();
  if (!ISO_WITH_OFFSET.test(p.occurredAt)) bad(`발생 시각은 오프셋 있는 ISO다: ${p.occurredAt}`);
  if (p.note !== undefined && p.note.length > 200) bad('메모는 200자까지다');
}

export interface AdjustStep {
  /** 원장 증감(+ 새 lot / − FIFO 차감 / 0 기록 없음) */
  diff: number;
  /** 늘어날 때 lot 전표 종류. 빈 위치의 첫 지금 개수 = opening */
  lotKind: 'opening' | 'adjust';
  /** 기초 전표를 실제로 쓰면 ledger_cutover를 적는다(이미 있으면 두지 않는다 — 1-C2 소급의 시작점) */
  setsCutover: boolean;
}

export function planAdjustment(p: { mode: AdjustMode; value: number; expected?: number; onHand: number; locationEmpty: boolean }): AdjustStep {
  if (p.mode === 'count') {
    if (p.expected !== p.onHand) throw new StaleCountError(p.expected ?? -1, p.onHand);
    const diff = p.value - p.onHand;
    const lotKind = p.locationEmpty ? 'opening' : 'adjust';
    return { diff, lotKind, setsCutover: lotKind === 'opening' && diff > 0 };
  }
  // 빈 위치의 +수량 = expected 0인 지금 개수(기초재고) · −수량은 뺄 재고가 없다
  if (p.locationEmpty) {
    if (p.value < 0) throw new AdjustInputError('비어 있는 위치에서는 뺄 수 없다');
    return { diff: p.value, lotKind: 'opening', setsCutover: p.value > 0 };
  }
  return { diff: p.value, lotKind: 'adjust', setsCutover: false };
}

export type AdjustCostSource = 'input' | 'lot' | 'legacy';

/** 늘어난 재고의 단가: 화면 입력 > 그 SKU의 최근 lot(위치 무관) > 옛 cost_entries 최근 단가 */
export function pickUnitCost(
  input: number | undefined,
  lot: number | null,
  legacy: number | null,
): { unitCost: number; source: AdjustCostSource } | null {
  if (input !== undefined) return { unitCost: input, source: 'input' };
  if (lot !== null) return { unitCost: lot, source: 'lot' };
  if (legacy !== null) return { unitCost: legacy, source: 'legacy' };
  return null;
}

export const adjustIdemKey = (requestId: string): string => `adj:${requestId}`;
export const openingIdemKey = (skuId: number, location: Location): string => `opening:${skuId}:${location}`;

const REVERSIBLE = /^((adj|rgdone):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|opening:\d+:(self|rg_inbound|rg))$/i;
/**
 * 화면에서 되돌릴 수 있는 원 멱등키(순번 없는 것): 조정 adj: · 기초 opening: · RG 입고 완료 rgdone:(rg-arrive.ts — 원장만의 이동).
 * 영수증·RG 보내기 전표는 옛 원가 기록과 짝이라 여기서 되돌리지 않는다
 */
export const isReversibleKey = (k: string): boolean => REVERSIBLE.test(k);
