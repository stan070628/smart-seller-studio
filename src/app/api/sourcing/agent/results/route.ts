import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getAgentResults } from '@/lib/sourcing-agent/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));

    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    const rawCategoryId = searchParams.get('categoryId');
    const categoryId =
      rawCategoryId !== null && !isNaN(parseInt(rawCategoryId, 10))
        ? parseInt(rawCategoryId, 10)
        : undefined;

    const pool = getSourcingPool();
    const data = await getAgentResults(pool, { limit, offset, categoryId });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
