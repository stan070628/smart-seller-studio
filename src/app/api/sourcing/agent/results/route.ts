import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getAgentResults } from '@/lib/sourcing-agent/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    // limit: 1~100 범위로 클램핑, 기본값 50
    const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));

    // offset: 0 이상, 기본값 0
    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    // categoryId: 정수 필터 (미제공 시 전체 조회)
    const rawCategoryId = searchParams.get('categoryId');
    const categoryId =
      rawCategoryId !== null && !isNaN(parseInt(rawCategoryId, 10))
        ? parseInt(rawCategoryId, 10)
        : undefined;

    const pool = getSourcingPool();
    const results = await getAgentResults(pool, { limit, offset, categoryId });

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
