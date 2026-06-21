import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; channelId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { channelId } = await params;
  const pool = getSourcingPool();

  const { rowCount } = await pool.query(
    `DELETE FROM product_cost_channels WHERE id = $1 AND user_id = $2`,
    [channelId, user.userId],
  );

  if (rowCount === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
