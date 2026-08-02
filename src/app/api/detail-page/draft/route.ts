/**
 * /api/detail-page/draft
 * POST — 상세페이지 드래프트 upsert (id 있으면 update, 없으면 insert)
 * GET  — ?id= 또는 ?listingId= 로 본인 드래프트 로드
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { sanitizeProLayout } from '@/lib/detail-page/layout-validator';
import { deriveShootDraftSummary } from '@/lib/detail-page/shoot-draft';

export const DraftUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  listingId: z.string().uuid().optional(),
  productName: z.string().max(200).optional(),
  sections: z.array(z.record(z.string(), z.unknown())),
  theme: z.record(z.string(), z.unknown()),
  thumbnailUrl: z.string().url().optional(),
  shootSession: z.record(z.string(), z.unknown()).optional(),
  // 촬영기획(creativeBrief)·스토리보드·참고자료·생성된 썸네일·업로드 이미지·브랜드명/카테고리 등
  // sections/theme에 속하지 않는 부가 편집 상태를 통째로 담는 확장 슬롯. 100_ 마이그레이션 참고.
  creativeState: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ success: false, error: '유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  const parsed = DraftUpsertSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ success: false, error: '입력값 검증 실패', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { id, listingId, productName, sections, theme, thumbnailUrl, shootSession, creativeState } = parsed.data;

  // claude_layout 섹션은 저장 전 정화(오염 저장 방지). sanitizeProLayout는 { sections, warnings } 반환.
  const safeSections = sections.map((s) =>
    (s as { type?: string }).type === 'claude_layout'
      ? { ...s, content: sanitizeProLayout([(s as { content?: unknown }).content]).sections[0] ?? (s as { content?: unknown }).content }
      : s,
  );

  const row = {
    user_id: userId,
    listing_id: listingId ?? null,
    product_name: productName ?? null,
    sections: safeSections,
    theme,
    thumbnail_url: thumbnailUrl ?? null,
    updated_at: new Date().toISOString(),
  };
  if (shootSession !== undefined) {
    (row as Record<string, unknown>).shoot_session = shootSession;
  }
  if (creativeState !== undefined) {
    (row as Record<string, unknown>).creative_state = creativeState;
  }

  try {
    const supabase = getSupabaseServerClient();
    if (id) {
      const { data, error } = await supabase
        .from('detail_page_drafts').update(row).eq('id', id).eq('user_id', userId).select('id').single();
      // PGRST116 = 행 없음(미소유/부재) → 404. 그 외 DB 오류는 500으로 escalate(로그 가시성 유지).
      if (error) {
        if ((error as { code?: string }).code === 'PGRST116') {
          return Response.json({ success: false, error: '드래프트를 찾을 수 없거나 권한이 없습니다.' }, { status: 404 });
        }
        throw error;
      }
      if (!data) {
        return Response.json({ success: false, error: '드래프트를 찾을 수 없거나 권한이 없습니다.' }, { status: 404 });
      }
      return Response.json({ id: (data as { id: string }).id });
    }
    const { data, error } = await supabase
      .from('detail_page_drafts').insert(row).select('id').single();
    if (error) throw error;
    return Response.json({ id: (data as { id: string }).id }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/detail-page/draft]', err);
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { searchParams } = new URL(request.url);
  if (searchParams.get('list')) {
    try {
      const supabase = getSupabaseServerClient();
      const { data, error } = await supabase
        .from('detail_page_drafts')
        .select('id, product_name, updated_at, shoot_session')
        .eq('user_id', userId)
        .not('shoot_session->>step', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const drafts = (data ?? []).map((r) => deriveShootDraftSummary(r as never));
      return Response.json({ success: true, drafts });
    } catch (err) {
      console.error('[GET /api/detail-page/draft?list]', err);
      return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }
  const id = searchParams.get('id');
  const listingId = searchParams.get('listingId');
  if (!id && !listingId) {
    return Response.json({ success: false, error: 'id 또는 listingId가 필요합니다.' }, { status: 400 });
  }
  // uuid 컬럼이므로 형식 검증 — 잘못된 값이 DB 타입오류(500)로 새는 것을 방지하고 400으로 응답.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (id && !UUID_RE.test(id)) {
    return Response.json({ success: false, error: '유효하지 않은 id 형식입니다.' }, { status: 400 });
  }
  if (listingId && !UUID_RE.test(listingId)) {
    return Response.json({ success: false, error: '유효하지 않은 listingId 형식입니다.' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    let query = supabase
      .from('detail_page_drafts')
      .select('id, listing_id, product_name, sections, theme, thumbnail_url, updated_at, shoot_session, creative_state')
      .eq('user_id', userId);
    query = id ? query.eq('id', id) : query.eq('listing_id', listingId as string);

    const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ draft: null });

    const d = data as Record<string, unknown>;
    return Response.json({
      draft: {
        id: d.id, listingId: d.listing_id, productName: d.product_name,
        sections: d.sections, theme: d.theme, thumbnailUrl: d.thumbnail_url, updatedAt: d.updated_at,
        shootSession: d.shoot_session, creativeState: d.creative_state,
      },
    });
  } catch (err) {
    console.error('[GET /api/detail-page/draft]', err);
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
