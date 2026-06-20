import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { channel, optionId, newName } = (body ?? {}) as Record<string, unknown>;

  if (!channel || !optionId || typeof newName !== 'string' || !newName.trim()) {
    return NextResponse.json({ success: false, error: 'channel, optionId, newName 필수' }, { status: 400 });
  }
  if (newName.trim().length > 200) {
    return NextResponse.json({ success: false, error: '옵션명은 200자 이하여야 합니다.' }, { status: 400 });
  }
  if (channel !== 'coupang' && channel !== 'naver') {
    return NextResponse.json({ success: false, error: "channel은 'coupang' 또는 'naver'여야 합니다." }, { status: 400 });
  }

  const field = channel === 'coupang' ? 'variants' : 'naver_variants';
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `SELECT ${field} FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const current = (rows[0][field] as Record<string, string> | null) ?? {};
  if (!(String(optionId) in current)) {
    return NextResponse.json({ success: false, error: `옵션 ID '${optionId}'를 찾을 수 없습니다.` }, { status: 404 });
  }

  const updated = { ...current, [String(optionId)]: newName.trim() };

  await pool.query(
    `UPDATE product_costs SET ${field} = $1 WHERE id = $2 AND user_id = $3`,
    [JSON.stringify(updated), id, user.userId],
  );

  return NextResponse.json({ success: true, data: { [field]: updated } });
}
