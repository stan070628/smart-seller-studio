/**
 * POST /api/ai/plan-scene-images
 *
 * 상품 정보와 업로드된 이미지 수를 기반으로
 * 상세페이지용 씬 스토리보드를 Claude로 생성합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { callClaude } from '@/lib/ai/claude-cli';

export const maxDuration = 30;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

const RequestBodySchema = z.object({
  productName: z.string().min(1).max(200),
  brandName: z.string().max(100).optional(),
  category: z.enum(['basic', 'fashion', 'living', 'food']),
  imageCount: z.number().int().min(1).max(10),
  referenceText: z.string().max(2000).optional(),
  sceneCount: z.number().int().min(1).max(8).default(4),
});

const SYSTEM_PROMPT = `You are a Korean e-commerce product photographer and content strategist.
Create a scene image storyboard for a product detail page.
Return ONLY valid JSON (no markdown, no code block): {"scenes": [...]}

Each scene object must have:
- title: Korean string, max 15 chars (e.g. "제품 전면 클로즈업")
- description: one-line Korean marketing purpose, max 50 chars
- prompt: detailed English Gemini image generation prompt, 80-150 words
- suggestedImageIndex: integer 0-based, which uploaded image index to use

Prompt format: [Setting/environment]. [Product placement]. [Lighting quality]. [Camera angle and framing]. [Mood and color palette]. No text, logos, or watermarks in the scene. The product must appear exactly as-is — do not alter its shape, color, or material.

Make each scene serve a distinct purpose: studio hero shot, lifestyle in-use scene, texture/detail macro, benefit visualization.`;

const CATEGORY_LABELS: Record<string, string> = {
  basic: '일반 상품',
  fashion: '패션/의류',
  living: '생활/인테리어',
  food: '식품/음료',
};

export async function POST(req: NextRequest) {
  // 인증 검사
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  // Rate Limit 검사
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'plan-scene-images'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  // 요청 바디 파싱 및 검증
  const body = await req.json().catch(() => null);
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });
  }

  const { productName, brandName, category, imageCount, referenceText, sceneCount } = parsed.data;

  // 유저 프롬프트 구성 — brandName이 있으면 앞에 붙임
  const userPrompt = `Product: ${[brandName, productName].filter(Boolean).join(' ')}
Category: ${CATEGORY_LABELS[category] ?? category}
Number of uploaded images: ${imageCount}
${referenceText ? `Reference context: ${referenceText}` : ''}

Create ${sceneCount} diverse scene storyboard items for the product detail page.`;

  try {
    const raw = await callClaude(SYSTEM_PROMPT, userPrompt, 'sonnet', 2048);

    // Claude가 ```json 코드블록으로 감쌀 경우 제거
    const jsonStr = raw.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim();
    const data = JSON.parse(jsonStr) as { scenes: Array<Record<string, unknown>> };
    if (!Array.isArray(data.scenes)) throw new Error('invalid response shape');

    // suggestedImageIndex를 유효 범위(0 ~ imageCount-1)로 클램핑
    const scenes = data.scenes.map(s => ({
      ...s,
      suggestedImageIndex: Math.min(
        Math.max(Number(s.suggestedImageIndex) || 0, 0),
        imageCount - 1,
      ),
    }));

    return NextResponse.json({ scenes });
  } catch (err) {
    console.error('[plan-scene-images] 오류:', err);
    return NextResponse.json(
      { error: '스토리라인 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
