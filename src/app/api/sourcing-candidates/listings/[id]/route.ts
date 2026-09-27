import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const PatchSchema = z.object({
  starred: z.boolean().optional(),
  excluded_override: z.boolean().nullable().optional(),
  memo: z.string().max(1000).nullable().optional(),
  size: z.enum(['xsmall', 'small', 'medium']).optional(),
  price_override: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).optional(),
  review_count: z.number().int().nonnegative().nullable().optional(),
}).strict();

/** PATCH /api/sourcing-candidates/listings/[id] — 사람이 고친 값. AI 값보다 우선한다 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' }, { status: 400 });
  }
  const entries = Object.entries(parsed.data);
  if (entries.length === 0) return NextResponse.json({ success: false, error: '바꿀 값이 없습니다.' }, { status: 400 });

  // 키는 zod strict가 화이트리스트로 막았으므로 컬럼명에 그대로 쓴다
  const sets = entries.map(([k], i) => `${k} = $${i + 3}`).join(', ');
  const { rowCount } = await getSourcingPool().query(
    `UPDATE sourcing_listings SET ${sets}, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [id, user.userId, ...entries.map(([, v]) => v)],
  );
  if (!rowCount) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
