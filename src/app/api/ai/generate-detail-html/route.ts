/**
 * POST /api/ai/generate-detail-html
 *
 * 상품 이미지(1~5장) + 상품명/가격을 받아
 * Claude Vision으로 이미지를 분석하고, 상세 페이지 HTML을 생성하여 반환합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import sharp from "sharp";
import { getAnthropicClient } from "@/lib/ai/claude";
import {
  buildDetailPageUserPrompt,
  buildCategorySystemPrompt,
  parseDetailPageResponse,
  checkProhibitedPhrases,
  type ProductImageAnalysis,
  type DetailPageCategory,
} from "@/lib/ai/prompts/detail-page";
import { buildDetailPageHtml, buildDetailPageSnippet } from "@/lib/detail-page/html-builder";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/supabase/auth";
import { withRetry } from "@/lib/ai/resilience";
import { uploadToStorage } from "@/lib/supabase/server";
import { appendPrivacyFooter } from "@/lib/detail-page-privacy";

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const DETAIL_HTML_RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// Claude Vision이 이미지에서 뽑아낼 구조화 정보 (상세페이지 전용 간략 버전)
const IMAGE_VISION_PROMPT = `당신은 한국 이커머스 상품 분석 전문가입니다.
제공된 상품 이미지들을 종합 분석하여 아래 JSON만 출력하세요. 코드 블록, 마크다운, 설명 텍스트 금지.

{
  "material": "string (주요 소재 및 질감, 한국어 1문장)",
  "shape": "string (형태 및 구조 설명, 한국어 1문장)",
  "colors": ["string (한국어 색상명)"],
  "keyComponents": ["string (핵심 부품 또는 디자인 포인트, 한국어, 3~5개)"]
}`;

// ─────────────────────────────────────────
// 요청 검증 스키마 (Zod)
// ─────────────────────────────────────────

const ImageItemSchema = z.object({
  imageBase64: z
    .string()
    .min(1, "imageBase64는 비어있을 수 없습니다.")
    .transform((val) => {
      // data URL prefix 제거
      if (!val.startsWith("data:")) return val;
      const commaIdx = val.indexOf(",");
      if (commaIdx === -1) throw new Error("data URL 형식이 올바르지 않습니다.");
      return val.slice(commaIdx + 1);
    }),
  mimeType: z.enum(ALLOWED_MIME_TYPES, {
    error: `mimeType은 ${ALLOWED_MIME_TYPES.join(", ")} 중 하나여야 합니다.`,
  }),
});

const RequestSchema = z.object({
  images: z
    .array(ImageItemSchema)
    .min(1, '이미지는 최소 1장 이상이어야 합니다.')
    .max(5, '이미지는 최대 5장까지 허용됩니다.')
    .optional(),
  imageUrls: z
    .array(z.string().url('유효한 이미지 URL이 아닙니다.'))
    .max(5, '이미지 URL은 최대 5개까지 허용됩니다.')
    .optional(),
  productName: z.string().max(100).optional(),
  price: z.number().int().positive().optional(),
  /** 기존 상세페이지 HTML (있으면 보충 모드, 없으면 신규 생성 모드) */
  existingHtml: z.string().optional(),
  /** 스튜디오 감성 프롬프트 사용 여부 (신규 생성 모드에서만 적용) */
  studioMode: z.boolean().optional(),
  /** 카테고리별 최적화 프롬프트 선택 (기본값: 'basic') */
  category: z.enum(['basic', 'fashion', 'living', 'food'] as const).optional(),
  /** 소스 URL에서 추출한 실측 스펙 (이미지 분석보다 우선 반영) */
  productSpecs: z.array(z.object({ label: z.string(), value: z.string() })).max(20).optional(),
}).refine(
  (d) => (d.images && d.images.length > 0) || (d.imageUrls && d.imageUrls.length > 0),
  { message: 'images 또는 imageUrls 중 하나는 필수입니다.' },
);

type ValidatedRequest = z.infer<typeof RequestSchema>;

// ─────────────────────────────────────────
// 이미지 분석 로직 (Claude Vision 직접 호출)
// ─────────────────────────────────────────

/** Claude API 이미지 최대 허용 픽셀 (안전 마진 적용) */
const CLAUDE_MAX_IMAGE_DIMENSION = 7500;

/**
 * 이미지 base64를 받아 가로·세로 중 하나라도 7500px 초과 시 리사이즈합니다.
 * 비율을 유지하며 JPEG으로 출력합니다.
 */
