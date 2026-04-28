import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET(request: NextRequest) {
  const unread = request.nextUrl.searchParams.get('unread') === 'true';
  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, type, severity, sku_code, message, detail, read_at, created_at
       FROM alerts
       ${unread ? 'WHERE read_at IS NULL' : ''}
       ORDER BY created_at DESC LIMIT 100`,
    );
    return NextResponse.json({ success: true, rows });
  } catch {
    return NextResponse.json({ success: true, rows: [] });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const ids = body?.ids as number[] | undefined;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ success: false, error: 'ids required' }, { status: 400 });
  }
  const pool = getSourcingPool();
  await pool.query(`UPDATE alerts SET read_at = now() WHERE id = ANY($1::bigint[])`, [ids]);
  return NextResponse.json({ success: true });
}
