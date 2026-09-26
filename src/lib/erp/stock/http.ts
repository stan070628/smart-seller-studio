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
  console.error('[erp]', e);
  return fail(500, 'server', '서버 오류');
}

export const badRequest = (error: string) => fail(400, 'invalid', error);

const optNum = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));

/** 화면이 보낸 조정 한 건 → AdjustInput. 검사는 validateAdjustInput이 한다. fixed는 라우트가 정하는 칸(RG 반영의 위치·사유 등) */
export function parseAdjustItem(b: Record<string, unknown>, at: string, fixed: Partial<AdjustInput> = {}): AdjustInput {
  return {
    skuId: Number(b.skuId),
    location: b.location as Location,
    mode: b.mode as AdjustMode,
    value: Number(b.value),
    expected: optNum(b.expected),
    reason: b.reason as UserReason,
    note: typeof b.note === 'string' && b.note.trim() !== '' ? b.note.trim() : undefined,
    unitCost: optNum(b.unitCost),
    requestId: typeof b.requestId === 'string' ? b.requestId : '',
    occurredAt: at,
    ...fixed,
  };
}
