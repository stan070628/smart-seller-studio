/**
 * 한국어 → 중국어 검색어 생성 헬퍼
 *
 * Claude API를 호출하여 한국어 상품 키워드의 중국어 변형을 생성한다.
 * withRetry 래퍼로 429/5xx 자동 재시도.
 */

import { z } from 'zod';
import { callClaude } from './claude-cli';
import { withRetry } from './resilience';
import {
  CHINESE_QUERY_SYSTEM_PROMPT,
  buildChineseQueryUserPrompt,
} from './prompts/chinese-query-generation';

// ─────────────────────────────────────────────────────────────────────────────
// 응답 검증 스키마
// ─────────────────────────────────────────────────────────────────────────────

const ChineseQueryArraySchema = z
  .array(z.string().min(1).max(50))
  .min(1)
  .max(10);

// ─────────────────────────────────────────────────────────────────────────────
// JSON 파싱 + 정규식 폴백
// ─────────────────────────────────────────────────────────────────────────────

function parseChineseQueries(rawText: string): string[] {
  // 1차: JSON 배열 파싱
  try {
    // 응답에 코드 블록이 포함될 수 있으므로 제거
    const cleaned = rawText.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const validated = ChineseQueryArraySchema.safeParse(parsed);
    if (validated.success) return validated.data;
  } catch {
    // JSON 파싱 실패 — 폴백으로 진행
  }

  // 2차: 정규식으로 중국어 문자열 추출
  const chinesePattern = /[\u4e00-\u9fff]+/g;
  const matches = rawText.match(chinesePattern);
  if (matches && matches.length > 0) {
    // 2자 이상인 것만 필터
    return matches.filter((m) => m.length >= 2).slice(0, 5);
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'sonnet'; // claude-cli alias

/**
 * 한국어 키워드를 Claude API에 보내 중국어 검색어 변형을 생성한다.
 *
 * @param keyword - 한국어 상품 키워드
 * @returns 중국어 검색어 배열 (3~5개). 생성 실패 시 빈 배열.
 */
export async function generateChineseQueries(keyword: string): Promise<string[]> {
  const rawText = await withRetry(
    () => callClaude(CHINESE_QUERY_SYSTEM_PROMPT, buildChineseQueryUserPrompt(keyword), 'sonnet', 256),
    { label: 'Claude chineseQuery' },
  );
  return parseChineseQueries(rawText);
}

/** 생성에 사용된 모델명 (DB 캐시용) */
export const CHINESE_QUERY_MODEL = MODEL;
