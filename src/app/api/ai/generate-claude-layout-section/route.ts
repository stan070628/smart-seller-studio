/**
 * POST /api/ai/generate-claude-layout-section
 *
 * Claude로 JSON DSL 레이아웃 블록을 생성하고,
 * 이미지 슬롯을 병렬로 처리(업로드 배경제거 or Gemini 생성)하여
 * Supabase Storage에 저장한 뒤 공개 URL을 반환합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import type { LayoutBlock } from '@/types/detail-page';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

export const maxDuration = 90;

/** 분당 최대 요청 수 */
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 };

/** 결과 이미지 저장 버킷 */
const BUCKET = 'product-images';

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

const ImageSlotSchema = z.union([
  z.object({ source: z.literal('upload'), url: z.string().url() }),
  z.object({ source: z.literal('gemini'), generationHint: z.string().max(200) }),
]);

const RequestSchema = z.object({
  title: z.string().min(1).max(200),
  points: z.array(z.string().max(100)).max(8).default([]),
  sectionHint: z.string().max(400).optional(),
  imageSlots: z.array(ImageSlotSchema).max(4).default([]),
});

// ─────────────────────────────────────────
// Claude 시스템 프롬프트
// ─────────────────────────────────────────

const CLAUDE_SYSTEM = `You are a Korean e-commerce product detail page layout designer.
Generate a single section layout as JSON.

Available block types:
- badge: { type, text, color?: 'primary'|'accent'|'neutral' }
- heading: { type, text, size: 'xl'|'lg'|'md', bold?: boolean, color?: 'primary'|'text'|'accent' }
- subtext: { type, text, align?: 'left'|'center' }
- image: { type, attachedIndex: 0..N, width?: string, align?: 'center'|'left'|'right', rounded?: boolean }
- stat_row: { type, items: [{label, value, unit?}] }
- bullet_list: { type, items: string[], icon?: 'dot'|'check'|'arrow' }
- columns: { type, cols: LayoutBlock[][], gap?: number }
- divider: { type }
- spacer: { type, height: number }

Rules:
- image blocks use attachedIndex 0..N (N = imageCount-1)
- All text values must be plain strings, NO HTML tags
- Large headlines (size 'xl') for main points
- Use columns for side-by-side layouts
- Korean mobile detail page style (390px width)
- badge block for eyebrow labels like 'Point 1', 'HACCP 인증'

Return ONLY valid JSON:
{
  "blocks": [...],
  "bgStyle": "white"|"light"|"dark"|"primary",
  "padding": "normal"|"compact"|"wide"
}`;

// ─────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────

/**
 * base64 이미지를 Supabase Storage에 업로드하고 공개 URL을 반환합니다.
 * 환경변수 누락 또는 업로드 실패 시 null을 반환합니다.
 */
