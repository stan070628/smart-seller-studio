/**
 * GET /api/auto-register/validate-category?categoryCode=56137
 *
 * 카테고리 코드 유효성 확인.
 * - 카테고리 트리에 없음 → { valid: false, reason: 'not_found' }
 * - 중간 카테고리(비-리프) → { valid: false, reason: 'not_leaf' }
 * - 최하위(리프) 카테고리 → { valid: true, fullPath }
 *
 * 쿠팡 상품 등록은 반드시 Leaf Node 코드를 요구하므로 리프 여부를 필수 검사.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get('categoryCode')?.trim() ?? '';
  const num = Number(code);

  if (!code || !Number.isFinite(num) || num <= 0) {
    return NextResponse.json({ valid: false, reason: 'not_found' });
  }

  const client = getCoupangClient();

  try {
    const node = await client.findCategoryNode(num);

    if (!node) {
      return NextResponse.json({ valid: false, reason: 'not_found', fullPath: '' });
    }

    if (!node.isLeaf) {
      // 중간 카테고리 — 쿠팡 등록 불가
      return NextResponse.json({ valid: false, reason: 'not_leaf', fullPath: node.fullPath });
    }

    return NextResponse.json({ valid: true, fullPath: node.fullPath });
  } catch {
    return NextResponse.json({ valid: false, reason: 'not_found', fullPath: '' });
  }
}
