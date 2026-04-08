/**
 * /api/niche/competitors/[id]
 * PATCH  — 경쟁 상품 정보 수정 (추적 on/off, 메모 등)
 * DELETE — 경쟁 상품 삭제 (cascade로 스냅샷도 삭제)
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';

// ─────────────────────────────────────────────────────────────────────────────
// 스키마
// ─────────────────────────────────────────────────────────────────────────────

const PatchCompetitorSchema = z.object({
  isTracking: z.boolean().optional(),
  memo: z.string().max(500).nullable().optional(),
  rankPosition: z.number().int().min(1).max(9999).nullable().optional(),
  isRocket: z.boolean().optional(),
  isAd: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parseResult = PatchCompetitorSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      {
        success: false,
        error: '입력값 검증 실패',
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const updates = parseResult.data;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.isTracking !== undefined) {
    setClauses.push(`is_tracking = $${paramIdx++}`);
    values.push(updates.isTracking);
  }
  if (updates.memo !== undefined) {
    setClauses.push(`memo = $${paramIdx++}`);
    values.push(updates.memo);
  }
  if (updates.rankPosition !== undefined) {
    setClauses.push(`rank_position = $${paramIdx++}`);
    values.push(updates.rankPosition);
  }
  if (updates.isRocket !== undefined) {
    setClauses.push(`is_rocket = $${paramIdx++}`);
    values.push(updates.isRocket);
  }
  if (updates.isAd !== undefined) {
    setClauses.push(`is_ad = $${paramIdx++}`);
    values.push(updates.isAd);
  }

  if (setClauses.length === 0) {
    return Response.json(
      { success: false, error: '수정할 필드가 없습니다.' },
      { status: 400 },
    );
  }

  values.push(id);

  try {
    const pool = getSourcingPool();
    const result = await pool.query(
      `UPDATE niche_competitor_products SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING id`,
      values,
    );

    if (result.rowCount === 0) {
      return Response.json(
        { success: false, error: '해당 경쟁 상품을 찾을 수 없습니다.' },
        { status: 404 },
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/niche/competitors/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const pool = getSourcingPool();
    const result = await pool.query(
      `DELETE FROM niche_competitor_products WHERE id = $1 RETURNING id`,
      [id],
    );

    if (result.rowCount === 0) {
      return Response.json(
        { success: false, error: '해당 경쟁 상품을 찾을 수 없습니다.' },
        { status: 404 },
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/niche/competitors/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
