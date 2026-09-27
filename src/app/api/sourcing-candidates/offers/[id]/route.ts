import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const PatchSchema = z.object({
  url: z.string().url().nullable().optional(),
  cny_override: z.number().positive().nullable().optional(),
  adopted: z.literal(true).optional(),
}).strict();

/**
 * PATCH /api/sourcing-candidates/offers/[id]
 * adopted: true면 같은 후보의 다른 업체 채택을 풀고 이것을 채택한다(후보당 하나 — 부분 유니크 인덱스).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' }, { status: 400 });
  }
  const { adopted, ...fields } = parsed.data;
  const pool = getSourcingPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT listing_id FROM sourcing_offers WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, user.userId],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    if (adopted) {
      await client.query(`UPDATE sourcing_offers SET adopted = false, updated_at = now() WHERE listing_id = $1 AND adopted`, [rows[0].listing_id]);
      await client.query(`UPDATE sourcing_offers SET adopted = true, updated_at = now() WHERE id = $1`, [id]);
    }
    const entries = Object.entries(fields);
    if (entries.length) {
      const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      await client.query(`UPDATE sourcing_offers SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 });
  } finally {
    client.release();
  }
  return NextResponse.json({ success: true });
}
