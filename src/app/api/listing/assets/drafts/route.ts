/**
 * /api/listing/assets/drafts
 * GET  — 내 임시저장 목록 (최신 30개)
 * POST — 새 임시저장 생성
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

// ─────────────────────────────────────────────────────────────
// GET — 임시저장 목록 조회
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('assets_drafts')
      .select('id, name, draft_data, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    // 클라이언트에서 사용하기 편한 camelCase 형태로 변환
    const drafts = (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      draftData: row.draft_data as Record<string, unknown>,
      createdAt: row.created_at as string,
    }));

    return Response.json({ drafts });
  } catch (err) {
    console.error('[GET /api/listing/assets/drafts]', err);
    return Response.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : JSON.stringify(err),
      },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────
// POST — 새 임시저장 생성
// ─────────────────────────────────────────────────────────────

const CreateDraftSchema = z.object({
  name: z.string().min(1),
  draftData: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest) {
  // 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parseResult = CreateDraftSchema.safeParse(rawBody);
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

  const { name, draftData } = parseResult.data;

  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('assets_drafts')
      .insert({ user_id: userId, name, draft_data: draftData })
      .select('id')
      .single();

    if (error) throw error;

    return Response.json({ id: (data as { id: string }).id }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/listing/assets/drafts]', err);
    return Response.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : JSON.stringify(err),
      },
      { status: 500 },
    );
  }
}
