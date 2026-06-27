import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { generateFrameImage } from '@/lib/ai/imagen';
import { loadReferenceImages, type ReferenceImage } from '@/lib/ai/reference-images';
import { buildSceneUserPrompt } from './prompt';
import { removeImageBackgrounds } from '@/lib/ai/remove-background';

export const maxDuration = 90;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 8 };
const EDIT_RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 };

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
  sceneHint: z.string().max(600).optional(),
  // 스토리보드 직접 프롬프트: 있으면 Claude 단계 건너뛰고 Gemini에 바로 전달
  scenePrompt: z.string().max(2000).optional(),
  // 편집 모드: 기존 씬 이미지 URL (있으면 편집, 없으면 새 생성)
  baseImageUrl: z.string().url().optional(),
  // 편집 지시어 또는 새 생성 art direction
  instruction: z.string().max(500).optional(),
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
- CRITICAL: The generated prompt MUST end with this exact instruction: "Using the attached product image(s) as a visual reference, study the product's overall shape, proportions, color palette, material texture, and key design details, then render it as a new photorealistic image naturally integrated in the scene. The product rendition should faithfully capture the reference's essential visual characteristics (form, color scheme, distinctive features) as an independent creative work — not a direct reproduction of the original photograph. IMPORTANT: Use EXACTLY the same quantity of items as shown in the reference image — do not add more items, do not duplicate products. SINGLE FRAME ONLY: Generate exactly one single continuous photograph — no split panels, diptychs, multi-view layouts, before/after comparisons, or composite image compositions."

Section type directions:
- hero: Clean studio shot with the product as the clear hero. Dramatic professional lighting, minimal elegant background, product centered.
- lifestyle: Product shown in its actual real-world use context. Creative authentic scene (e.g. fragrance diffuser hanging from a car rearview mirror, cutlery arranged on a fine dining table, skincare product on a marble bathroom counter). Natural or mood lighting.
- detail: Extreme close-up macro shot of the product's most distinctive material, texture, or craftsmanship detail. Very shallow depth of field, soft bokeh.
- feature: Aspirational scene that visually communicates the product's key function or benefit. Creative and conceptual but still photorealistic.

