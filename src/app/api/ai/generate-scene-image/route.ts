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

const PRODUCT_FIDELITY_INSTRUCTION = `Using the attached product image(s) as a visual reference, study the product's overall shape, proportions, color palette, material texture, and key design details, then render it as a new photorealistic image naturally integrated in the scene. The product rendition should faithfully capture the reference's essential visual characteristics (form, color scheme, distinctive features) as an independent creative work — not a direct reproduction of the original photograph. IMPORTANT: Use EXACTLY the same quantity of items as shown in the reference image — do not add more items, do not duplicate products. SINGLE FRAME ONLY: Generate exactly one single continuous photograph — no split panels, diptychs, multi-view layouts, before/after comparisons, or composite image compositions.`;

const SCENE_PROMPT_SYSTEM = `You are an expert e-commerce product photographer and AI image prompt engineer.

Given one or more reference images of the SAME product (often photographed from different angles) and product information, create a highly detailed English prompt for Gemini image generation that will produce a professional commercial lifestyle scene.

Rules:
- The product from the reference image(s) MUST appear prominently in the generated scene
- Create a COMPLETE scene with the product naturally integrated — not just a background
- Be extremely specific: lighting quality, environment details, props, camera angle, mood, color palette
- Do NOT include any text, logos, watermarks, or price tags in the scene description
- The output must be a photorealistic commercial photography scene
- CRITICAL PRODUCT COUNT: The multiple reference images show the SAME single product from different angles — they do NOT represent multiple products. Carefully count the EXACT number of each item type that makes up ONE product unit (e.g., "1 spoon and 1 chopstick set" or "3 bottles sold together"). Your prompt MUST specify this EXACT count. NEVER duplicate or multiply items based on the number of reference images provided. State the count explicitly: "exactly 1 [item]" etc.
- CRITICAL: The generated prompt MUST end with this exact instruction: "${PRODUCT_FIDELITY_INSTRUCTION}"

Section type directions:
- hero: Clean studio shot with the product as the clear hero. Dramatic professional lighting, minimal elegant background, product centered.
- lifestyle: Product shown in its actual real-world use context. Creative authentic scene (e.g. fragrance diffuser hanging from a car rearview mirror, cutlery arranged on a fine dining table, skincare product on a marble bathroom counter). Natural or mood lighting.
- detail: Extreme close-up macro shot of the product's most distinctive material, texture, or craftsmanship detail. Very shallow depth of field, soft bokeh.
- feature: Aspirational scene that visually communicates the product's key function or benefit. Creative and conceptual but still photorealistic.

Return ONLY valid JSON: {"prompt": "your detailed English prompt here"}`;

// 합성 모드 전용 시스템 프롬프트: Claude가 "제품이 포함된 씬"이 아니라
// "빈 배경 플레이트" 프롬프트를 처음부터 작성하도록 한다. 기존에는
// SCENE_PROMPT_SYSTEM(제품 필수 등장)으로 쓴 프롬프트에 no-product suffix를
// 덧붙여 모순이 생겼고, Gemini가 절충안으로 카테고리 소품(라켓 등)을 지어냈다.
const BACKGROUND_PROMPT_SYSTEM = `You are an expert e-commerce art director writing a Gemini image-generation prompt for an EMPTY background plate.

A real cut-out photograph of the product will be composited onto this background later, placed at the lower-center of the frame and occupying roughly the lower half. Study the attached product reference image(s) ONLY to infer an appropriate setting, camera height, and lighting direction — the product itself must NOT appear in the background and must NOT be described in your prompt.

Rules:
- Describe ONLY the environment: the location, surfaces, lighting, and atmosphere.
- Absolutely NO products, merchandise, packaging, or any equipment/accessories from the product's category. NO people, hands, or body parts.
- Require a clean, unobstructed, well-lit horizontal surface (floor, table, or counter) across the LOWER-CENTER foreground where the product will rest.
- Specify a single consistent key light with a clear direction and believable grounded shadows, so the composited product can be matched to the scene.
- Be extremely specific: lighting quality, environment details, camera angle, mood, color palette.
- Photorealistic commercial photography only. No text, logos, watermarks, split panels, or collages.

Section type directions:
- lifestyle: an authentic real-world setting where the product would naturally be used — the location and surfaces only, natural daylight, grounded eye-level perspective, no equipment or items from the product's category present.
- detail: a macro-photography backdrop — a softly blurred neutral surface (marble, linen, concrete) with gentle diffused lighting.
- feature: a premium editorial studio backdrop with visual depth — a subtly textured dark surface with soft directional light, dramatic but physically plausible.

Return ONLY valid JSON: {"prompt": "your detailed English background prompt here"}`;

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