async function resizeForClaude(
  imageBase64: string,
  mimeType: AllowedMimeType,
): Promise<{ imageBase64: string; mimeType: AllowedMimeType }> {
  const buffer = Buffer.from(imageBase64, "base64");
  const metadata = await sharp(buffer).metadata();
  const { width = 0, height = 0 } = metadata;

  if (width <= CLAUDE_MAX_IMAGE_DIMENSION && height <= CLAUDE_MAX_IMAGE_DIMENSION) {
    return { imageBase64, mimeType };
  }

  const resized = await sharp(buffer)
    .resize(CLAUDE_MAX_IMAGE_DIMENSION, CLAUDE_MAX_IMAGE_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { imageBase64: resized.toString("base64"), mimeType: "image/jpeg" };
}

// URL 배열을 fetch하여 base64 배열로 변환
async function fetchImagesFromUrls(
  urls: string[],
): Promise<Array<{ imageBase64: string; mimeType: AllowedMimeType }>> {
  return Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`이미지 다운로드 실패: ${url} (${res.status})`);
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const mimeType: AllowedMimeType =
        (ALLOWED_MIME_TYPES.find((m) => contentType.includes(m)) as AllowedMimeType | undefined) ??
        'image/jpeg';
      const buffer = Buffer.from(await res.arrayBuffer());
      return { imageBase64: buffer.toString('base64'), mimeType };
    }),
  );
}

