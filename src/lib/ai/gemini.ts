/**
 * Google GenAI 클라이언트 싱글톤
 * API Routes에서 import하여 사용
 */

import { GoogleGenAI } from "@google/genai";

// ─────────────────────────────────────────
// 클라이언트 싱글톤
// ─────────────────────────────────────────

let _genAIClient: GoogleGenAI | null = null;

/**
 * 환경변수를 검증하고 GoogleGenAI 인스턴스를 반환합니다.
 * 모듈 로드 시점이 아니라 첫 호출 시점에 초기화하여
 * 빌드 타임 환경변수 누락 오류를 방지합니다.
 */
export function getGeminiGenAI(): GoogleGenAI {
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
    _genAIClient = new GoogleGenAI({ apiKey });
  }

  return _genAIClient;
}
