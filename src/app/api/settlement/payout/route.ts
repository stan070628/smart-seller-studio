import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

const MONTH_RE = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const month = req.nextUrl.searchParams.get('month');
  if (!month || !MONTH_RE.test(month)) {
    return NextResponse.json({ success: false, error: 'month (YYYY-MM) required' }, { status: 400 });
  }

  // 외부 API 실패해도 정산 화면이 죽지 않게 payout: null 로 흡수.
  try {
    const client = getCoupangClient();
    const payout = await client.getSettlementHistories(month);
    return NextResponse.json({ success: true, payout });
  } catch (err) {
    console.warn('[settlement] 지급 조회 실패:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: true, payout: null });
  }
}
