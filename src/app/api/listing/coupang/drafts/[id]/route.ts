/**
 * /api/listing/coupang/drafts/[id]
 * GET    — draft 단건 조회 (?draftId= 주소 복원용)
 * PUT    — draft 내용 업데이트
 * DELETE — draft 삭제
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

// 라우트 파라미터 타입
interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─────────────────────────────────────────────────────────────
// 공통: draft 소유권 확인
// ─────────────────────────────────────────────────────────────

async function verifyOwnership(
  draftId: string,
  userId: string,
): Promise<{ error: Response } | { ok: true }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('coupang_drafts')
    .select('id')
    .eq('id', draftId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return {
      error: Response.json(
        { success: false, error: '해당 draft를 찾을 수 없거나 접근 권한이 없습니다.' },
        { status: 404 },
      ),
    };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// GET — draft 단건 조회
// 화면 이동 후 주소의 ?draftId=로 돌아왔을 때 자동등록 페이지가 이 엔드포인트로
// 자신이 저장한 draft를 불러와 복원한다. 목록(30개 제한)에 없을 수도 있는
// 오래된 draft도 id만 맞으면 항상 조회 가능해야 하므로 목록 API와 별도로 둔다.
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('coupang_drafts')
      .select('id, product_name, source_url, source_type, status, draft_data, created_at, updated_at')
      .eq('id', draftId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return Response.json({ draft: null });

    return Response.json({
      draft: {
        id: data.id as string,
        productName: data.product_name as string,
        sourceUrl: data.source_url as string | null,
        sourceType: data.source_type as string,
        status: data.status as string,
        draftData: data.draft_data as Record<string, unknown>,
        createdAt: data.created_at as string,
        updatedAt: data.updated_at as string,
      },
    });
  } catch (err) {
    console.error('[GET /api/listing/coupang/drafts/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// PUT — draft 업데이트
// ─────────────────────────────────────────────────────────────

const UpdateDraftSchema = z.object({
  productName: z.string().optional(),
  draftData: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(request: NextRequest, context: RouteContext) {
  // 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  // 소유권 확인
  const ownerCheck = await verifyOwnership(draftId, userId);
  if ('error' in ownerCheck) return ownerCheck.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parseResult = UpdateDraftSchema.safeParse(rawBody);
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

  const { productName, draftData } = parseResult.data;

  // 업데이트할 필드 구성 (undefined 필드는 제외)
  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (productName !== undefined) updateFields.product_name = productName;
  if (draftData !== undefined) updateFields.draft_data = draftData;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from('coupang_drafts')
      .update(updateFields)
      .eq('id', draftId)
      .eq('user_id', userId);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('[PUT /api/listing/coupang/drafts/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE — draft 삭제
// ─────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, context: RouteContext) {
  // 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  // 소유권 확인
  const ownerCheck = await verifyOwnership(draftId, userId);
  if ('error' in ownerCheck) return ownerCheck.error;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from('coupang_drafts')
      .delete()
      .eq('id', draftId)
      .eq('user_id', userId);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/listing/coupang/drafts/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
