/**
 * /api/listing/naver/drafts
 * GET  — 내 임시저장 목록 (status='draft', 최신 30개)
 * POST — 새 draft 저장
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('naver_drafts')
      .select('id, product_name, source_url, source_type, status, draft_data, created_at, updated_at')
      .eq('user_id', userId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    const drafts = (data ?? []).map((row) => ({
      id: row.id as string,
      productName: row.product_name as string,
      sourceUrl: row.source_url as string | null,
      sourceType: row.source_type as string,
      status: row.status as string,
      draftData: row.draft_data as Record<string, unknown>,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));

    return Response.json({ drafts });
  } catch (err) {
    console.error('[GET /api/listing/naver/drafts]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

const CreateDraftSchema = z.object({
  productName: z.string().default(''),
  sourceUrl: z.string().nullish(),
  sourceType: z.string().default('manual'),
  draftData: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  const parseResult = CreateDraftSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      { success: false, error: '입력값 검증 실패', details: parseResult.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { productName, sourceUrl, sourceType, draftData } = parseResult.data;

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('naver_drafts')
      .insert({
        user_id: userId,
        product_name: productName,
        source_url: sourceUrl ?? null,
        source_type: sourceType,
        draft_data: draftData,
        status: 'draft',
      })
      .select('id')
      .single();

    if (error) throw error;

    return Response.json({ id: (data as { id: string }).id }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/listing/naver/drafts]', err);
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
