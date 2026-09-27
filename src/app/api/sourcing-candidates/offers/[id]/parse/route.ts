import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { parseOffer, type ParseOfferErrorCode } from '@/lib/sourcing-candidates/parse-offer';

export const maxDuration = 300;

/** parseOffer의 코드를 이 라우트의 HTTP 상태로 옮긴다 */
function statusOf(code: ParseOfferErrorCode): number {
  if (code === 'not_found' || code === 'invalid_id') return 404;
  if (code === 'conflict') return 409;
  return 422; // 'failed' — 그 밖의(캡처 판독 실패 등) 사유
}

/** POST /api/sourcing-candidates/offers/[id]/parse — 실패한 업체 판독 재시도 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const result = await parseOffer(getSourcingPool(), id, user.userId);
  return result
    ? NextResponse.json({ success: false, error: result.message }, { status: statusOf(result.code) })
    : NextResponse.json({ success: true });
}
