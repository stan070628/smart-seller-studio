// GET /api/erp/stock/count-queue?n=8 — 오늘 셀 목록(집). 저장하지 않고 요청 때 계산한다(규칙: lib/erp/stock/count-queue.ts).
// 화면(PC 패널·휴대폰)은 열 때 한 번 받고, 센 줄은 화면에서 뺀다 — 다시 받으면 센 만큼 다음 SKU가 채워진다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { listStock } from '@/lib/erp/stock/queries';
import { DEFAULT_QUEUE_N, MAX_QUEUE_N, kstDate, pickCountQueue, type CountQueueResponse } from '@/lib/erp/stock/count-queue';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const raw = Number(request.nextUrl.searchParams.get('n') ?? String(DEFAULT_QUEUE_N));
  const n = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_QUEUE_N) : DEFAULT_QUEUE_N;
  try {
    const rows = await listStock(getSourcingPool());
    // 집 마지막 실사는 목록 행에 이미 실려 있다(listStock이 erp.stock_counts에서 읽는다)
    const counts = new Map<number, string>();
    for (const r of rows) if (r.lastCountedAt) counts.set(r.skuId, r.lastCountedAt);
    const today = kstDate(new Date());
    const data: CountQueueResponse = { today, n, items: pickCountQueue(rows, counts, { n, today }) };
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return erpError(e);
  }
}
