import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getRequests, getStats } from '@/lib/sourcing-agent/keyword-db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));
    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);
    const keyword = searchParams.get('keyword') ?? undefined;
    const includeStats = searchParams.get('stats') === 'true';

    const pool = getSourcingPool();
    const [requests, stats] = await Promise.all([
      getRequests(pool, { limit, offset, keyword }),
      includeStats ? getStats(pool) : Promise.resolve(null),
    ]);

    return NextResponse.json({ success: true, data: requests, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
