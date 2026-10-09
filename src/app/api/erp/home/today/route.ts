// src/app/api/erp/home/today/route.ts
// GET — A11 오늘 할 일(카드 5개 · 오늘 흐름). ERP DB만 읽는다
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { buildToday } from '@/lib/erp/home/today';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await buildToday(getSourcingPool(), new Date()) });
  } catch (e) {
    return erpError(e);
  }
}
