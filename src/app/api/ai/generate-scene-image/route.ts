import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { generateFrameImage } from '@/lib/ai/imagen';
import { loadReferenceImages, type ReferenceImage } from '@/lib/ai/reference-images';
import { buildSceneUserPrompt } from './prompt';
import { removeBackgroundTransparent } from '@/lib/ai/remove-background';

export const maxDuration = 120;

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

// lifestyle/detail/feature: 제품 합성 방식 (Gemini에 배경만 생성 → Sharp 합성)
const COMPOSITE_SECTIONS = new Set<string>(['lifestyle', 'detail', 'feature']);

// 공통: 제품 제외 지시
const NO_PRODUCT_BASE =
  '\n\nCRITICAL: Do NOT include any product, item, bottle, jar, package, container, pill, capsule, or any tangible object in this generated image. ' +
  'Generate ONLY the background environment — the setting, surface, lighting, and atmosphere. ' +
  'The product will be composited onto this background separately. ' +
  // 합성 제품이 바닥에 놓인 것처럼 보이도록 하부 전경에 명확한 지면과 일관된 광원을 확보한다.
  'Leave a clear, unobstructed, well-lit horizontal surface (ground, floor, table, or counter) across the LOWER-CENTER foreground where a product will naturally rest. ' +
  'Use a single consistent light source with believable, grounded shadows so a composited product will match the scene lighting and cast direction.';

// 섹션 타입별 배경 분위기 보강 지시
const SECTION_BG_HINTS: Record<string, string> = {
  feature:
    ' Use rich, atmospheric studio lighting with a premium, high-contrast look. ' +
    'The background should have visual depth — a subtly textured dark surface (matte fabric, brushed metal, stone, deep gradient) ' +
    'with soft directional light that creates a dramatic, editorial feel. Avoid plain white or empty-looking backgrounds.',
  detail:
    ' Use a clean macro-photography backdrop: a softly blurred, slightly warm or cool neutral surface ' +
    '(marble, linen, concrete) with gentle diffused lighting to highlight material texture.',
  lifestyle:
    ' Create an authentic, true-to-life real-world SETTING where this product would naturally be used — ' +
    'the location, surfaces, and atmosphere only, with NO equipment, gear, or items from the product\'s category present, ' +
    'shot like a real editorial/commercial photograph with natural daylight and a grounded, eye-level perspective. ' +
    'AVOID the typical "AI look": no heavy bokeh/blur haze, no dreamy glow or bloom, no lens flare, no oversaturation, ' +
    'and NO blurry, faceless, or ghost-like human figures in the background. Keep lighting and shadows physically consistent.',
};

// 동일 카테고리 연관 물품(장비·액세서리·동반 제품)까지 금지 — "환경 소품"으로
// 위장한 카테고리 물품(예: 셔틀콕 씬의 라켓)이 배경에 등장하는 것을 막는다.
const NO_CATEGORY_PROPS =
  ' Do NOT include the product itself OR any related equipment, accessories, tools, companion products, or merchandise from the same product category ' +
  '(e.g., if the product is a shuttlecock: no rackets, no racket bags, no nets, no players; if it is a phone case: no phones). ' +
  'The scene must contain NO recognizable product of any kind — an empty, prop-light environment only.';

function buildNoProductSuffix(sectionType: string, productName?: string): string {
  const hint = SECTION_BG_HINTS[sectionType] ?? '';
  const trimmedName = productName?.trim();
  const identity = trimmedName
    ? ` The product being sold is: "${trimmedName}". Nothing resembling it or its category may appear in this background.`
    : '';
  return NO_PRODUCT_BASE + NO_CATEGORY_PROPS + identity + hint;
}

