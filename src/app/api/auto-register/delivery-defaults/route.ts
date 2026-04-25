import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  return NextResponse.json({
    outboundShippingPlaceCode: process.env.COUPANG_OUTBOUND_CODE ?? '',
    returnCenterCode: process.env.COUPANG_RETURN_CENTER_CODE ?? '',
  });
}
