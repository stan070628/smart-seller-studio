/**
 * 위너 SKU 상품명 재구성 제안 (Anthropic API)
 * spec 2026-04-28-strategy-v2-extension §2.B 기능 5
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KeywordSuggestion } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

export interface SuggestInput {
  currentTitle: string;
  mainKeywords: string[];
  categoryName: string | null;
}

export async function suggestKeywordOptimization(
  input: SuggestInput,
): Promise<Pick<KeywordSuggestion, 'suggestedTitle' | 'reasoning'>> {
  if (!input.currentTitle.trim()) {
    throw new Error('currentTitle is required');
  }

  const prompt = `네이버 스마트스토어 / 쿠팡 검색 SEO 전문가로서 다음 상품명을 재구성하라.

현재 상품명: ${input.currentTitle}
메인 키워드: ${input.mainKeywords.join(', ') || '(없음)'}
카테고리: ${input.categoryName ?? '(없음)'}

규칙:
- 50자 이내
- 핵심 키워드를 앞 20자에 배치
- 메인 키워드 → 세부 키워드 → 브랜드 순서
- 과장 표현 금지 (100% / 최고 / 만능 등)

JSON 응답 (다른 텍스트 없이):
{"suggestedTitle": "...", "reasoning": "..."}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((c) => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Anthropic API');
  }

  const parsed = JSON.parse(textBlock.text);
  return {
    suggestedTitle: parsed.suggestedTitle,
    reasoning: parsed.reasoning,
  };
}
