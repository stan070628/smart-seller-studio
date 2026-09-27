import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { parseOffer } from '@/lib/sourcing-candidates/parse-offer';

export const maxDuration = 60;

/** POST /api/sourcing-candidates/offers/[id]/parse — 실패한 업체 판독 재시도 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const error = await parseOffer(getSourcingPool(), id, user.userId);
  return error
    ? NextResponse.json({ success: false, error }, { status: 422 })
    : NextResponse.json({ success: true });
}
