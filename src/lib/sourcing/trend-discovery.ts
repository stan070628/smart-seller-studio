import { getGeminiGenAI } from '@/lib/ai/gemini';

export interface TrendSeed {
  keyword: string;
  source: string;
  reason: string;
}

const DISCOVER_PROMPT = `오늘 한국 YouTube, 인스타그램, 쓰레드, 네이버 급상승 검색어에서 유행하는 소비재 상품 트렌드를 찾아줘.

반드시 지켜야 할 조건:
- 실제로 구매할 수 있는 물리적 상품만 (서비스, 자격증, 비용, 직업, 정보성 키워드 절대 제외)
- 도매꾹·중국 도매에서 소싱 가능한 카테고리 (생활용품, 주방, 청소, 건강식품, 반려동물 용품, 캠핑 용품, 뷰티 등)
- 이미 포화된 대형 카테고리 제외 (스마트폰, 노트북, 명품 등)
- 2~3단어 상품명 형태 (예: "강아지 간식", "캠핑 의자", "휴대용 선풍기")

나쁜 예시 (제외해야 할 것): 강아지유치원비용, 반려동물관리사, 다이어트방법, 운동루틴
좋은 예시 (이런 형태): 강아지 영양제, 캠핑 랜턴, 에어프라이어 틀, 고양이 장난감

상품 키워드 10개를 아래 JSON 형식으로만 응답:
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

    const text = response.text ?? '';
    return parseSeedResponse(text);
  } catch {
    return [];
  }
}
