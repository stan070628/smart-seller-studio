/**
 * GET /api/auto-register/validate-category?categoryCode=56137
 *
 * 카테고리 코드 유효성 확인.
 * 1차: getCategoryMeta 성공 → valid
 * 2차: getCategoryMeta 실패해도 카테고리 트리(findCategoryFullPath)에 존재하면 valid
 *      → 검색 결과에서 선택한 코드가 "없는 코드"로 표시되는 오류 방지
 *
 * Response: { valid: boolean, fullPath: string }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get('categoryCode')?.trim() ?? '';
  const num = Number(code);

  if (!code || !Number.isFinite(num) || num <= 0) {
    return NextResponse.json({ valid: false });
  }

  const client = getCoupangClient();

  // 1차: getCategoryMeta 성공 → 확실히 유효
  try {
    await client.getCategoryMeta(num);
    const fullPath = await client.findCategoryFullPath(num).catch(() => null);
    return NextResponse.json({ valid: true, fullPath: fullPath ?? '' });
  } catch {
    // getCategoryMeta 실패 — 카테고리 트리에서 재확인
  }

  // 2차: 카테고리 트리에 존재하면 유효 (검색 결과와 동일한 소스)
  try {
    const fullPath = await client.findCategoryFullPath(num);
    if (fullPath) {
      return NextResponse.json({ valid: true, fullPath });
    }
  } catch {
    // 트리 조회 실패
  }

  return NextResponse.json({ valid: false, fullPath: '' });
}