async function analyzeImages(
  images: Array<{ imageBase64: string; mimeType: AllowedMimeType }>
): Promise<ProductImageAnalysis> {
  const client = getAnthropicClient();

  // Claude API 8000px 제한 — 초과 이미지 리사이즈
  const safeImages = await Promise.all(images.map((img) => resizeForClaude(img.imageBase64, img.mimeType)));

  const response = await withRetry(
    () =>
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              ...safeImages.map((img) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: img.mimeType as AllowedMimeType,
                  data: img.imageBase64,
                },
              })),
              { type: "text" as const, text: IMAGE_VISION_PROMPT },
            ],
          },
        ],
      }),
    { label: "Claude analyzeImages(detail-html)" }
  );

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // JSON 추출 및 파싱
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("이미지 분석 응답에서 JSON을 찾을 수 없습니다.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("이미지 분석 응답 JSON 파싱에 실패했습니다.");
  }

  const data = parsed as Record<string, unknown>;

  if (typeof data.material !== "string" || typeof data.shape !== "string") {
    throw new Error("이미지 분석 결과가 예상 형식과 다릅니다.");
  }

  return {
    material: data.material,
    shape: data.shape,
    colors: Array.isArray(data.colors)
      ? (data.colors as string[]).filter((c) => typeof c === "string")
      : [],
    keyComponents: Array.isArray(data.keyComponents)
      ? (data.keyComponents as string[]).filter((c) => typeof c === "string")
      : [],
  };
}

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface ApiSuccessResponse {
  success: true;
  html: string;
  snippet: string;      // 쿠팡용 780px
  naverSnippet: string; // 네이버용 860px
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  // 인증 검사
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    return authResult as unknown as NextResponse<ApiErrorResponse>;
  }

  // Rate Limit 검사
  const ip =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const rateLimitResult = checkRateLimit(
    getRateLimitKey(ip, "generate-detail-html"),
    DETAIL_HTML_RATE_LIMIT
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "X-RateLimit-Reset": rateLimitResult.resetAt.toString() },
      }
    );
  }

  // 요청 바디 파싱
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (e) {
    const contentLength = request.headers.get('content-length');
    console.error('[generate-detail-html] request.json() 실패:', String(e), { contentLength });
    return NextResponse.json(
      { success: false, error: "요청 바디를 JSON으로 파싱할 수 없습니다." },
      { status: 400 }
    );
  }

  // Zod 검증
  const parseResult = RequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    console.error('[generate-detail-html] Zod 검증 실패:', JSON.stringify(parseResult.error.issues));
    const firstIssue = parseResult.error.issues[0];
    return NextResponse.json(
      {
        success: false,
        error: firstIssue
          ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
          : "입력값 검증 실패",
      },
      { status: 400 }
    );
  }

  const { images: rawImages, imageUrls, productName, existingHtml, studioMode, productSpecs, category } = parseResult.data;

  // imageUrls가 있으면 서버에서 fetch → base64 변환 후 rawImages와 합산
  let images: Array<{ imageBase64: string; mimeType: AllowedMimeType }>;
  if (imageUrls && imageUrls.length > 0) {
    try {
      const fetched = await fetchImagesFromUrls(imageUrls);
      images = [...(rawImages ?? []), ...fetched].slice(0, 5) as Array<{ imageBase64: string; mimeType: AllowedMimeType }>;
    } catch (error) {
      console.error('[/api/ai/generate-detail-html] URL 이미지 다운로드 실패:', error);
      return NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error
              ? `이미지 다운로드 실패: ${error.message}`
              : '이미지 URL에서 이미지를 가져오는 중 오류가 발생했습니다.',
        },
        { status: 502 },
      );
    }
  } else {
    images = rawImages!;
  }

  // 이미지를 Supabase Storage에 업로드하여 공개 URL 확보
  const imagesWithUrls = await Promise.all(
    images.map(async (img, idx) => {
      try {
        const buffer = Buffer.from(img.imageBase64, "base64");
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
        const ext = img.mimeType === "image/png" ? "png" : img.mimeType === "image/webp" ? "webp" : "jpg";
        const path = `detail-pages/${Date.now()}-${idx}.${ext}`;
        const result = await uploadToStorage(path, arrayBuffer, img.mimeType, buffer.byteLength);
        return { ...img, publicUrl: result.url };
      } catch {
        return img;
      }
    })
  );

  // ── 보충 모드: 기존 HTML이 있으면 이미지와 분석 특장점을 기존 HTML에 삽입 ──
  if (existingHtml) {
    // 이미지 분석 (실패해도 graceful degradation — 이미지만 삽입으로 fallback)
    let imageAnalysis: ProductImageAnalysis | null = null;
    try {
      imageAnalysis = await analyzeImages(images);
    } catch (err) {
      console.warn('[generate-detail-html] 이미지 분석 실패 — 이미지만 삽입으로 fallback:', err);
    }

    const publicUrls = imagesWithUrls
      .map((img) => ('publicUrl' in img ? img.publicUrl : undefined))
      .filter((u): u is string => Boolean(u));

    const imgTagList = publicUrls
      .map((u) => `<div style="width:100%;padding:4px 0;"><img src="${u}" alt="상품 이미지" style="width:100%;display:block;" /></div>`)
      .join('\n');

    const featuresText = imageAnalysis
      ? `\n[AI 분석 특장점]\n소재: ${imageAnalysis.material}\n형태: ${imageAnalysis.shape}\n색상: ${imageAnalysis.colors.join(', ')}\n핵심 구성: ${imageAnalysis.keyComponents.join(', ')}`
      : '';

    const supplementUserPrompt =
      `아래 기존 상세페이지 HTML에 다음 이미지들과 추출된 특장점을 적절한 위치에 삽입하여 보충해주세요.\n` +
      `기존 텍스트·이미지·구조는 절대 삭제하거나 변경하지 마세요.\n` +
      (productName ? `상품명: ${productName}\n` : '') +
      featuresText +
      `\n\n[삽입할 이미지 태그]\n${imgTagList}\n\n` +
      `[기존 HTML]\n${existingHtml.slice(0, 30_000)}`;

    const supplementSystemPrompt =
      "당신은 한국 이커머스 상세페이지 HTML 편집 전문가입니다. " +
      "제공된 기존 HTML을 기반으로 이미지와 특장점 내용을 적절한 위치에 보충 삽입하세요. " +
      "기존 텍스트·이미지·구조는 절대 삭제하거나 교체하지 마세요. " +
      "번역투·어색한 표현 금지: '본 제품은', '해당 제품의', '~이 됩니다', '~에 의해', '제공되어집니다' 등 딱딱한 직역 표현 대신 쿠팡 상세페이지처럼 자연스러운 한국어 구어체를 사용합니다. " +
      "이미지 정책 (쿠팡 광고 가이드 준수): 이미지 위에 가격·홍보 문구·\"1위\"·\"세일\"·\"이벤트\" 같은 텍스트 오버레이 박스를 추가하지 않습니다. 기존 이미지의 src/alt는 그대로 유지하고, 새로운 가짜 뱃지·워터마크·콜라주 마크업을 만들지 않습니다. " +
      "수정된 HTML 전체만 출력하세요. 코드 블록, 마크다운, 설명 텍스트 금지.";

    let rawText: string;
    try {
      const client = getAnthropicClient();
      const resp = await withRetry(
        () =>
          client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 16384,
            system: supplementSystemPrompt,
            messages: [{ role: "user", content: supplementUserPrompt }],
          }),
        { label: "Claude supplementDetailHtml" }
      );
      rawText = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");
    } catch (error) {
      console.error("[/api/ai/generate-detail-html] 보충 모드 Claude 호출 실패:", error);
      return NextResponse.json(
        { success: false, error: error instanceof Error ? `HTML 보충 실패: ${error.message}` : "HTML 보충 중 오류가 발생했습니다." },
        { status: 502 }
      );
    }

    const htmlStart = rawText.indexOf("<html") !== -1 ? rawText.indexOf("<html") : rawText.indexOf("<div");
    const supplementedHtml = htmlStart !== -1 ? rawText.slice(htmlStart) : rawText.trim();

    const extractSnippet = (h: string) => {
      const openMatch = h.match(/<body[^>]*>/i);
      const closeIdx = h.toLowerCase().lastIndexOf("</body>");
      if (openMatch?.index !== undefined && closeIdx !== -1) {
        return h.slice(openMatch.index + openMatch[0].length, closeIdx).trim();
      }
      return h;
    };
    const htmlWithPrivacy = appendPrivacyFooter(supplementedHtml);
    const snippet = extractSnippet(htmlWithPrivacy);
    const naverSnippet = snippet.replace(/max-width\s*:\s*780px/g, "max-width:860px");

    return NextResponse.json({ success: true, html: htmlWithPrivacy, snippet, naverSnippet }, { status: 200 });
  }

  // ── 신규 생성 모드: 이미지만으로 HTML 생성 ──

  // 이미지 분석
  let imageAnalysis: ProductImageAnalysis;
  try {
    imageAnalysis = await analyzeImages(images);
  } catch (error) {
    console.error("[/api/ai/generate-detail-html] 이미지 분석 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? `이미지 분석 실패: ${error.message}`
            : "이미지 분석 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }

  // DetailPageContent 생성
  const client = getAnthropicClient();
  const userMessage = buildDetailPageUserPrompt(imageAnalysis, productName, productSpecs);

  let rawCopyText: string;
  try {
    const copyResponse = await withRetry(
      () =>
        client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: buildCategorySystemPrompt(
        (category ?? 'basic') as DetailPageCategory,
        studioMode ?? false,
      ),
          messages: [{ role: "user", content: userMessage }],
        }),
      { label: "Claude generateDetailPageContent" }
    );

    rawCopyText = copyResponse.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
  } catch (error) {
    console.error("[/api/ai/generate-detail-html] 카피 생성 실패:", error);

    if (error instanceof Error && error.message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { success: false, error: "서버 설정 오류: AI API 키가 구성되지 않았습니다." },
        { status: 503 }
      );
    }

    if (error instanceof Error && error.message.includes("overloaded")) {
      return NextResponse.json(
        {
          success: false,
          error: "AI 서비스가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? `카피 생성 실패: ${error.message}`
            : "카피 생성 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }

  // DetailPageContent 파싱
  let content;
  try {
    content = parseDetailPageResponse(rawCopyText);
  } catch (error) {
    console.error("[/api/ai/generate-detail-html] 카피 파싱 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? `카피 파싱 실패: ${error.message}`
            : "AI 응답 파싱 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }

  // 금지 문구 검사 — 위반 발견 시 서버 로그로 경고 (응답은 차단하지 않음)
  const allText = [
    content.headline,
    content.subheadline,
    ...content.sellingPoints.map((sp) => `${sp.title} ${sp.description}`),
    ...content.features.map((f) => `${f.title} ${f.description}`),
    ...content.usageSteps,
    ...content.warnings,
  ].join(' ');

  const { violations } = checkProhibitedPhrases(allText);
  if (violations.length > 0) {
    console.warn(
      `[generate-detail-html] 금지 문구 감지 (category=${category ?? 'basic'}):`,
      violations,
    );
  }

  // HTML 생성
  let html: string;
  let snippet: string;
  let naverSnippet: string;
  try {
    html = buildDetailPageHtml(content, imagesWithUrls, undefined, 780, studioMode ?? false);
    snippet = buildDetailPageSnippet(content, imagesWithUrls, undefined, 780, studioMode ?? false);
    naverSnippet = buildDetailPageSnippet(content, imagesWithUrls, undefined, 860, studioMode ?? false);
  } catch (error) {
    console.error("[/api/ai/generate-detail-html] HTML 빌드 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? `HTML 생성 실패: ${error.message}`
            : "HTML 생성 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    html: appendPrivacyFooter(html),
    snippet: appendPrivacyFooter(snippet),
    naverSnippet: appendPrivacyFooter(naverSnippet),
  }, { status: 200 });
}
