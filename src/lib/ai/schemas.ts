/**
 * AI 응답 검증용 Zod 스키마 및 TypeScript 인터페이스 정의
 *
 * - Claude 카피 생성 응답 스키마: CopyGenerationSchema
 * - Gemini 이미지 분석 응답 스키마: ImageAnalysisSchema
 * - 파싱 실패 시 던질 커스텀 에러 클래스 포함
 * - z.safeParse() 기반 파싱 함수 export
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 커스텀 에러 클래스
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI 응답을 JSON으로 파싱하거나 Zod 스키마 검증에 실패했을 때 던지는 에러
 */
export class AiResponseParseError extends Error {
  /** 파싱을 시도한 원본 텍스트 (최대 500자) */
  public readonly rawText: string;
  /** Zod 에러 상세 (스키마 검증 실패 시에만 존재) */
  public readonly zodIssues?: z.ZodIssue[];

  constructor(
    message: string,
    rawText: string,
    zodIssues?: z.ZodIssue[]
  ) {
    super(message);
    this.name = "AiResponseParseError";
    this.rawText = rawText.slice(0, 500);
    this.zodIssues = zodIssues;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 공통 유틸리티
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI 응답 문자열에서 JSON 부분만 추출합니다.
 * 코드 블록(```json ... ```) 및 앞뒤 공백을 제거합니다.
 */
function extractJson(rawText: string): string {
  return rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Claude 카피 생성 응답 스키마
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Claude가 리뷰 분석 후 반환하는 카피 생성 결과의 TypeScript 인터페이스
 */
export interface CopyGenerationResponse {
  /** 고객 리뷰에서 추출한 핵심 소구점 3가지 (Pain Point 해결 위주)
   * 예: "강풍에도 뒤집히지 않는 역풍 대응 구조" */
  sellingPoints: [string, string, string];

  /** 모바일 상세페이지 말풍선용 초단문 카피 3개 (15자 이내)
   * 예: "바람도 두렵지 않아" */
  bubbleCopies: [string, string, string];

  /** 쿠팡 SEO 최적화 상품 제목 3가지 (40자 이내, 특수문자 금지)
   * 예: "강풍 자동개폐 카라비너 우산 방수 경량 안전버튼 남녀공용" */
  titles: [string, string, string];
}

/**
 * Claude 카피 생성 응답 검증용 Zod 스키마
 *
 * 각 배열은 정확히 3개의 문자열 튜플로 강제합니다.
 * 글자 수 제약은 LLM 지시사항과 일치시키되,
 * 소폭 초과(+5자)는 경고 없이 통과시켜 UX 훼손을 방지합니다.
 */
export const CopyGenerationSchema = z.object({
  /** 핵심 소구점 3개 — 예: "버튼 하나로 손 다침 없이 안전하게 접히는 자동 개폐" */
  sellingPoints: z
    .tuple([
      z.string().min(5, "소구점이 너무 짧습니다").max(50),
      z.string().min(5, "소구점이 너무 짧습니다").max(50),
      z.string().min(5, "소구점이 너무 짧습니다").max(50),
    ])
    .describe("리뷰 기반 핵심 소구점 3개"),

  /** 말풍선 카피 3개 — 예: "양손이 자유로워요" */
  bubbleCopies: z
    .tuple([
      z.string().min(2, "카피가 너무 짧습니다").max(20),
      z.string().min(2, "카피가 너무 짧습니다").max(20),
      z.string().min(2, "카피가 너무 짧습니다").max(20),
    ])
    .describe("말풍선용 초단문 카피 3개 (15자 이내 권장)"),

  /** 상품 제목 3개 — 예: "카라비너 우산 자동 개폐 방수 강풍 안전 버튼 남녀공용 선물" */
  titles: z
    .tuple([
      z.string().min(10, "제목이 너무 짧습니다").max(45),
      z.string().min(10, "제목이 너무 짧습니다").max(45),
      z.string().min(10, "제목이 너무 짧습니다").max(45),
    ])
    .describe("SEO 최적화 상품 제목 3개 (40자 이내 권장)"),
});

/** CopyGenerationSchema에서 추론한 TypeScript 타입 */
export type CopyGenerationSchemaType = z.infer<typeof CopyGenerationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Gemini 이미지 분석 응답 스키마
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gemini가 이미지 분석 후 반환하는 결과의 TypeScript 인터페이스
 */
export interface ImageAnalysisResponse {
  /** 제품 주요 소재 및 질감 설명 (한국어, 1문장)
   * 예: "이중벽 구조의 스테인리스 스틸 소재로 무광 마감 처리되어 있습니다" */
  material: string;

  /** 제품 형태 및 구조적 디자인 설명 (한국어, 1문장)
   * 예: "원통형 텀블러 형태로 뚜껑이 일체형이며 하단이 넓어 안정적입니다" */
  shape: string;

  /** 이미지에서 보이는 주요 색상 목록 (한국어 색상명)
   * 예: ["무광 블랙", "실버"] */
  colors: string[];

  /** 구매자가 주목할 핵심 부품 또는 디자인 디테일 목록 (한국어, 3~5개)
   * 예: ["이중벽 진공 단열 구조", "실리콘 그립 밴드", "원터치 잠금 뚜껑"] */
  keyComponents: string[];

  /** 틱톡/유튜브 쇼츠용 AI 영상 생성 영어 프롬프트 (1문장, 200자 이내)
   * 예: "A cinematic slow-motion shot of a matte black carabiner umbrella resisting heavy rain..." */
  visualPrompt: string;
}

/**
 * Gemini 이미지 분석 응답 검증용 Zod 스키마
 */
export const ImageAnalysisSchema = z.object({
  /** 소재 설명 — 예: "이중벽 구조의 스테인리스 스틸 소재로 보온·보냉 성능이 뛰어납니다" */
  material: z
    .string()
    .min(5, "소재 설명이 너무 짧습니다")
    .max(120, "소재 설명이 너무 깁니다")
    .describe("제품 주요 소재 및 질감 (한국어 1문장)"),

  /** 형태 설명 — 예: "원통형 텀블러 형태로 뚜껑이 일체형이며 하단이 넓어 안정적으로 세워집니다" */
  shape: z
    .string()
    .min(5, "형태 설명이 너무 짧습니다")
    .max(120, "형태 설명이 너무 깁니다")
    .describe("제품 형태 및 구조 (한국어 1문장)"),

  /** 색상 목록 — 예: ["무광 블랙", "실버"] */
  colors: z
    .array(z.string().min(1))
    .min(1, "색상이 1개 이상 필요합니다")
    .max(8, "색상이 너무 많습니다")
    .describe("이미지에서 보이는 주요 색상 목록 (한국어)"),

  /** 핵심 부품/디테일 목록 — 예: ["이중벽 진공 단열 구조", "실리콘 그립 밴드"] */
  keyComponents: z
    .array(z.string().min(2))
    .min(2, "핵심 부품이 최소 2개 필요합니다")
    .max(6, "핵심 부품이 너무 많습니다")
    .describe("구매자 주목 핵심 부품 또는 디자인 디테일 (한국어, 3~5개)"),

  /** AI 영상 생성 영어 프롬프트 — 예: "A cinematic slow-motion shot of ..." */
  visualPrompt: z
    .string()
    .min(20, "비주얼 프롬프트가 너무 짧습니다")
    .max(250, "비주얼 프롬프트가 너무 깁니다")
    .regex(/--ar\s+9:16/, {
      message: "비주얼 프롬프트에 '--ar 9:16' 종횡비 지시어가 포함되어야 합니다",
    })
    .describe("쇼츠용 AI 비디오/이미지 생성 영어 프롬프트 (1문장)"),
});

/** ImageAnalysisSchema에서 추론한 TypeScript 타입 */
export type ImageAnalysisSchemaType = z.infer<typeof ImageAnalysisSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3. 파싱 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Claude 카피 생성 응답(원본 텍스트)을 파싱하고 Zod 스키마로 검증합니다.
 *
 * @param rawText - Claude API가 반환한 원본 텍스트
 * @returns 검증된 CopyGenerationSchemaType 객체
 * @throws AiResponseParseError JSON 파싱 또는 스키마 검증 실패 시
 *
 * @example
 * const result = parseCopyResponse(rawText);
 * console.log(result.titles[0]); // "강풍 자동개폐 카라비너 우산 방수 경량..."
 */
export function parseCopyResponse(rawText: string): CopyGenerationSchemaType {
  // 1단계: JSON 추출
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(rawText));
  } catch (e) {
    throw new AiResponseParseError(
      `[Claude] JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`,
      rawText
    );
  }

  // 2단계: Zod 스키마 검증
  const result = CopyGenerationSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiResponseParseError(
      `[Claude] 응답 스키마 검증 실패: ${result.error.issues.map((i) => i.message).join(" | ")}`,
      rawText,
      result.error.issues
    );
  }

  return result.data;
}

/**
 * Gemini 이미지 분석 응답(원본 텍스트)을 파싱하고 Zod 스키마로 검증합니다.
 *
 * @param rawText - Gemini API가 반환한 원본 텍스트
 * @returns 검증된 ImageAnalysisSchemaType 객체
 * @throws AiResponseParseError JSON 파싱 또는 스키마 검증 실패 시
 *
 * @example
 * const result = parseImageResponse(rawText);
 * console.log(result.visualPrompt); // "A cinematic slow-motion shot of..."
 */
export function parseImageResponse(rawText: string): ImageAnalysisSchemaType {
  // 1단계: JSON 추출
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(rawText));
  } catch (e) {
    throw new AiResponseParseError(
      `[Gemini] JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`,
      rawText
    );
  }

  // 2단계: Zod 스키마 검증
  const result = ImageAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiResponseParseError(
      `[Gemini] 응답 스키마 검증 실패: ${result.error.issues.map((i) => i.message).join(" | ")}`,
      rawText,
      result.error.issues
    );
  }

  return result.data;
}
