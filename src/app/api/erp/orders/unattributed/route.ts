// GET — 미연결 주문 대기열(묶음) + 이 화면에서 만든 최근 연결 20건
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { recentLinks, unattributedGroups } from '@/lib/erp/orders/queue';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    const pool = getSourcingPool();
    const [groups, recent] = await Promise.all([unattributedGroups(pool), recentLinks(pool, 20)]);
    return NextResponse.json({ success: true, data: { groups, recent } });
  } catch (e) {
    return erpError(e);
  }
}
