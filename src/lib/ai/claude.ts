/**
 * Anthropic Claude 클라이언트 싱글톤 및 카피 생성 헬퍼
 * API Routes에서 import하여 사용
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  COPY_SYSTEM_PROMPT,
  buildCopyUserPrompt,
} from "./prompts/copy-generation";
import {
  parseCopyResponse,
  type CopyGenerationSchemaType,
} from "./schemas";
import { withRetry } from "./resilience";

// ─────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────

export interface GenerateCopyInput {
  /** 분석할 고객 리뷰 문자열 배열 (최소 1개 이상 권장) */
  reviews: string[];
  /** 선택적 상품명 — 제공 시 SEO 제목 생성 품질이 향상됩니다 */
  productName?: string;
}

/** generateCopyFromReviews()의 반환 타입 (Zod 스키마와 1:1 대응) */
export type GenerateCopyOutput = CopyGenerationSchemaType;

// ─────────────────────────────────────────
// 클라이언트 싱글톤
// ─────────────────────────────────────────

let _anthropicClient: Anthropic | null = null;

/**
 * 환경변수를 검증하고 Anthropic 클라이언트를 반환합니다.
 * 모듈 로드 시점이 아니라 첫 호출 시점에 초기화하여
 * 빌드 타임 환경변수 누락 오류를 방지합니다.
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[Claude] 환경변수 ANTHROPIC_API_KEY가 설정되지 않았습니다. " +
        ".env.local 파일을 확인해 주세요."
    );
  }
  // API 키 형식 사전 검증 (sk- 로 시작해야 함)
  if (!apiKey.startsWith("sk-")) {
    throw new Error(
      "[Claude] ANTHROPIC_API_KEY 형식이 올바르지 않습니다. 'sk-'로 시작해야 합니다."
    );
  }

  if (!_anthropicClient) {
    _anthropicClient = new Anthropic({ apiKey });
  }

  return _anthropicClient;
}

// ─────────────────────────────────────────
// 카피 생성 함수
// ─────────────────────────────────────────

/**
 * 고객 리뷰 배열을 Claude 3.5 Sonnet에 전달하여
 * 소구점 3개, 말풍선 카피 3개, SEO 상품 제목 3개를 생성합니다.
 *
 * 프롬프트: COPY_SYSTEM_PROMPT + buildCopyUserPrompt() (copy-generation.ts)
 * 검증: CopyGenerationSchema (schemas.ts) — 실패 시 AiResponseParseError throw
 *
 * @param input - 리뷰 배열 및 선택적 상품명
 * @returns Zod 검증이 완료된 GenerateCopyOutput 객체
 * @throws AiResponseParseError Claude 응답 파싱/검증 실패 시
 * @throws Error API 키 누락 또는 API 호출 실패 시
 */
export async function generateCopyFromReviews(
  input: GenerateCopyInput
): Promise<GenerateCopyOutput> {
  const client = getAnthropicClient();

  // 고도화된 유저 프롬프트 생성
  const userMessage = buildCopyUserPrompt(input.reviews, input.productName);

  const response = await withRetry(
    () =>
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: COPY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    { label: "Claude generateCopy" }
  );

  // 응답 텍스트 추출
  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("");

  // Zod 스키마로 JSON 파싱 및 구조 검증
  // 실패 시 AiResponseParseError가 throw됩니다.
  return parseCopyResponse(rawText);
}
