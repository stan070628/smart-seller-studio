/**
 * POST /api/ai/optimize-listing
 *
 * 1) 네이버 쇼핑 자동완성(인증 불필요)으로 실제 연관 검색어 수집
 * 2) 네이버 쇼핑 검색으로 상위 판매 상품명 패턴 수집
 * 3) Claude에게 시장 데이터 + 상세페이지를 함께 넘겨 정성껏 최적화
 *
 * Body: { originalTitle: string; categoryName?: string; detailHtml?: string }
 * Response: { optimizedTitle: string; tags: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callClaude } from '@/lib/ai/claude-cli';
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
// 시장 조사: 네이버 자동완성 (인증 불필요)
// ─────────────────────────────────────────

async function fetchNaverAutoComplete(query: string): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      frm: 'shopping',
      r_format: 'json',
      r_enc: 'UTF-8',
      r_unicode: '0',
      t_koreng: '1',
    });
    const res = await fetch(`https://ac.shopping.naver.com/ac?${params}`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { ac?: unknown[][][] };
    const suggestions: string[] = [];
    if (Array.isArray(data.ac)) {
      for (const group of data.ac) {
        if (Array.isArray(group)) {
          for (const pair of group) {
            if (Array.isArray(pair) && typeof pair[0] === 'string') {
              suggestions.push(pair[0]);
            }
          }
        }
      }
    }
    return suggestions.slice(0, 10);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────
// 시장 조사: 네이버 쇼핑 검색 상위 상품명
// ─────────────────────────────────────────

async function fetchNaverShoppingTitles(query: string): Promise<string[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  try {
    const params = new URLSearchParams({ query, display: '10', sort: 'sim' });
    const res = await fetch(`https://openapi.naver.com/v1/search/shop.json?${params}`, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { items?: { title: string }[] };
    return (data.items ?? [])
      .map((item) => item.title.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
      .slice(0, 10);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────
// HTML → 핵심 텍스트 추출 (최대 3000자)
// ─────────────────────────────────────────

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

// ─────────────────────────────────────────
// 프롬프트
// ─────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 쿠팡·네이버 스마트스토어에서 월 매출 1억을 달성한 탑 셀러 출신 상품명 전문가입니다.
수백 개의 상품명 A/B 테스트를 통해 클릭률과 전환율을 최대화한 경험을 갖고 있습니다.
실제 시장 데이터를 분석해 경쟁사보다 더 구체적이고 매력적인 상품명을 만드세요.

## 상품명 작성 원칙

### 1. 구매 의도 키워드 선점 (가장 중요)
- 연관 검색어 중 구매 의도가 가장 높은 키워드(수량+소재+용도 조합)를 맨 앞에 배치
- 예: "크로스백" 보단 "남성 방수 크로스백 14인치 노트북" 처럼 구체적으로

### 2. 경쟁 상품명 분석 후 차별화
- 상위 상품명들이 공통으로 사용하는 키워드는 반드시 포함
- 단, 상위 상품들이 빠뜨린 중요 키워드(스펙, 타겟, 혜택)를 추가해 차별화
- 상위 상품명을 그대로 복사하거나 비슷하게 만들지 말 것

### 3. 스펙의 구체화
- 수량/용량/사이즈가 있으면 숫자로 명시 (예: 500ml, 2개입, L사이즈)
- 소재가 중요하면 포함 (예: 스테인리스, 면100%, 방수PU)
- 타겟이 명확하면 포함 (예: 남성용, 여성용, 반려견용, 1인가구용)

### 4. 자연스러운 키워드 흐름
- 키워드를 단순 나열하지 말고, 읽었을 때 자연스럽게 의미가 이어지도록 배열
- 중복 단어 절대 금지

### 5. 금지 사항
- 50자 이하: 검색 노출 기회 낭비 (80자 내외 권장)
- 도매꾹·공급사·도매 관련 단어 금지
- 특수문자([], ★, ♥ 등) 금지
- 과대광고(1위, 최초, 혁명적, 압도적) 금지

나쁜 예 → 좋은 예:
- "여성 가방" → "여성 미니 숄더백 체인백 크로스백 데이트룩 3가지 색상 가벼운 가방"
- "스테인리스 텀블러" → "스테인리스 보온 텀블러 500ml 12시간 보온보냉 뚜껑포함 직장인 차량용 2개세트"
- "강아지 간식" → "강아지 닭가슴살 져키 간식 무방부제 소형견 대형견 훈련용 트릿 100g"

## 태그 작성 규칙
1. 연관 검색어에서 관련성 높은 것 우선 선택
2. 대표 키워드 + 연관 키워드 + 롱테일 키워드 혼합, 총 12~15개
3. 각 태그는 1~3단어 (너무 긴 것 분리)
4. 중복/유사 태그 제거
5. 브랜드명 없으면 브랜드 태그 생략

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요.
\`\`\`json
{
  "optimizedTitle": "최적화된 상품명",
  "tags": ["태그1", "태그2", ...]
}
\`\`\``;

function buildUserPrompt(
  title: string,
  autoComplete: string[],
  marketTitles: string[],
  category?: string,
  detailText?: string,
): string {
  const lines: string[] = [];
  lines.push(`[원본 상품명]\n${title}`);
  if (category) lines.push(`[카테고리]\n${category}`);

  if (autoComplete.length > 0) {
    lines.push(`[네이버 쇼핑 연관 검색어 — 실제 구매자들이 검색하는 단어]\n${autoComplete.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  }
  if (marketTitles.length > 0) {
    lines.push(`[네이버 쇼핑 상위 판매 상품명 — 경쟁 상품 패턴 참고]\n${marketTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
  }
  if (detailText) {
    lines.push(`[상품 상세페이지 내용 — 제품 특징 파악용]\n${detailText}`);
  }

  lines.push('\n위 시장 데이터를 충분히 반영해서 쿠팡/네이버용 상품명과 검색 태그를 정성껏 생성해주세요.');
  return lines.join('\n\n');
}

// ─────────────────────────────────────────
// 응답 파싱
// ─────────────────────────────────────────

const ResponseSchema = z.object({
  optimizedTitle: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1).max(20),
});

function parseResponse(rawText: string) {
  const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) ?? rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON 응답을 찾을 수 없습니다.');
  const jsonStr = jsonMatch[1] ?? jsonMatch[0];
  return ResponseSchema.parse(JSON.parse(jsonStr));
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalTitle, categoryName, detailHtml } = RequestSchema.parse(body);

    // 시장 조사 — 네이버 자동완성 + 상위 상품명 병렬 수집
    const [autoComplete, marketTitles] = await Promise.all([
      fetchNaverAutoComplete(originalTitle),
      fetchNaverShoppingTitles(originalTitle),
    ]);

    const detailText = detailHtml ? extractTextFromHtml(detailHtml) : undefined;

    const rawText = await callClaude(
      SYSTEM_PROMPT,
      buildUserPrompt(originalTitle, autoComplete, marketTitles, categoryName, detailText),
      'sonnet',
    );

    const result = parseResponse(rawText);

    return NextResponse.json({
      success: true,
      data: result,
      _meta: {
        autoCompleteCount: autoComplete.length,
        marketTitlesCount: marketTitles.length,
      },
    });
  } catch (err) {
    console.error('[POST /api/ai/optimize-listing] 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    const status = message.includes('ANTHROPIC_API_KEY') ? 503 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
