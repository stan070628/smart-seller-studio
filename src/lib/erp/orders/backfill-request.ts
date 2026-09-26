// src/lib/erp/orders/backfill-request.ts
// 수집 라우트 공용: 과거 보충 시작일(backfillFrom)을 검사한다 — 형식(YYYY-MM-DD KST) · 범위(기초 시각 전 · 기초 시각 − 62일 이후).
// 범위는 DB의 기초 시각(ledger_cutover)을 읽어야 한다(읽기만). 틀리면 BackfillError — 라우트가 400으로 바꾼다.
import { getSourcingPool } from '@/lib/sourcing/db';
import { readCutover } from './store';
import { backfillStart, parseBackfillDay } from './window';

/** 값이 없으면 undefined(보통 수집). 있으면 검사한 날짜 문자열 */
export async function checkBackfillFrom(v: unknown): Promise<string | undefined> {
  if (v === undefined || v === null || v === '') return undefined;
  const day = parseBackfillDay(v);
  backfillStart(day, await readCutover(getSourcingPool()));
  return day;
}