Return ONLY valid JSON: {"prompt": "your detailed English prompt here"}`;

const PRODUCT_FIDELITY_INSTRUCTION = `Using the attached product image(s) as a visual reference, study the product's overall shape, proportions, color palette, material texture, and key design details, then render it as a new photorealistic image naturally integrated in the scene. The product rendition should faithfully capture the reference's essential visual characteristics (form, color scheme, distinctive features) as an independent creative work — not a direct reproduction of the original photograph. IMPORTANT: Use EXACTLY the same quantity of items as shown in the reference image — do not add more items, do not duplicate products. SINGLE FRAME ONLY: Generate exactly one single continuous photograph — no split panels, diptychs, multi-view layouts, before/after comparisons, or composite image compositions.`;

const BACKGROUND_REMOVAL_SECTIONS = new Set<string>(['lifestyle', 'detail', 'feature']);

const BG_REMOVED_PREFIX =
  'The reference image(s) provided have had their backgrounds removed — only the product itself is visible with a clean white background. ';

const BG_REMOVED_STRICT =
  ' STRICT FIDELITY CONSTRAINT: The reference shows the exact product to reproduce. Do NOT redesign, recolor, or reinterpret the product in any way — same shape, same color palette, same material texture, same proportions, same number of items. Treat it as a pixel-accurate reference for the product only.';

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const bodyForRL = await req.clone().json().catch(() => ({})) as { baseImageUrl?: string };
  let isEditMode = !!bodyForRL.baseImageUrl;
  const rl = checkRateLimit(
    getRateLimitKey(ip, isEditMode ? 'edit-scene-image' : 'generate-scene-image'),
    isEditMode ? EDIT_RATE_LIMIT : RATE_LIMIT,
  );
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

  const { sectionType, productInfo, sceneHint, scenePrompt: directPrompt, baseImageUrl, instruction } = parsed.data;
  isEditMode = !!baseImageUrl; // Zod 검증된 값으로 덮어쓰기

  try {
    // 편집 모드: base 이미지를 첫 번째 reference로 로딩 (실패 시 명시적 에러)
    let baseImages: ReferenceImage[] = [];
    if (baseImageUrl) {
      baseImages = await loadReferenceImages({ productImageUrls: [baseImageUrl] });
      if (baseImages.length === 0) {
        return NextResponse.json(
          { success: false, error: '현재 씬 이미지를 불러오지 못했습니다. 이미지 URL이 만료되었거나 접근이 제한되었습니다.' },
          { status: 422 },
        );
      }
    }

    // 상품 레퍼런스 이미지 로딩 (편집 모드는 base 1장을 이미 소비 → 최대 2장)
    const productRefs = await loadReferenceImages({
      referenceImages: parsed.data.referenceImages,
      productImageUrls: parsed.data.productImageUrls,
      productImageBase64: parsed.data.productImageBase64,
      productImageMimeType: parsed.data.productImageMimeType,
      productImageUrl: parsed.data.productImageUrl,
    });

    // Point 씬(lifestyle/detail/feature): productRefs 배경 제거 후 전달
    let cleanRefs = productRefs;
    let bgRemoved = false;
    if (BACKGROUND_REMOVAL_SECTIONS.has(sectionType) && productRefs.length > 0) {
      const bgResult = await removeImageBackgrounds(productRefs);
      cleanRefs = bgResult.refs;
      bgRemoved = bgResult.anyRemoved;
    }

    // base 먼저, 그다음 product refs (합산 최대 3장)
    const allImages = [...baseImages, ...cleanRefs].slice(0, 3);

    // Step 1: 씬 프롬프트 결정 (스토리보드 직접 전달 시 Claude 우회)
    let finalScenePrompt: string;

    if (directPrompt) {
      // storyboard.prompt를 직접 사용 — Claude API 호출 없음 (로컬 환경 호환, edit 모드에서도 동일)
      const bgPrefix = bgRemoved ? BG_REMOVED_PREFIX : '';
      const bgSuffix = bgRemoved ? BG_REMOVED_STRICT : '';
      finalScenePrompt = `${directPrompt}\n\n${bgPrefix}${PRODUCT_FIDELITY_INSTRUCTION}${bgSuffix}`;
    } else {
      // Claude Sonnet으로 섹션별 씬 프롬프트 생성
      const client = getAnthropicClient();

      type ContentBlock =
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
        | { type: 'text'; text: string };

      const userContent: ContentBlock[] = [];

      for (const ref of allImages) {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: ref.mimeType, data: ref.base64 },
        });
      }

      userContent.push({
        type: 'text',
        text: buildSceneUserPrompt(sectionType, productInfo, sceneHint, { isEditMode, instruction }),
      });

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
      const claudePrompt = promptData.prompt;
      if (!claudePrompt) throw new Error('Claude가 프롬프트를 생성하지 못했습니다.');
      // Claude는 SCENE_PROMPT_SYSTEM 지시에 따라 PRODUCT_FIDELITY_INSTRUCTION을 이미 포함함
      finalScenePrompt = bgRemoved
        ? `${BG_REMOVED_PREFIX}${claudePrompt}${BG_REMOVED_STRICT}`
        : claudePrompt;
    }

    // Step 2: Gemini로 완성된 씬 이미지 생성
    const imageResult = await generateFrameImage({
      imagePrompt: finalScenePrompt,
      referenceImages: allImages,
    });

    return NextResponse.json({
      success: true,
      data: {
        imageBase64: imageResult.imageBase64,
        mimeType: imageResult.mimeType,
        prompt: finalScenePrompt,
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
