import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';

// ─────────────────────────────────────────
// 요청 스키마 검증
// ─────────────────────────────────────────

const RequestSchema = z.object({
  sourceType: z.enum(['url', 'upload']),
  sourceUrl: z.string().url().optional(),
  thumbnails: z.array(z.string()).default([]),
  detailHtml: z.string().optional(),
  detailImage: z.string().optional(),
});

// ─────────────────────────────────────────
// POST /api/listing/assets/save
// 생성된 자산 메타데이터를 generated_assets 테이블에 저장합니다.
// ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 인증 검증
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  // 요청 바디 파싱 및 Zod 검증
  const json = await req.json();
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  // DB insert
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('generated_assets')
    .insert({
      user_id: auth.userId,
      source_type: parsed.data.sourceType,
      source_url: parsed.data.sourceUrl ?? null,
      thumbnails: parsed.data.thumbnails,
      detail_html: parsed.data.detailHtml ?? null,
      detail_image: parsed.data.detailImage ?? null,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: { id: (data as { id: string }).id } });
}
