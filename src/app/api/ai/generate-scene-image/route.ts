import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { generateFrameImage } from '@/lib/ai/imagen';
import { loadReferenceImages, type ReferenceImage } from '@/lib/ai/reference-images';
import { buildSceneUserPrompt } from './user-prompt';
import { removeBackgroundTransparent } from '@/lib/ai/remove-background';
import {
  PRODUCT_FIDELITY_INSTRUCTION,
  SCENE_PROMPT_SYSTEM,
  BACKGROUND_PROMPT_SYSTEM,
  COMPOSITE_REFINE_PROMPT,
  buildNoProductSuffix,
} from './prompts';

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
    // 씬 컨텍스트 확장 — 상세는 user-prompt.ts의 SceneProductInfo 주석 참조.
    // 길이 상한은 Claude 입력이 비대해지는 것을 막기 위한 것이며,
    // 초과 시 400이 나므로 호출부에서 잘라 보낼 것.
    material: z.string().max(200).optional(),
    colors: z.array(z.string().max(50)).max(12).optional(),
    category: z.string().max(100).optional(),
    targetCustomer: z.string().max(100).optional(),
    season: z.string().max(100).optional(),
    priceTier: z.string().max(100).optional(),
    avoid: z.array(z.string().max(120)).max(10).optional(),
  }).optional(),
  sceneHint: z.string().max(600).optional(),
  // 스토리보드 직접 프롬프트: 있으면 Claude 단계 건너뛰고 Gemini에 바로 전달
  scenePrompt: z.string().max(2000).optional(),
  // 편집 모드: 기존 씬 이미지 URL (있으면 편집, 없으면 새 생성)
  baseImageUrl: z.string().url().optional(),
  // 편집 지시어 또는 새 생성 art direction
  instruction: z.string().max(500).optional(),
});

// lifestyle/detail/feature: 제품 합성 방식 (Gemini에 배경만 생성 → Sharp 합성)
const COMPOSITE_SECTIONS = new Set<string>(['lifestyle', 'detail', 'feature']);

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

  const {
    sectionType,
    productInfo,
    sceneHint,
    scenePrompt: directPrompt,
    baseImageUrl,
    instruction,
  } = parsed.data;
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
      // 1200: 600이면 인물이 등장하는 씬에서 응답이 잘린다. SCENE_PROMPT_SYSTEM이 요구하는
      // 조명·환경·소품·앵글·무드·색 서술에 더해, 프롬프트가 PRODUCT_FIDELITY_INSTRUCTION
      // (인물 품질 조건절 포함, 약 250토큰)으로 끝나야 하기 때문이다.
      // 잘리면 JSON에 닫는 중괄호가 없어 아래 파싱이 실패한다(실물 검증에서 발견).
      const claudeRes = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent as any }],
      });

      const rawText = claudeRes.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // 잘림과 형식 이상을 구분한다. 전자는 max_tokens를 올려야 하고 후자는
        // 프롬프트를 고쳐야 하는데, 메시지가 같으면 원인을 찾는 데 시간이 든다.
        const truncated = claudeRes.stop_reason === 'max_tokens';
        throw new Error(
          truncated
            ? `Claude 응답이 max_tokens에서 잘려 JSON이 닫히지 않았습니다(sectionType=${sectionType}).`
            : 'Claude 응답에서 JSON을 찾을 수 없습니다.',
        );
      }
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
