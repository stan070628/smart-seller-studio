/**
 * /api/listing/sourcing
 * GET    — 상품 ID 배열에 대한 소싱 출처 일괄 조회
 * PUT    — 소싱 출처 upsert (저장/수정)
 * DELETE — 소싱 출처 삭제
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { requireAuth } from '@/lib/supabase/auth';

// ─────────────────────────────────────────────────────────────
// GET — ids 배치 조회
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const sp = request.nextUrl.searchParams;
  const platform = sp.get('platform') ?? '';
  const idsRaw = sp.get('ids') ?? '';
  const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);

  // platform이 없으면 빈 맵 즉시 반환
  if (!platform) {
    return Response.json({ sourcing: {} });
  }

  // ids가 없으면 빈 맵 즉시 반환 (DB 조회 불필요)
  if (ids.length === 0) {
    return Response.json({ sourcing: {} });
  }

  try {
    const pool = getSourcingPool();
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(
      `SELECT product_id, sourcing_type, sourcing_value
       FROM product_sourcing
       WHERE platform = $1 AND product_id IN (${placeholders})`,
      [platform, ...ids],
    );

    const sourcing: Record<string, { type: string; value: string }> = {};
    for (const row of result.rows) {
      sourcing[row.product_id] = { type: row.sourcing_type, value: row.sourcing_value };
    }

    return Response.json({ sourcing });
  } catch (err) {
    console.error('[sourcing] GET error:', err);
    return Response.json({ success: false, error: '소싱 조회 실패' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// PUT — 소싱 출처 upsert
// ─────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { platform, productId, type, value } = body as {
    platform: string;
    productId: string;
    type: string;
    value: string;
  };

  // 필수 필드가 없으면 400 반환
  if (!platform || !productId || !type) {
    return Response.json({ success: false, error: '필수 필드가 누락되었습니다.' }, { status: 400 });
  }

  // value가 비어 있으면 400 반환
  if (!value?.trim()) {
    return Response.json({ success: false, error: '값이 비어 있습니다.' }, { status: 400 });
  }

  try {
    const pool = getSourcingPool();
    await pool.query(
      `INSERT INTO product_sourcing (platform, product_id, sourcing_type, sourcing_value, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (platform, product_id)
       DO UPDATE SET sourcing_type = $3, sourcing_value = $4, updated_at = NOW()`,
      [platform, productId, type, value],
    );

    return Response.json({ success: true });
  } catch (err) {
    console.error('[sourcing] PUT error:', err);
    return Response.json({ success: false, error: '소싱 저장 실패' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE — 소싱 출처 삭제
// ─────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { platform, productId } = body as { platform: string; productId: string };

  // 필수 필드가 없으면 400 반환
  if (!platform || !productId) {
    return Response.json({ success: false, error: '필수 필드가 누락되었습니다.' }, { status: 400 });
  }

  try {
    const pool = getSourcingPool();
    await pool.query(
      `DELETE FROM product_sourcing WHERE platform = $1 AND product_id = $2`,
      [platform, productId],
    );

    return Response.json({ success: true });
  } catch (err) {
    console.error('[sourcing] DELETE error:', err);
    return Response.json({ success: false, error: '소싱 삭제 실패' }, { status: 500 });
  }
}
