import { NextResponse } from 'next/server';

export async function GET() {
  // 환경 변수에서 배송 기본값 조회
  return NextResponse.json({
    outboundShippingPlaceCode: process.env.COUPANG_OUTBOUND_CODE ?? '',
    returnCenterCode: process.env.COUPANG_RETURN_CENTER_CODE ?? '',
  });
}