async function uploadBase64Image(base64: string, mimeType: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const path = `ai-detail/${Date.now()}-claude-layout.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) return null;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * 업로드 슬롯 처리:
 * 1. URL에서 이미지 다운로드
 * 2. 배경 제거 시도 (REPLICATE_API_TOKEN 없으면 원본 유지)
 * 3. Supabase Storage 업로드
 */
async function processUploadSlot(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = response.headers.get('content-type') ?? 'image/jpeg';

    const { removeImageBackgrounds } = await import('@/lib/ai/remove-background');
    // ReferenceImage.mimeType은 'image/jpeg' 리터럴이므로 JPEG으로 정규화
    const { refs: cleaned } = await removeImageBackgrounds([{ base64, mimeType: 'image/jpeg' as const }]);
    const ref = cleaned[0];
    if (!ref) return null;

    return uploadBase64Image(ref.base64, ref.mimeType);
  } catch {
    return null;
  }
}

/**
 * Gemini 슬롯 처리:
 * 1. Gemini Imagen으로 이미지 생성
 * 2. 배경 제거 시도
 * 3. Supabase Storage 업로드
 */
async function processGeminiSlot(generationHint: string): Promise<string | null> {
  try {
    const { generateFrameImage } = await import('@/lib/ai/imagen');
    const { removeImageBackgrounds } = await import('@/lib/ai/remove-background');

    const bgPrompt = `Clean product photography: ${generationHint}. White background, studio lighting, no shadows, no text.`;
    const imageResult = await generateFrameImage({ imagePrompt: bgPrompt });

    // ReferenceImage.mimeType은 'image/jpeg' 리터럴이므로 JPEG으로 정규화
    const { refs: cleaned } = await removeImageBackgrounds([{
      base64: imageResult.imageBase64,
      mimeType: 'image/jpeg' as const,
    }]);
    const ref = cleaned[0];
    if (!ref) return null;

    return uploadBase64Image(ref.base64, ref.mimeType);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface LayoutResult {
  blocks: LayoutBlock[];
  bgStyle: 'white' | 'light' | 'dark' | 'primary';
  padding: 'normal' | 'compact' | 'wide';
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // 1. 인증 검증
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  // 2. Rate Limit 검사
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'generate-claude-layout-section'), RATE_LIMIT);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      {
        status: 429,
        headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() },
      },
    );
  }

  // 3. 요청 바디 파싱 및 검증
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { title, points, sectionHint, imageSlots } = parsed.data;

  try {
    // 4. Claude DSL 생성 + 이미지 슬롯 처리 병렬 실행
    const userPrompt = [
      `Section title: "${title}"`,
      points.length > 0 ? `Key points: ${points.map(p => `"${p}"`).join(', ')}` : '',
      sectionHint ? `Context: ${sectionHint}` : '',
      `Image slots available: ${imageSlots.length} (use attachedIndex 0..${imageSlots.length - 1})`,
    ].filter(Boolean).join('\n');

    const [claudeSettled, ...imageSettled] = await Promise.allSettled([
      // Claude JSON DSL 생성
      (async (): Promise<LayoutResult> => {
        const { getAnthropicClient } = await import('@/lib/ai/claude');
        const client = getAnthropicClient();
        const res = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          system: CLAUDE_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        });

        // 텍스트 블록 추출
        const text = res.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('');

        // JSON 파싱 (첫 번째 {} 블록 추출)
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return { blocks: [], bgStyle: 'white', padding: 'normal' };

        try {
          const parsed = JSON.parse(match[0]) as {
            blocks?: unknown;
            bgStyle?: string;
            padding?: string;
          };
          return {
            blocks: Array.isArray(parsed.blocks) ? (parsed.blocks as LayoutBlock[]) : [],
            bgStyle: (['white', 'light', 'dark', 'primary'] as const).includes(
              parsed.bgStyle as 'white' | 'light' | 'dark' | 'primary',
            )
              ? (parsed.bgStyle as 'white' | 'light' | 'dark' | 'primary')
              : 'white',
            padding: (['normal', 'compact', 'wide'] as const).includes(
              parsed.padding as 'normal' | 'compact' | 'wide',
            )
              ? (parsed.padding as 'normal' | 'compact' | 'wide')
              : 'normal',
          };
        } catch {
          return { blocks: [], bgStyle: 'white', padding: 'normal' };
        }
      })(),

      // 이미지 슬롯 병렬 처리
      ...imageSlots.map(slot =>
        slot.source === 'upload'
          ? processUploadSlot(slot.url)
          : processGeminiSlot(slot.generationHint),
      ),
    ]);

    // 5. 결과 조합
    const layout: LayoutResult =
      claudeSettled.status === 'fulfilled'
        ? claudeSettled.value
        : { blocks: [], bgStyle: 'white', padding: 'normal' };

    const imageUrls = imageSettled.map(r =>
      r.status === 'fulfilled' ? r.value : null,
    );

    return NextResponse.json({ success: true, data: { ...layout, imageUrls } });
  } catch (error) {
    console.error('[generate-claude-layout-section] 오류:', error);
    return NextResponse.json(
      { success: false, error: '레이아웃 생성 실패' },
      { status: 500 },
    );
  }
}
