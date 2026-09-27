import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { OFFER_URL_SCHEMA } from '@/lib/sourcing-candidates/upload';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';

const PatchSchema = z.object({
  url: OFFER_URL_SCHEMA.nullable().optional(),
  cny_override: z.number().positive().nullable().optional(),
  adopted: z.boolean().optional(),
}).strict();

/**
 * PATCH /api/sourcing-candidates/offers/[id]
 * adopted: true면 같은 후보의 다른 업체 채택을 풀고 이것을 채택한다(후보당 하나 — 부분 유니크 인덱스).
 * adopted: false면 채택 취소 — 이것만 푼다("채택 취소").
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
    if (adopted === true) {
      await client.query(`UPDATE sourcing_offers SET adopted = false, updated_at = now() WHERE listing_id = $1 AND adopted`, [rows[0].listing_id]);
      await client.query(`UPDATE sourcing_offers SET adopted = true, updated_at = now() WHERE id = $1`, [id]);
    } else if (adopted === false) {
      await client.query(`UPDATE sourcing_offers SET adopted = false, updated_at = now() WHERE id = $1`, [id]);
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

/**
 * DELETE /api/sourcing-candidates/offers/[id] — 1688 업체 삭제.
 * 판독이 아예 실패한 업체("1688 상품 페이지 캡처가 아닙니다" 등)는 고칠 값이 없어
 * 되살릴 수 없다 — 지우는 것이 유일한 정리 수단이다. 채택된 업체도 지울 수 있다,
 * 후보는 그냥 미채택 상태로 돌아간다(같은 후보의 다른 업체를 다시 채택하면 된다).
 * 행 삭제가 먼저이고 Storage 정리는 best-effort다 — 이미지가 남아도 행이 없으면
 * 더 이상 보이지 않으므로, Storage 실패로 삭제 자체를 실패시키지 않는다.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const { rows } = await getSourcingPool().query(
      `DELETE FROM sourcing_offers WHERE id = $1 AND user_id = $2 RETURNING image_paths`,
      [id, user.userId],
    );
    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const paths = (rows[0].image_paths ?? []) as string[];
    if (paths.length > 0) {
      try {
        const { error } = await getSupabaseServerClient().storage.from(STORAGE_BUCKET).remove(paths);
        if (error) console.error('[offers DELETE] storage 삭제 실패', error.message);
      } catch (err) {
        console.error('[offers DELETE] storage 삭제 실패', err);
      }
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as { code?: string }).code === '22P02') {
      return NextResponse.json({ success: false, error: '잘못된 id입니다.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 });
  }
}
