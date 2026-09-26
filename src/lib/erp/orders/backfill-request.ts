// src/lib/erp/orders/backfill-request.ts
// 수집 라우트 공용: 과거 보충 시작일(backfillFrom)을 검사한다 — 형식(YYYY-MM-DD KST) · 범위(기초 시각 전 · 기초 시각 − 62일 이후).
// 범위는 DB의 기초 시각(ledger_cutover)을 읽어야 한다(읽기만). 틀리면 BackfillError — 라우트가 400으로 바꾼다.
import { getSourcingPool } from '@/lib/sourcing/db';
import { readCutover } from './store';
import { BackfillError, backfillEnd, backfillStart, parseBackfillDay } from './window';

/** 값이 없으면 undefined(보통 수집). 있으면 검사한 날짜 문자열 */
export async function checkBackfillFrom(v: unknown): Promise<string | undefined> {
  if (v === undefined || v === null || v === '') return undefined;
  const day = parseBackfillDay(v);
  backfillStart(day, await readCutover(getSourcingPool()));
  return day;
}

/** 보충 끝날(그날 포함). backfillFrom 없이 오면 400 · 시작일보다 앞이면 400 */
export async function checkBackfillTo(v: unknown, from: string | undefined): Promise<string | undefined> {
  if (v === undefined || v === null || v === '') return undefined;
  if (from === undefined) throw new BackfillError('과거 보충 끝날(backfillTo)은 시작일(backfillFrom)과 함께만 쓴다');
  const day = parseBackfillDay(v);
  backfillEnd(day, backfillStart(from, await readCutover(getSourcingPool())), new Date());
  return day;
}
