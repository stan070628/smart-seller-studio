/**
 * DELETE /api/listing/assets/drafts/[id]
 * assets_drafts 임시저장 단건 삭제
 */

import { NextRequest } from 'next/server';
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
    .from('assets_drafts')
    .select('id')
    .eq('id', draftId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return {
      error: Response.json(
        { success: false, error: '해당 항목을 찾을 수 없거나 접근 권한이 없습니다.' },
        { status: 404 },
      ),
    };
  }
  return { ok: true };
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

  // 소유권 확인 (존재하지 않거나 타 유저 소유면 404 반환)
  const ownerCheck = await verifyOwnership(draftId, userId);
  if ('error' in ownerCheck) return ownerCheck.error;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from('assets_drafts')
      .delete()
      .eq('id', draftId)
      .eq('user_id', userId);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/listing/assets/drafts/[id]]', err);
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
