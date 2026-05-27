/**
 * detail-page-suggest-answers 라우트에서 사용하는 순수 유틸리티 함수 모음.
 * Next.js 16 Route 파일은 HTTP 핸들러와 Route Segment Config만 export할 수 있으므로
 * 테스트 대상 함수는 이 파일에서 export하고 route.ts에서 import한다.
 */

import { z } from 'zod';
import { ALL_QUESTION_IDS } from '@/lib/conversational-detail/questions';
import type { ChipSuggestion } from '@/lib/conversational-detail/types';

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

export const RequestSchema = z.object({
  productName: z.string().min(1).max(200),
  category: z.enum(['basic', 'fashion', 'living', 'food'] as const),
  imageUrls: z.array(z.string().url()).min(1).max(6),
  questionIds: z
    .array(z.string())
    .min(1)
    .max(20)
    .refine((ids) => ids.every((id) => ALL_QUESTION_IDS.includes(id)), {
      message: 'questionIds에 정의되지 않은 ID가 포함되어 있습니다.',
    }),
});

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

export function buildUserPrompt(
  productName: string,
  category: string,
  questionIds: string[],
): string {
  return [
    `상품명: ${productName}`,
    `카테고리: ${category}`,
    `\n답변 후보가 필요한 질문 ID들: ${questionIds.join(', ')}`,
    `\n위 이미지·상품명·카테고리를 분석하여 각 질문 ID에 대해 칩 후보를 JSON으로 반환하세요.`,
  ].join('\n');
}

export function extractJson(rawText: string): unknown {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');
  return JSON.parse(match[0]);
}

export function parseSuggestions(parsed: unknown, requestedIds: string[]): ChipSuggestion[] {
  const SuggestionSchema = z.object({
    suggestions: z.array(
      z.object({
        questionId: z.string(),
        chips: z.array(z.string().min(1).max(80)).min(2).max(6),
        recommendedIndex: z.number().int().min(0),
      }),
    ),
  });
  const result = SuggestionSchema.parse(parsed);

  // 요청한 questionId만 추리고, recommendedIndex 범위 보정
  const allowed = new Set(requestedIds);
  return result.suggestions
    .filter((s) => allowed.has(s.questionId))
    .map((s) => ({
      questionId: s.questionId,
      chips: s.chips.slice(0, 4),
      recommendedIndex: Math.min(s.recommendedIndex, s.chips.length - 1),
    }));
}
