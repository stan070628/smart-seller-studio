/**
 * GET /api/auto-register/validate-category?categoryCode=56137
 *
 * 쿠팡 getCategoryMeta를 호출해 카테고리 코드가 유효한지만 확인합니다.
 * Response: { valid: boolean }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get('categoryCode')?.trim() ?? '';
  const num = Number(code);

  if (!code || !Number.isFinite(num) || num <= 0) {
    return NextResponse.json({ valid: false });
  }

  try {
    const client = getCoupangClient();
    await client.getCategoryMeta(num);
    // fullPath는 실패해도 valid 자체는 true
    const fullPath = await client.findCategoryFullPath(num).catch(() => null);
    return NextResponse.json({ valid: true, fullPath: fullPath ?? '' });
  } catch {
    return NextResponse.json({ valid: false, fullPath: '' });
  }
}
