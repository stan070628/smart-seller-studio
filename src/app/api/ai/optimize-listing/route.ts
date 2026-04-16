/**
 * POST /api/ai/optimize-listing
 *
 * 도매꾹 원본 상품명을 쿠팡/네이버용 후킹 상품명으로 변환하고
 * 검색 노출용 태그를 생성합니다.
 *
 * Body: { originalTitle: string; categoryName?: string }
 * Response: { optimizedTitle: string; tags: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { withRetry } from '@/lib/ai/resilience';

// ─────────────────────────────────────────
// 요청 스키마
// ─────────────────────────────────────────

const RequestSchema = z.object({
  originalTitle: z.string().min(1).max(300),
  categoryName: z.string().max(100).optional(),
  detailHtml: z.string().max(100_000).optional(),
});

// ─────────────────────────────────────────
// 프롬프트
// ─────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 쿠팡·네이버 스마트스토어에서 클릭률(CTR)이 높은 상품명과 검색 태그를 만드는 전문가입니다.
상품 상세페이지 내용이 제공되면 반드시 분석하여 제품의 실제 특징·소재·용도·타겟을 파악하고, 이를 상품명과 태그에 반영하세요.

## 상품명 작성 규칙
1. 핵심 키워드를 앞에 배치 (검색 알고리즘 최적화)
2. 고객이 실제 검색하는 단어 사용 (도매꾹 전문 용어 제거)
3. 상세페이지에서 파악한 제품 특징(소재, 기능, 사이즈, 용도 등)을 반영
4. 혜택/특장점을 포함 (대용량, 세트, 방수 등)
5. 50자 내외 (너무 길면 잘림)
6. 특수문자 최소화, 가독성 우선
7. 도매꾹/공급사/도매 관련 단어 절대 포함 금지

## 태그 작성 규칙
1. 고객이 실제로 검색할 키워드 10~15개
2. 대표 키워드 + 연관 키워드 + 롱테일 키워드 혼합
3. 상세페이지에서 발견한 소재명, 기능, 용도, 타겟층 키워드 포함
4. 각 태그는 1~3단어
5. 중복/유사 태그 제거
6. 브랜드명이 없으면 브랜드 태그 생략

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트를 포함하지 마세요.
\`\`\`json
{
  "optimizedTitle": "최적화된 상품명",
  "tags": ["태그1", "태그2", ...]
}
\`\`\``;

/** HTML 태그·특수문자 제거 후 핵심 텍스트만 추출 (최대 3000자) */
function extractTextFromHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 3000);
}

function buildUserPrompt(title: string, category?: string, detailText?: string): string {
  let prompt = `원본 상품명: ${title}`;
  if (category) prompt += `\n카테고리: ${category}`;
  if (detailText) {
    prompt += `\n\n--- 상품 상세페이지 내용 ---\n${detailText}\n--- 끝 ---`;
  }
  prompt += `\n\n위 정보를 바탕으로 쿠팡/네이버용 상품명과 검색 태그를 생성해주세요.`;
  return prompt;
}

// ─────────────────────────────────────────
// 응답 파싱
// ─────────────────────────────────────────

const ResponseSchema = z.object({
  optimizedTitle: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1).max(20),
});

function parseResponse(rawText: string) {
  // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
  const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) ?? rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('JSON 응답을 찾을 수 없습니다.');
  }
  const jsonStr = jsonMatch[1] ?? jsonMatch[0];
  const parsed = JSON.parse(jsonStr);
  return ResponseSchema.parse(parsed);
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalTitle, categoryName, detailHtml } = RequestSchema.parse(body);

    const detailText = detailHtml ? extractTextFromHtml(detailHtml) : undefined;

    const client = getAnthropicClient();

    const response = await withRetry(
      () =>
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(originalTitle, categoryName, detailText) }],
        }),
      { label: 'Claude optimizeListing' },
    );

    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    const result = parseResponse(rawText);

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[POST /api/ai/optimize-listing] 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    const status = message.includes('ANTHROPIC_API_KEY') ? 503 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
