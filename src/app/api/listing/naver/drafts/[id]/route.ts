/**
 * /api/listing/naver/drafts/[id]
 * PUT    — draft 내용 업데이트
 * DELETE — draft 삭제
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function verifyOwnership(
  draftId: string,
  userId: string,
): Promise<{ error: Response } | { ok: true }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('naver_drafts')
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

const UpdateDraftSchema = z.object({
  productName: z.string().optional(),
  draftData: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  const ownerCheck = await verifyOwnership(draftId, userId);
  if ('error' in ownerCheck) return ownerCheck.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  const parseResult = UpdateDraftSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      { success: false, error: '입력값 검증 실패', details: parseResult.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { productName, draftData } = parseResult.data;

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (productName !== undefined) updateFields.product_name = productName;
  if (draftData !== undefined) updateFields.draft_data = draftData;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from('naver_drafts')
      .update(updateFields)
      .eq('id', draftId)
      .eq('user_id', userId);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('[PUT /api/listing/naver/drafts/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  const ownerCheck = await verifyOwnership(draftId, userId);
  if ('error' in ownerCheck) return ownerCheck.error;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from('naver_drafts')
      .delete()
      .eq('id', draftId)
      .eq('user_id', userId);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/listing/naver/drafts/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
