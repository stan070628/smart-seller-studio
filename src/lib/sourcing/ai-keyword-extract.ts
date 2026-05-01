import { getGeminiGenAI } from '@/lib/ai/gemini';

const PROMPT_TEMPLATE = `당신은 한국 e-commerce 키워드 발굴 전문가입니다.

다음 상품을 보고, 한국 소비자가 쿠팡/네이버 쇼핑에서 검색할 만한
키워드 후보를 5~10개 제안해 주세요.

상품명: {{TITLE}}

원칙:
1. 단순한 카테고리어("수납함", "방향제")는 피하고, 2단어 이상 조합 위주
2. 사용 상황/속성/타겟을 포함한 long-tail 키워드 위주
3. 너무 좁지도 너무 넓지도 않은 검색량 3k~15k 범위가 가능한 키워드
4. 각 키워드는 한국어, 띄어쓰기 없는 형태 또는 자연스러운 형태

JSON으로만 답하세요. 다른 설명 금지.

{
  "keywords": ["키워드1", "키워드2", ...]
}`;

/**
 * 상품 제목으로부터 5~10개의 키워드 후보를 Gemini로 추출.
 * 실패 시 null 반환 — 호출자는 사용자 직접 입력 fallback.
 */
export async function extractKeywordsFromProduct(
  productTitle: string,
): Promise<string[] | null> {
  const trimmed = productTitle.trim();
  if (!trimmed) return null;

  try {
    const ai = getGeminiGenAI();
    const prompt = PROMPT_TEMPLATE.replace('{{TITLE}}', trimmed);
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    const raw = (response as { text?: string }).text ?? '';
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '');

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }

    const obj = parsed as { keywords?: unknown };
    if (!Array.isArray(obj.keywords)) return null;
    const keywords = obj.keywords.filter((k): k is string => typeof k === 'string' && k.length > 0);
    return keywords.length > 0 ? keywords : null;
  } catch {
    return null;
  }
}
