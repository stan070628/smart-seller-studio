// src/lib/erp/orders/deduct-plan.ts
// 차감 판정표(순수). 라인 하나의 지금 상태와 「뺀 것(posted)」을 보고 이번에 할 일을 정한다 — DB는 deduct.ts가 쓴다.
//   대상 = 팔림(SOLD) · 연결됨(mapped) · 결제 시각이 기초재고 시각 이후
//   뺀 것 = 대상 alloc이면 그대로, 다르면(취소·부분 취소·연결 변경) 역전표 → (대상이면) 다음 버전으로 다시 뺀다
//   unknown 상태는 아무것도 바꾸지 않는다
import type { AllocItem } from './resolve';
import { saleIdemKey } from './keys';
import { SOLD, type OrderChannel, type StdStatus } from './types';

export type DeductionState = 'pending' | 'posted' | 'skipped_short' | 'reversed' | 'none';
export type DeductNote = 'pre_cutover' | 'not_paid' | 'voided' | 'unattributed' | 'unknown_status';

export interface PostedItem {
  skuId: number;
  qty: number;
  idemKey: string;
}

export interface DeductInput {
  channel: OrderChannel;
  externalLineId: string;
  status: StdStatus;
  attribution: 'mapped' | 'unattributed';
  alloc: AllocItem[];
  paidAt: string | null;
  state: DeductionState;
  /** 지금까지 차감한 횟수 */
  version: number;
  posted: PostedItem[];
}

export interface DeductPlan {
  /** 되돌릴 원 멱등키(뺀 순서대로) */
  reverse: string[];
  post: { version: number; items: PostedItem[] } | null;
  /** 성공했을 때의 상태. post가 재고 부족이면 실행기가 skipped_short로 바꾼다 */
  state: DeductionState;
  note: DeductNote | null;
}

function notTargetReason(l: DeductInput, cutover: string): DeductNote | null {
  if (l.status === 'unpaid') return 'not_paid';
  if (!SOLD.has(l.status)) return 'voided';
  if (l.attribution !== 'mapped' || l.alloc.length === 0) return 'unattributed';
  if (l.paidAt === null) return 'not_paid';
  if (Date.parse(l.paidAt) < Date.parse(cutover)) return 'pre_cutover';
  return null;
}

const sig = (items: { skuId: number; qty: number }[]) =>
  [...items].sort((a, b) => a.skuId - b.skuId).map((i) => `${i.skuId}x${i.qty}`).join(',');

function build(l: DeductInput, version: number): { version: number; items: PostedItem[] } {
  return {
    version,
    items: [...l.alloc]
      .sort((a, b) => a.skuId - b.skuId)
      .map((a) => ({ skuId: a.skuId, qty: a.qty, idemKey: saleIdemKey(l.channel, l.externalLineId, a.skuId, version) })),
  };
}

export function decideDeduction(l: DeductInput, ctx: { enabled: boolean; cutover: string }): DeductPlan {
  if (l.status === 'unknown') return { reverse: [], post: null, state: l.state, note: 'unknown_status' };
  const note = notTargetReason(l, ctx.cutover);
  const target = note === null;

  if (l.state === 'posted') {
    if (target && sig(l.posted) === sig(l.alloc)) return { reverse: [], post: null, state: 'posted', note: null };
    const reverse = l.posted.map((p) => p.idemKey);
    if (!target) return { reverse, post: null, state: 'reversed', note };
    if (!ctx.enabled) return { reverse, post: null, state: 'pending', note: null };
    return { reverse, post: build(l, l.version + 1), state: 'posted', note: null };
  }

  if (!target) return { reverse: [], post: null, state: l.state === 'reversed' ? 'reversed' : 'none', note };
  if (!ctx.enabled) return { reverse: [], post: null, state: 'pending', note: null };
  return { reverse: [], post: build(l, l.version + 1), state: 'posted', note: null };
}