async function compositeProductOnBackground(
  bgBuffer: Buffer,
  productPng: Buffer,
): Promise<Buffer> {
  const bgMeta = await sharp(bgBuffer).metadata();
  const bgW = bgMeta.width ?? 1024;
  const bgH = bgMeta.height ?? 1024;

  // 누끼 PNG의 투명 여백을 먼저 제거한다. 여백이 남으면 제품이 접지선/그림자
  // 위에 떠 보인다(잘라 붙인 듯한 AI 티의 원인). trim 실패 시 원본 사용.
  let trimmed = productPng;
  try {
    trimmed = await sharp(productPng).trim().png().toBuffer();
  } catch {
    // 전부 투명/균일 등으로 trim이 실패하면 원본을 쓴다.
  }

  // 제품 높이: 배경 높이의 58%, 비율 유지
  const targetH = Math.round(bgH * 0.58);
  const productResized = await sharp(trimmed)
    .resize(null, targetH, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  const pMeta = await sharp(productResized).metadata();
  const pW = pMeta.width ?? 0;
  const pH = pMeta.height ?? 0;

  // 접지선: 제품 "바닥"이 배경 하단 ~88%에 닿게 배치해 공중에 뜨지 않도록 한다.
  const groundLine = Math.round(bgH * 0.88);
  const left = Math.max(0, Math.round((bgW - pW) / 2));
  const top = Math.max(0, groundLine - pH);

  // 접지 그림자: 제품 실루엣(알파)을 세로로 눌러 블러 + 반투명 검정으로 만들어
  // 바닥에 깔면 "붙어있는" 느낌이 생겨 잘라 붙인 듯한 AI 티가 줄어든다.
  const shadowH = Math.max(8, Math.round(pH * 0.16));
  const shadowMask = await sharp(productResized)
    .ensureAlpha()
    .extractChannel('alpha')
    .resize(pW, shadowH, { fit: 'fill' })
    .blur(16)
    .linear(0.5, 0) // 알파 값을 낮춰 반투명 그림자
    .toBuffer();
  const shadow = await sharp({
    create: { width: pW, height: shadowH, channels: 3, background: { r: 15, g: 15, b: 18 } },
  })
    .joinChannel(shadowMask)
    .png()
    .toBuffer();
  const shadowTop = Math.min(bgH - shadowH, Math.round(groundLine - shadowH / 2));

  return sharp(bgBuffer)
    .composite([
      { input: shadow, left, top: shadowTop },
      { input: productResized, left, top },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

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

    // Point 씬(lifestyle/detail/feature): 누끼 → 배경만 Gemini 생성 → Sharp 합성
    // 합성 실패 시 기존 방식(product ref 포함해서 Gemini에 전달)으로 자동 fallback
    let compositeProductPng: Buffer | null = null;
    if (COMPOSITE_SECTIONS.has(sectionType) && productRefs.length > 0) {
      compositeProductPng = await removeBackgroundTransparent(productRefs[0]);
    }

    // 합성 성공 시 Gemini에 product ref 미전달 (배경만 생성하도록)
    // 합성 실패 시 기존 방식: base + productRefs 모두 전달
    const allImages = [...baseImages, ...(compositeProductPng ? [] : productRefs)].slice(0, 3);

    // Step 1: 씬 프롬프트 결정 (스토리보드 직접 전달 시 Claude 우회)
    let finalScenePrompt: string;

    if (directPrompt) {
      // storyboard.prompt를 직접 사용 — Claude API 호출 없음
      finalScenePrompt = compositeProductPng
        ? `${directPrompt}${buildNoProductSuffix(sectionType, productInfo?.headline)}` // 합성 모드: 배경만 생성
        : `${directPrompt}\n\n${PRODUCT_FIDELITY_INSTRUCTION}`; // fallback: 기존 방식
    } else {
      // Claude Sonnet으로 섹션별 씬 프롬프트 생성
      const client = getAnthropicClient();

      type ContentBlock =
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
        | { type: 'text'; text: string };

      const userContent: ContentBlock[] = [];

      // Claude에는 reference 이미지를 그대로 전달 (프롬프트 생성용)
      const claudeRefImages = [...baseImages, ...productRefs].slice(0, 3);
      for (const ref of claudeRefImages) {
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

      // 합성 모드: Claude가 SCENE_PROMPT_SYSTEM 규칙상 항상 끝에 붙이는
      // PRODUCT_FIDELITY_INSTRUCTION("첨부 이미지의 제품을 씬에 렌더링하라")을
      // 제거한다. 남겨두면 "제품을 그려라"와 "어떤 물체도 그리지 마라"(no-product
      // suffix)가 한 프롬프트에서 충돌해 Gemini가 카테고리 소품을 지어낸다.
      const bgPrompt = claudePrompt.replace(PRODUCT_FIDELITY_INSTRUCTION, '').trim();
      finalScenePrompt = compositeProductPng
        ? `${bgPrompt}${buildNoProductSuffix(sectionType, productInfo?.headline)}` // 합성 모드: 배경만 생성
        : claudePrompt; // fallback: Claude 프롬프트 그대로 (PRODUCT_FIDELITY_INSTRUCTION 이미 포함)
    }

    // Step 2: Gemini로 씬 생성 (합성 모드: 배경만 / fallback: 제품 포함)
    const imageResult = await generateFrameImage({
      imagePrompt: finalScenePrompt,
      referenceImages: allImages,
    });

    // Step 3: 합성 모드 — Gemini 배경 위에 원본 제품(투명 PNG) 합성
    let finalBase64 = imageResult.imageBase64;
    let finalMime = imageResult.mimeType;
    if (compositeProductPng) {
      const bgBuffer = Buffer.from(imageResult.imageBase64, 'base64');
      const composited = await compositeProductOnBackground(bgBuffer, compositeProductPng);
      finalBase64 = composited.toString('base64');
      finalMime = 'image/jpeg';
    }

    return NextResponse.json({
      success: true,
      data: {
        imageBase64: finalBase64,
        mimeType: finalMime,
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
