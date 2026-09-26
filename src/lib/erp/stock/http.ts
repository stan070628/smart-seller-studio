// src/lib/erp/stock/http.ts
// /api/erp/* 공용: 트랜잭션 · 오류 → HTTP 응답 · 조정 요청 본문 변환.
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getSourcingPool } from '@/lib/sourcing/db';
import { InsufficientStockError, type Location } from '@/lib/erp/ledger/fifo';
import {
  AdjustInputError, AdjustItemError, CostRequiredError, StaleCountError,
  type AdjustInput, type AdjustMode, type UserReason,
} from '@/lib/erp/ledger/adjust';
import { ImportConflictError } from '@/lib/erp/ledger/opening-import';
import { maskPII } from '@/lib/jobs/mask';

/** 한 트랜잭션. 던지면 ROLLBACK — 여러 건 조정은 전부 되거나 전부 안 된다 */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getSourcingPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, code, error, ...extra }, { status });

/** 원장 오류를 화면이 다룰 수 있는 코드로. stale = 다시 보고 적는다 · insufficient/negative = 재고 부족 · cost_required = 단가 입력 */
export function erpError(e: unknown): NextResponse {
  const item = e instanceof AdjustItemError ? e : null;
  const inner = item ? item.inner : e;
  const extra = item ? { index: item.index, skuId: item.skuId, location: item.location } : {};
  const msg = item ? item.message : inner instanceof Error ? inner.message : String(inner);
  if (inner instanceof StaleCountError) return fail(409, 'stale', msg, extra);
  if (inner instanceof InsufficientStockError) return fail(409, 'insufficient', msg, extra);
  if (inner instanceof CostRequiredError) return fail(422, 'cost_required', msg, extra);
  if (inner instanceof ImportConflictError) return fail(409, 'conflict', msg, extra);
  if (inner instanceof AdjustInputError || inner instanceof RangeError) return fail(400, 'invalid', msg, extra);
  if (inner instanceof Error && /음수가 된다/.test(inner.message)) return fail(409, 'negative', msg, extra);
  // 겹친 요청이 같은 멱등키를 먼저 기록했다(잠금은 SKU 단위라 같은 요청 id를 다른 SKU에 동시에 보내면 여기로 온다)
  if (isIdemKeyConflict(inner)) return fail(409, 'conflict', '같은 요청이 이미 기록됐다 — 다시 보고 적는다', extra);
  if (inner instanceof Error && inner.message.startsWith('되돌릴 전표가 없다')) return fail(404, 'not_found', msg, extra);
  console.error('[erp]', maskPII(String(e)));
  return fail(500, 'server', '서버 오류');
}

/** Postgres unique 위반(23505) 중 erp.stock_ledger.idem_key */
function isIdemKeyConflict(e: unknown): boolean {
  const pg = e as { code?: unknown; constraint?: unknown } | null;
  return !!pg && pg.code === '23505' && typeof pg.constraint === 'string' && pg.constraint.includes('idem_key');
}

export const badRequest = (error: string) => fail(400, 'invalid', error);

// 숫자 칸은 엄격하게 읽는다 — Number(v)는 ''→0, [] →0, true→1로 조용히 바꿔 잘못된 값을 통과시킨다.
// 필수 칸(skuId·value)은 숫자 타입이 아니면 NaN(검사에서 400이 된다). 선택 칸(expected·unitCost)은
// undefined·null만 「입력 없음」이고, 그 밖의 타입은 NaN(같이 400) — ''을 0으로 읽지 않는다.
const reqNum = (v: unknown): number => (typeof v === 'number' ? v : NaN);
const optNum = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : typeof v === 'number' ? v : NaN);

/** 화면이 보낸 조정 한 건 → AdjustInput. 검사는 validateAdjustInput이 한다. fixed는 라우트가 정하는 칸(RG 반영의 위치·사유 등) */
export function parseAdjustItem(b: Record<string, unknown>, at: string, fixed: Partial<AdjustInput> = {}): AdjustInput {
  return {
    skuId: reqNum(b.skuId),
    location: b.location as Location,
    mode: b.mode as AdjustMode,
    value: reqNum(b.value),
    expected: optNum(b.expected),
    reason: b.reason as UserReason,
    note: typeof b.note === 'string' && b.note.trim() !== '' ? b.note.trim() : undefined,
    unitCost: optNum(b.unitCost),
    requestId: typeof b.requestId === 'string' ? b.requestId : '',
    occurredAt: at,
    ...fixed,
  };
}
