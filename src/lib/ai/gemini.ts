/**
 * Google Gemini 클라이언트 싱글톤 및 이미지 분석 헬퍼
 * API Routes에서 import하여 사용
 */

import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type Part,
} from "@google/generative-ai";
import { IMAGE_ANALYSIS_PROMPT } from "./prompts/image-analysis";
import {
  parseImageResponse,
  type ImageAnalysisSchemaType,
} from "./schemas";
import { withRetry } from "./resilience";

// ─────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────

export interface AnalyzeImageInput {
  /** Base64 인코딩된 이미지 데이터 (data URL prefix 제외) */
  imageBase64: string;
  /** 이미지 MIME 타입 (예: "image/jpeg") */
  mimeType: string;
}

/** analyzeProductImage()의 반환 타입 (Zod 스키마와 1:1 대응) */
export type AnalyzeImageOutput = ImageAnalysisSchemaType;

// 허용 MIME 타입 목록
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// ─────────────────────────────────────────
// 클라이언트 싱글톤
// ─────────────────────────────────────────

let _genAIClient: GoogleGenerativeAI | null = null;
let _geminiModel: GenerativeModel | null = null;

/**
 * 환경변수를 검증하고 Gemini 모델 인스턴스를 반환합니다.
 * 모듈 로드 시점이 아니라 첫 호출 시점에 초기화하여
 * 빌드 타임 환경변수 누락 오류를 방지합니다.
 */
export function getGeminiModel(): GenerativeModel {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[Gemini] 환경변수 GOOGLE_AI_API_KEY가 설정되지 않았습니다. " +
        ".env.local 파일을 확인해 주세요."
    );
  }
  // API 키 형식 사전 검증
  if (!apiKey.startsWith("AI")) {
    throw new Error(
      "[Gemini] GOOGLE_AI_API_KEY 형식이 올바르지 않습니다. 'AI'로 시작해야 합니다."
    );
  }

  if (!_genAIClient) {
    _genAIClient = new GoogleGenerativeAI(apiKey);
  }

  if (!_geminiModel) {
    _geminiModel = _genAIClient.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
    });
  }

  return _geminiModel;
}

// ─────────────────────────────────────────
// 이미지 분석 함수
// ─────────────────────────────────────────

/**
 * Base64 이미지를 Gemini 1.5 Pro Vision으로 분석하여
 * 소재/형태/색상/핵심부품 분석 결과와 쇼츠용 영어 비주얼 프롬프트를 반환합니다.
 *
 * 프롬프트: IMAGE_ANALYSIS_PROMPT (image-analysis.ts, Few-shot 예시 포함)
 * 검증: ImageAnalysisSchema (schemas.ts) — 실패 시 AiResponseParseError throw
 *
 * @param input - Base64 이미지 데이터와 MIME 타입
 * @returns Zod 검증이 완료된 AnalyzeImageOutput 객체
 * @throws AiResponseParseError Gemini 응답 파싱/검증 실패 시
 * @throws Error MIME 타입 오류, API 키 누락 또는 API 호출 실패 시
 */
export async function analyzeProductImage(
  input: AnalyzeImageInput
): Promise<AnalyzeImageOutput> {
  // MIME 타입 검증
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType as AllowedMimeType)) {
    throw new Error(
      `[Gemini] 지원하지 않는 MIME 타입입니다: ${input.mimeType}. ` +
        `허용 타입: ${ALLOWED_MIME_TYPES.join(", ")}`
    );
  }

  const model = getGeminiModel();

  // Gemini에 전달할 멀티파트 파트 구성
  const imagePart: Part = {
    inlineData: {
      data: input.imageBase64,
      mimeType: input.mimeType,
    },
  };

  const result = await withRetry(
    () => model.generateContent([IMAGE_ANALYSIS_PROMPT, imagePart]),
    { label: "Gemini analyzeImage" }
  );
  const rawText = result.response.text();

  // Zod 스키마로 JSON 파싱 및 구조 검증
  // 실패 시 AiResponseParseError가 throw됩니다.
  return parseImageResponse(rawText);
}
