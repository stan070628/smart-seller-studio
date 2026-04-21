/**
 * POST /api/ai/edit-detail-html
 *
 * 이미 생성된 상세페이지 HTML과 사용자의 수정 지시문을 받아
 * Claude를 통해 HTML을 수정하여 반환합니다.
 *
 * - 인증: requireAuth (JWT 쿠키 검증)
 * - Rate Limit: 분당 10회
 * - AI 호출: claude-sonnet-4-6, withRetry 래핑
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAnthropicClient } from "@/lib/ai/claude";
import { withRetry } from "@/lib/ai/resilience";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { requireAuth } from "@/lib/supabase/auth";

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 분당 10회 제한 */
const EDIT_HTML_RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

/**
 * HTML 구조와 이미지 태그를 유지하면서 텍스트/스타일만 수정하도록 지시.
 * 출력은 수정된 HTML 전체만 허용하며 마크다운·설명·코드블록 금지.
 */
const EDIT_SYSTEM_PROMPT =
  "당신은 한국 이커머스 상세페이지 HTML 편집 전문가입니다. " +
  "제공된 HTML을 사용자 지시에 따라 수정하되, HTML 구조와 이미지 태그는 그대로 유지하세요. " +
  "수정된 HTML 전체만 출력하세요. 코드 블록, 마크다운, 설명 텍스트 금지.";

/** Claude에 전달할 HTML의 최대 글자 수 (초과 시 앞부분만 사용) */
const HTML_CHAR_LIMIT = 3_000;

// ─────────────────────────────────────────
// 요청 검증 스키마 (Zod)
// ─────────────────────────────────────────

const RequestSchema = z.object({
  /** 현재 상세페이지 전체 HTML */
  currentHtml: z.string().min(1, "currentHtml은 비어있을 수 없습니다."),
  /** 쿠팡용 스니펫 (없으면 currentHtml에서 처리) */
  currentSnippet: z.string().optional(),
  /** 수정 지시문 (예: "톤을 더 감성적으로 바꿔줘") */
  instruction: z
    .string()
    .min(1, "instruction은 비어있을 수 없습니다.")
    .max(500, "instruction은 500자 이내여야 합니다."),
  /** 상품명 컨텍스트 (선택) */
  productName: z.string().max(100).optional(),
});

type ValidatedRequest = z.infer<typeof RequestSchema>;

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
// 헬퍼 함수
// ─────────────────────────────────────────

/**
 * Claude 응답 텍스트에서 HTML만 추출합니다.
 * `<html` 또는 `<div` 태그로 시작하는 위치부터 슬라이싱.
 * 어떤 태그도 발견되지 않으면 원문 그대로 반환.
 */
function extractHtml(rawText: string): string {
  const trimmed = rawText.trim();

  const htmlTagIdx = trimmed.indexOf("<html");
  if (htmlTagIdx !== -1) return trimmed.slice(htmlTagIdx);

  const divTagIdx = trimmed.indexOf("<div");
  if (divTagIdx !== -1) return trimmed.slice(divTagIdx);

  return trimmed;
}

/**
 * 전체 HTML에서 스니펫(body 내부 콘텐츠)을 추출합니다.
 *
 * - `<body>` 태그가 있으면 body 내부만 반환
 * - 없으면 HTML 전체를 그대로 반환
 */
function extractSnippet(html: string): string {
  const bodyOpenMatch = html.match(/<body[^>]*>/i);
  const bodyCloseIdx = html.toLowerCase().lastIndexOf("</body>");

  if (bodyOpenMatch && bodyOpenMatch.index !== undefined && bodyCloseIdx !== -1) {
    const contentStart = bodyOpenMatch.index + bodyOpenMatch[0].length;
    return html.slice(contentStart, bodyCloseIdx).trim();
  }

  return html;
}

/**
 * 쿠팡 스니펫(780px)을 네이버 스니펫(860px)으로 변환합니다.
 * max-width 인라인 스타일 값만 교체합니다.
 */
function toNaverSnippet(snippet: string): string {
  return snippet.replace(/max-width\s*:\s*780px/g, "max-width:860px");
}

/**
 * Claude에 전달할 user 프롬프트를 구성합니다.
 * currentHtml이 HTML_CHAR_LIMIT을 초과하면 앞 3000자만 사용합니다.
 */
function buildUserPrompt(input: ValidatedRequest): string {
  const truncatedHtml =
    input.currentHtml.length > HTML_CHAR_LIMIT
      ? input.currentHtml.slice(0, HTML_CHAR_LIMIT)
      : input.currentHtml;

  const productContext = input.productName
    ? `\n\n상품명: ${input.productName}`
    : "";

  return (
    `아래 HTML을 다음 지시에 따라 수정해주세요.${productContext}\n\n` +
    `[수정 지시]\n${input.instruction}\n\n` +
    `[현재 HTML]\n${truncatedHtml}`
  );
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
    getRateLimitKey(ip, "edit-detail-html"),
    EDIT_HTML_RATE_LIMIT
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
  } catch {
    return NextResponse.json(
      { success: false, error: "요청 바디를 JSON으로 파싱할 수 없습니다." },
      { status: 400 }
    );
  }

  // Zod 검증
  const parseResult = RequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
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

  const validated = parseResult.data;

  // Claude 호출
  let rawResponseText: string;
  try {
    const client = getAnthropicClient();
    const userPrompt = buildUserPrompt(validated);

    const response = await withRetry(
      () =>
        client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: EDIT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      { label: "Claude editDetailHtml" }
    );

    rawResponseText = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");
  } catch (error) {
    console.error("[/api/ai/edit-detail-html] Claude 호출 실패:", error);

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
            ? `HTML 편집 실패: ${error.message}`
            : "HTML 편집 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }

  // Claude 응답에서 HTML 추출
  const editedHtml = extractHtml(rawResponseText);

  if (!editedHtml) {
    console.error(
      "[/api/ai/edit-detail-html] Claude 응답에서 HTML을 찾을 수 없음:",
      rawResponseText.slice(0, 200)
    );
    return NextResponse.json(
      { success: false, error: "AI 응답에서 HTML을 추출할 수 없습니다." },
      { status: 502 }
    );
  }

  // snippet 결정: 편집된 HTML 전체에서 body 내용을 추출하여 쿠팡 스니펫으로 사용
  // naverSnippet은 쿠팡 스니펫의 max-width를 860px로 교체하여 생성
  const snippet = extractSnippet(editedHtml);
  const naverSnippet = toNaverSnippet(snippet);

  return NextResponse.json({ success: true, html: editedHtml, snippet, naverSnippet }, { status: 200 });
}
