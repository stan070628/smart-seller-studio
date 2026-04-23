import { getGeminiGenAI } from '@/lib/ai/gemini';

export interface TrendSeed {
  keyword: string;
  source: string;
  reason: string;
}

const DISCOVER_PROMPT = `오늘 한국에서 유행하는 생활용품·주방·청소·건강·반려동물 관련 소비재 트렌드를 YouTube, 인스타그램, 쓰레드, 네이버 급상승 검색어에서 찾아줘.

이미 포화된 대형 카테고리(스마트폰, 노트북 등)는 제외.
2~3단어로 된 구체적 상품 키워드 10개를 아래 JSON 형식으로만 응답:
{"seeds": [{"keyword": "키워드", "source": "youtube|instagram|threads|naver", "reason": "트렌드 근거 1문장"}]}`;

export function parseSeedResponse(raw: string): TrendSeed[] {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.seeds || !Array.isArray(parsed.seeds)) return [];
    return parsed.seeds.filter(
      (s: unknown): s is TrendSeed =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as Record<string, unknown>).keyword === 'string' &&
        typeof (s as Record<string, unknown>).source === 'string' &&
        typeof (s as Record<string, unknown>).reason === 'string',
    );
  } catch {
    return [];
  }
}

export async function discoverTrendSeeds(): Promise<TrendSeed[]> {
  try {
    const ai = getGeminiGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      tools: [{ googleSearch: {} }],
      contents: [{ role: 'user', parts: [{ text: DISCOVER_PROMPT }] }],
    });

    const candidates = response.candidates;
    if (!candidates?.length) return [];
    const parts = candidates[0]?.content?.parts;
    const text = parts?.find((p: { text?: string }) => typeof p.text === 'string')?.text ?? '';
    return parseSeedResponse(text);
  } catch {
    return [];
  }
}
