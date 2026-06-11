import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { generateFrameImage } from '@/lib/ai/imagen';
import { loadReferenceImages } from '@/lib/ai/reference-images';

export const maxDuration = 90;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 8 };

const RequestBodySchema = z.object({
  sectionType: z.enum(['hero', 'lifestyle', 'detail', 'feature']),
  // 신규: 멀티참조
  referenceImages: z
    .array(z.object({ base64: z.string(), mimeType: z.string().optional() }))
    .max(3)
    .optional(),
  productImageUrls: z.array(z.string().url()).max(3).optional(),
  // 하위호환: 단일
  productImageBase64: z.string().optional(),
  productImageMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  productImageUrl: z.string().url().optional(),
  productInfo: z.object({
    headline: z.string().optional(),
    subheadline: z.string().optional(),
    sellingPoints: z.array(z.object({ title: z.string(), description: z.string() })).optional(),
    features: z.array(z.object({ title: z.string() })).optional(),
  }).optional(),
});

const SCENE_PROMPT_SYSTEM = `You are an expert e-commerce product photographer and AI image prompt engineer.

Given one or more reference images of the SAME product (often photographed from different angles) and product information, create a highly detailed English prompt for Gemini image generation that will produce a professional commercial lifestyle scene.

Rules:
- The product from the reference image(s) MUST appear prominently in the generated scene
- Create a COMPLETE scene with the product naturally integrated — not just a background
- Be extremely specific: lighting quality, environment details, props, camera angle, mood, color palette
- Do NOT include any text, logos, watermarks, or price tags in the scene description
- The output must be a photorealistic commercial photography scene
- CRITICAL PRODUCT COUNT: The multiple reference images show the SAME single product from different angles — they do NOT represent multiple products. Carefully count the EXACT number of each item type that makes up ONE product unit (e.g., "1 spoon and 1 chopstick set" or "3 bottles sold together"). Your prompt MUST specify this EXACT count. NEVER duplicate or multiply items based on the number of reference images provided. State the count explicitly: "exactly 1 [item]" etc.
- CRITICAL: The generated prompt MUST end with this exact instruction: "The attached product image must be placed in this scene exactly as it appears — do not transform, distort, modify, or reimagine the product's shape, color, material, or appearance in any way. Minor cleanup only (background removal, sharpening, white balance correction) is acceptable. Create an entirely new scene/background/environment around the unchanged product. IMPORTANT: Use EXACTLY the same quantity of items as shown in the reference image — do not add more items, do not duplicate products. SINGLE FRAME ONLY: Generate exactly one single continuous photograph — no split panels, diptychs, multi-view layouts, before/after comparisons, or composite image compositions."

Section type directions:
- hero: Clean studio shot with the product as the clear hero. Dramatic professional lighting, minimal elegant background, product centered.
- lifestyle: Product shown in its actual real-world use context. Creative authentic scene (e.g. fragrance diffuser hanging from a car rearview mirror, cutlery arranged on a fine dining table, skincare product on a marble bathroom counter). Natural or mood lighting.
- detail: Extreme close-up macro shot of the product's most distinctive material, texture, or craftsmanship detail. Very shallow depth of field, soft bokeh.
- feature: Aspirational scene that visually communicates the product's key function or benefit. Creative and conceptual but still photorealistic.

Return ONLY valid JSON: {"prompt": "your detailed English prompt here"}`;

function buildUserPrompt(
  sectionType: string,
  productInfo?: {
    headline?: string;
    subheadline?: string;
    sellingPoints?: Array<{ title: string; description: string }>;
    features?: Array<{ title: string }>;
  },
): string {
  const lines: string[] = ['Product reference image(s) are attached above.'];

  if (productInfo) {
    if (productInfo.headline) lines.push(`Product headline: ${productInfo.headline}`);
    if (productInfo.subheadline) lines.push(`Subheadline: ${productInfo.subheadline}`);
    if (productInfo.sellingPoints?.length) {
      lines.push(`Key selling points: ${productInfo.sellingPoints.map((sp) => sp.title).join(', ')}`);
    }
    if (productInfo.features?.length) {
      lines.push(`Product features: ${productInfo.features.map((f) => f.title).join(', ')}`);
    }
  }

  lines.push('');
  lines.push(`Section type: ${sectionType}`);
  lines.push('Generate a detailed Gemini image generation prompt for this section. Return only JSON.');

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-scene-image'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { sectionType, productInfo } = parsed.data;

  try {
    // 참조 이미지 로딩 (멀티참조: URL fetch + Sharp 리사이즈 + base64, 최대 3장)
    const referenceImages = await loadReferenceImages({
      referenceImages: parsed.data.referenceImages,
      productImageUrls: parsed.data.productImageUrls,
      productImageBase64: parsed.data.productImageBase64,
      productImageMimeType: parsed.data.productImageMimeType,
      productImageUrl: parsed.data.productImageUrl,
    });

    // Step 1: Claude Sonnet으로 섹션별 씬 프롬프트 생성
    const client = getAnthropicClient();

    type ContentBlock =
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'text'; text: string };

    const userContent: ContentBlock[] = [];

    for (const ref of referenceImages) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: ref.mimeType, data: ref.base64 },
      });
    }

    userContent.push({ type: 'text', text: buildUserPrompt(sectionType, productInfo) });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claudeRes = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SCENE_PROMPT_SYSTEM,
      messages: [{ role: 'user', content: userContent as any }],
    });

    const rawText = claudeRes.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');
    const promptData = JSON.parse(jsonMatch[0]) as { prompt?: string };
    const scenePrompt = promptData.prompt;
    if (!scenePrompt) throw new Error('Claude가 프롬프트를 생성하지 못했습니다.');

    // Step 2: Gemini로 완성된 씬 이미지 생성
    const imageResult = await generateFrameImage({
      imagePrompt: scenePrompt,
      referenceImages,
    });

    return NextResponse.json({
      success: true,
      data: {
        imageBase64: imageResult.imageBase64,
        mimeType: imageResult.mimeType,
        prompt: scenePrompt,
      },
    });
  } catch (error) {
    console.error('[/api/ai/generate-scene-image] 오류:', error);

    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json({ success: false, error: 'Claude API 키가 설정되지 않았습니다.' }, { status: 503 });
    }
    if (error instanceof Error && (error.message.includes('overloaded') || error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED'))) {
      return NextResponse.json({ success: false, error: 'AI 서비스가 일시적으로 과부하 상태입니다.' }, { status: 503 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '씬 이미지 생성에 실패했습니다.' },
      { status: 500 },
    );
  }
}
