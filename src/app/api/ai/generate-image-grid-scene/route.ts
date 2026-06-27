/**
 * POST /api/ai/generate-image-grid-scene
 *
 * image_grid 섹션의 원본 이미지에서 Claude OCR로 핵심 포인트를 추출하고,
 * Gemini로 배경 이미지를 생성합니다.
 *
 * - Claude OCR 실패 시 points=[] 로 fallback 후 계속 진행
 * - Gemini 실패 시 500 반환
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { generateFrameImage } from '@/lib/ai/imagen';

export const maxDuration = 90;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 4 };

const RequestSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(6),
  title: z.string(),
});

export async function POST(req: NextRequest) {
  // 인증 검증
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  // Rate Limiting
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-image-grid-scene'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  // 요청 body 파싱 및 Zod 검증
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { imageUrls, title } = parsed.data;

  try {
    // Step 1: Claude OCR — 이미지에서 핵심 포인트 추출 (실패해도 계속 진행)
    let points: string[] = [];
    try {
      const anthropic = getAnthropicClient();

      // 최대 4장의 이미지를 URL 참조 블록으로 구성
      const imageBlocks: Anthropic.ImageBlockParam[] = imageUrls.slice(0, 4).map(url => ({
        type: 'image' as const,
        source: { type: 'url' as const, url },
      }));

      const ocrRes = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: `You are a product detail page analyst.
Extract the key selling points or product information visible in the image(s).
Return JSON: { "points": ["point1", "point2", ...] }
- Extract 3-6 concise Korean or English bullet points
- Focus on product features, specifications, or benefits visible in the image
- If no readable text: infer key features from the visual content
- Each point: max 25 characters`,
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: `Section title: "${title}". Extract key points.` },
          ],
        }],
      });

      // 응답 텍스트에서 JSON 파싱
      const rawText = ocrRes.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('');

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed2 = JSON.parse(jsonMatch[0]) as { points?: string[] };
        points = Array.isArray(parsed2.points) ? parsed2.points : [];
      }
    } catch (e) {
      // OCR 실패 시 points=[] 로 fallback — Gemini 생성은 계속 진행
      console.warn('[generate-image-grid-scene] OCR 실패, points=[]:', e);
    }

    // Step 2: Gemini 배경 이미지 생성
    const bgPrompt = `Clean, professional e-commerce product detail background for "${title}". Subtle, elegant lifestyle setting — soft gradient, minimal props, neutral tones. No text, no products, no people. High-end commercial photography backdrop. SINGLE FRAME ONLY.`;

    const imageResult = await generateFrameImage({ imagePrompt: bgPrompt });

    return NextResponse.json({
      success: true,
      data: {
        imageBase64: imageResult.imageBase64,
        mimeType: imageResult.mimeType,
        points,
      },
    });
  } catch (error) {
    console.error('[/api/ai/generate-image-grid-scene] 오류:', error);

    if (error instanceof Error && (error.message.includes('overloaded') || error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED'))) {
      return NextResponse.json({ success: false, error: 'AI 서비스가 일시적으로 과부하 상태입니다.' }, { status: 503 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '이미지 생성에 실패했습니다.' },
      { status: 500 },
    );
  }
}
