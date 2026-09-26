// POST /api/erp/orders/deduct-enable — 판매 차감 켜기(되돌리는 화면 없음). body { confirm: true, expectedLines }
// 한 트랜잭션: 설정 행 잠금 → 미리보기 다시 계산(화면이 본 소급 라인 수와 다르면 409 stale) → 켬(켠 시각·사람) → 기초재고 시각 이후 대기 라인 소급.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { DeductSwitchError, enableDeduction } from '@/lib/erp/orders/deduct';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { confirm?: unknown; expectedLines?: unknown } | null;
  if (body?.confirm !== true) return badRequest('확인(confirm: true)이 없다');
  const expected = body.expectedLines;
  if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) return badRequest(`expectedLines는 0 이상 정수다: ${String(expected)}`);
  try {
    const data = await withTx((c) => enableDeduction(c, { expectedLines: expected, by: auth.userId, at: new Date().toISOString() }));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    if (e instanceof DeductSwitchError) return NextResponse.json({ success: false, code: e.code, error: e.message }, { status: 409 });
    return erpError(e);
  }
}