// ── 누끼(컷아웃) 검증 임계값 ──────────────────────────────────────────────
// 불투명 픽셀 비율이 상한을 넘으면 멀티 제품 콜라주/마케팅 컷(라켓 등 다른
// 물체 포함) 가능성이 높고, 하한 미만이면 rembg 실패(블롭)로 본다.
const CUTOUT_MAX_OPAQUE_RATIO = 0.6;
const CUTOUT_MIN_OPAQUE_RATIO = 0.03;

/** 누끼 PNG의 불투명(alpha>128) 픽셀 비율(0~1)을 계산한다. */
async function measureOpaqueRatio(png: Buffer): Promise<number> {
  const { data } = await sharp(png)
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (data.length === 0) return 0;
  let opaque = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i]! > 128) opaque++;
  }
  return opaque / data.length;
}

/**
 * 참조 이미지 테두리 영역의 그레이스케일 분산을 계산한다.
 * 배경이 균일한(단색 스튜디오 컷) 이미지일수록 값이 낮고,
 * rembg 누끼 품질이 좋을 가능성이 높다 — 시도 순서 정렬에 사용.
 */
async function borderVariance(ref: ReferenceImage): Promise<number> {
  const SIZE = 200;
  const RING = 20;
  const raw = await sharp(Buffer.from(ref.base64, 'base64'))
    .resize(SIZE, SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= RING && x < SIZE - RING && y >= RING && y < SIZE - RING) continue;
      const v = raw[y * SIZE + x]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return Number.MAX_SAFE_INTEGER;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * 합성용 누끼 선택: 배경이 균일한 참조부터 rembg를 시도하고,
 * 불투명 비율 검증을 통과한 첫 누끼를 반환한다. 전부 실패하면 null을
 * 반환해 비합성 경로(제품 ref를 Gemini에 직접 전달)로 fallback시킨다.
 * 주의: 후보당 Replicate 왕복 1회 — 최악의 경우 refs.length회 발생.
 */
async function selectCompositeCutout(refs: ReferenceImage[]): Promise<Buffer | null> {
  // 1. 배경 균일도 순 정렬 (실패 시 원래 순서 유지)
  let ordered = refs;
  if (refs.length > 1) {
    try {
      const scored = await Promise.all(
        refs.map(async (r, i) => ({ r, i, v: await borderVariance(r) })),
      );
      scored.sort((a, b) => a.v - b.v);
      ordered = scored.map((s) => s.r);
    } catch {
      /* 정렬 실패는 무시하고 원래 순서로 진행 */
    }
  }

  // 2. 순서대로 rembg → 검증
  for (let i = 0; i < ordered.length; i++) {
    const png = await removeBackgroundTransparent(ordered[i]!);
    if (!png) continue;
    try {
      const ratio = await measureOpaqueRatio(png);
      if (ratio > CUTOUT_MAX_OPAQUE_RATIO || ratio < CUTOUT_MIN_OPAQUE_RATIO) {
        console.warn(
          `[generate-scene-image] 누끼 검증 실패(후보 ${i}, opaque=${ratio.toFixed(2)}) — 다음 참조 시도`,
        );
        continue;
      }
      console.log(
        `[generate-scene-image] 합성 누끼 채택(후보 ${i}, opaque=${ratio.toFixed(2)})`,
      );
      return png;
    } catch {
      // 측정 자체가 실패하면 누끼를 그대로 사용 (기존 동작 보존)
      return png;
    }
  }
  console.warn('[generate-scene-image] 유효한 누끼 없음 — 비합성 경로로 fallback');
  return null;
}

// ── 합성 후 리파인 패스 (환경변수 SCENE_COMPOSITE_REFINE=true 일 때만) ─────
// Sharp 합성 결과를 Gemini에 유일한 참조로 넘겨 조명/그림자/가장자리만
// 정합시킨다. 제품을 다시 그릴 위험이 있으므로 기본 OFF — 반드시 플래그로만.
const COMPOSITE_REFINE_PROMPT =
  'This is a composite photograph: a real product photo has been placed onto a generated background. ' +
  'Refine it into a seamless photorealistic image. STRICT RULES: keep the product\'s exact shape, colors, ' +
  'proportions, position, and every visible detail pixel-faithful — do NOT add, remove, move, resize, or ' +
  'redraw any object, and do NOT alter the product in any way. ONLY harmonize: match the lighting and color ' +
  'temperature between the product and the background, correct the contact shadow so the product sits ' +
  'naturally on the surface, and soften the cut-out edges. Output a single continuous photograph, no text.';

// ── 합성 모드 배경 검증(안전망) ────────────────────────────────────────────
const VISION_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * 생성된 배경에 제품/카테고리 장비가 섞였는지 Haiku vision으로 검증한다.
 * yes/no 단답 1회 — 저비용(claude-haiku-4-5). 검증 API 오류는 절대 응답을
 * 막지 않도록 false(통과)로 처리한다.
 */
async function backgroundContainsProduct(
  imageBase64: string,
  mimeType: string,
  productName?: string,
): Promise<boolean> {
  try {
    const client = getAnthropicClient();
    const mediaType = (VISION_MEDIA_TYPES.has(mimeType) ? mimeType : 'image/png') as
      | 'image/jpeg'
      | 'image/png'
      | 'image/gif'
      | 'image/webp';
    const identity = productName?.trim()
      ? ` or anything related to "${productName.trim()}" or its product category`
      : '';
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            {
              type: 'text',
              text:
                'This image should be an EMPTY background scene with no products. ' +
                `Does it contain any product, merchandise, packaging, sports equipment${identity}? ` +
                'Answer strictly "yes" or "no".',
            },
          ],
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
    return /^\s*yes/i.test(text);
  } catch (err) {
    console.warn('[generate-scene-image] 배경 검증 호출 실패 — 검증 생략:', err);
    return false;
  }
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

  // 제품 높이: 배경 높이의 58%, 비율 유지.
  // 단, 작은 누끼를 크게 확대하면 페더/디테일이 뭉개져(멜팅) AI 티가 나므로
  // 원본(trim 후) 높이의 1.4배까지만 업스케일을 허용한다.
  const trimmedMeta = await sharp(trimmed).metadata();
  const trimmedH = trimmedMeta.height ?? 0;
  const idealH = Math.round(bgH * 0.58);
  const targetH = trimmedH > 0 ? Math.min(idealH, Math.round(trimmedH * 1.4)) : idealH;
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
    // selectCompositeCutout: 균일 배경 참조 우선 + 불투명 비율 검증 통과분만 사용.
    // 유효 누끼가 없으면 null → 기존 비합성 경로(product ref를 Gemini에 전달)로 fallback
    let compositeProductPng: Buffer | null = null;
    if (COMPOSITE_SECTIONS.has(sectionType) && productRefs.length > 0) {
      // 누끼 소스는 무손실 PNG로 별도 로딩한다: q80 JPEG 재압축을 거친 refs를
      // rembg에 넣으면 페더 등 미세 가장자리가 뭉개진다. URL 참조는 fetch가
      // 1회 더 발생하지만 합성 모드 한정이며, 실패 시 기존 q80 refs로 폴백.
      let cutoutSources: ReferenceImage[] = productRefs;
      try {
        const hifi = await loadReferenceImages(
          {
            referenceImages: parsed.data.referenceImages,
            productImageUrls: parsed.data.productImageUrls,
            productImageBase64: parsed.data.productImageBase64,
            productImageMimeType: parsed.data.productImageMimeType,
            productImageUrl: parsed.data.productImageUrl,
          },
          { lossless: true },
        );
        if (hifi.length > 0) cutoutSources = hifi;
      } catch {
        /* 무손실 로딩 실패 시 q80 refs 사용 */
      }
      compositeProductPng = await selectCompositeCutout(cutoutSources);
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

      // 합성 모드(비편집)에서는 배경 전용 브리프를 사용한다. 편집 모드는
      // "기존 씬 수정" 사용자 프롬프트와 충돌하므로 기존 경로를 유지한다.
      const isCompositeBackground = !!compositeProductPng && !isEditMode;
      const systemPrompt = isCompositeBackground ? BACKGROUND_PROMPT_SYSTEM : SCENE_PROMPT_SYSTEM;

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
        text: buildSceneUserPrompt(sectionType, productInfo, sceneHint, {
          isEditMode,
          instruction,
          isCompositeBackground,
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claudeRes = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: systemPrompt,
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

      // 방어적 스트립: 배경 브리프(BACKGROUND_PROMPT_SYSTEM)는 fidelity 지시를
      // 요구하지 않지만, 모델이 학습된 패턴을 따라 에코할 가능성에 대비해
      // PRODUCT_FIDELITY_INSTRUCTION이 있으면 제거한다(없으면 no-op).
      // 편집+합성 경로는 여전히 SCENE_PROMPT_SYSTEM을 쓰므로 이 스트립이 필수다.
      const bgPrompt = claudePrompt.replace(PRODUCT_FIDELITY_INSTRUCTION, '').trim();
      finalScenePrompt = compositeProductPng
        ? `${bgPrompt}${buildNoProductSuffix(sectionType, productInfo?.headline)}` // 합성 모드: 배경만 생성
        : claudePrompt; // fallback: Claude 프롬프트 그대로 (PRODUCT_FIDELITY_INSTRUCTION 이미 포함)
    }

    // Step 2: Gemini로 씬 생성 (합성 모드: 배경만 / fallback: 제품 포함)
    let imageResult = await generateFrameImage({
      imagePrompt: finalScenePrompt,
      referenceImages: allImages,
    });

    // Step 2.5: 합성 모드 안전망 — 배경에 제품/카테고리 장비가 섞였는지 검증.
    // 비용/지연: 합성 요청당 Haiku vision 최대 2회 + Gemini 재생성 최대 1회 추가
    // (오염이 없으면 Haiku 1회뿐). 위반 시 정확히 1회만 재생성하고, 재검증도
    // 실패하면 마지막 배경을 그대로 채택한다(루프 없음). 검증 오류는 통과 처리.
    if (compositeProductPng) {
      const contaminated = await backgroundContainsProduct(
        imageResult.imageBase64,
        imageResult.mimeType,
        productInfo?.headline,
      );
      if (contaminated) {
        console.warn('[generate-scene-image] 배경에서 제품/장비 검출 — 1회 재생성');
        try {
          const retry = await generateFrameImage({
            imagePrompt:
              `${finalScenePrompt}\n\nPREVIOUS ATTEMPT REJECTED: the generated background contained a product, ` +
              'merchandise, or category equipment. Regenerate the same scene with ABSOLUTELY NO products, ' +
              'merchandise, equipment, or accessories of any kind — an empty environment only.',
            referenceImages: allImages,
          });
          const stillContaminated = await backgroundContainsProduct(
            retry.imageBase64,
            retry.mimeType,
            productInfo?.headline,
          );
          imageResult = retry; // 마지막 배경 채택
          if (stillContaminated) {
            console.warn('[generate-scene-image] 재생성 후에도 검출 — 마지막 배경으로 진행');
          }
        } catch (err) {
          console.warn('[generate-scene-image] 배경 재생성 실패 — 최초 배경 사용:', err);
        }
      }
    }

    // Step 3: 합성 모드 — Gemini 배경 위에 원본 제품(투명 PNG) 합성
    let finalBase64 = imageResult.imageBase64;
    let finalMime = imageResult.mimeType;
    if (compositeProductPng) {
      const bgBuffer = Buffer.from(imageResult.imageBase64, 'base64');
      const composited = await compositeProductOnBackground(bgBuffer, compositeProductPng);
      finalBase64 = composited.toString('base64');
      finalMime = 'image/jpeg';

      // Step 3.5: (플래그) 조명/그림자/가장자리 정합 리파인 — 기본 OFF.
      // Gemini가 제품을 재드로잉할 위험이 있어 SCENE_COMPOSITE_REFINE=true
      // 환경변수로만 활성화한다. 실패 시 Sharp 합성 원본을 그대로 사용.
      if (process.env.SCENE_COMPOSITE_REFINE === 'true') {
        try {
          const refined = await generateFrameImage({
            imagePrompt: COMPOSITE_REFINE_PROMPT,
            referenceImages: [{ base64: finalBase64, mimeType: 'image/jpeg' }],
          });
          finalBase64 = refined.imageBase64;
          finalMime = refined.mimeType;
        } catch (err) {
          console.warn('[generate-scene-image] 합성 리파인 실패 — Sharp 합성본 사용:', err);
        }
      }
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
