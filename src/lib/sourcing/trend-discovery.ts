import { getGeminiGenAI } from '@/lib/ai/gemini';

export interface TrendSeed {
  keyword: string;
  source: string;
  reason: string;
}

/** 월 이름을 "2026년 9월" 형태로 (KST 기준) */
function kstMonthLabel(base: Date, addMonths: number): string {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + addMonths, 1));
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`;
}

/**
 * 트렌드 시드 발굴 프롬프트.
 *
 * 규제 필터(lib/sourcing/legal/)에 걸리는 키워드를 애초에 만들지 않도록
 * 차단 카테고리를 역주입한다. 실제 차단 실적이 있는 품목을 금지 예시로 든다
 * (선풍기 420건 · 장난감 466건 · 식품용기 169건).
 *
 * 시즌은 1688 리드타임(해운 약 30일)과 검증 4주를 고려해 2~4개월 뒤를 노린다.
 *
 * 규제 필터는 "어떤 카테고리인가"만 거르므로 "애초에 상품이 아닌 것"은 통과한다.
 * 시드는 api/ai/keyword-discover에서 확장되기 때문에 "다이어트방법" 같은 정보성
 * 키워드가 한 건만 섞여도 하위 파이프라인 전체가 오염된다. 그래서 실물 상품
 * 조건과 2~3단어 형태를 별도로 못박는다.
 */
export function buildDiscoverPrompt(now: Date): string {
  const from = kstMonthLabel(now, 2);
  const to = kstMonthLabel(now, 4);

  return `한국 온라인 커머스에서 지금 수요가 오르는 소비재 상품 키워드를 찾아줘.

【시즌】
지금 소싱하면 판매 시점은 ${from} ~ ${to}이다. 그 시기에 팔릴 상품을 골라라.

【반드시 제외할 것 — 실물 상품이 아니다】
- 실제로 구매할 수 있는 물리적 상품만 (서비스, 자격증, 비용, 직업, 정보성 키워드 절대 제외)
- 나쁜 예시: 강아지유치원비용, 반려동물관리사, 다이어트방법, 운동루틴

【반드시 제외할 것 — 수입·판매 규제로 진입이 막힌다】
- 전기·충전·배터리를 쓰는 모든 것 (예: 선풍기, 랜턴, 히터, 조명)
- 아동·유아용품, 장난감
- 식품, 건강기능식품, 영양제, 식품용기 (예: 도시락통, 에어프라이어 용기)
- 화장품, 향수, 세제, 세정제, 탈취제, 위생용품
- 브랜드·캐릭터가 붙은 것
- 부피가 큰 것 (가구, 대형가전)

【우선할 카테고리】
골프 액세서리, 낚시 용품, 등산·트레킹, 캠핑 수납·정리, 방한·보온, 차량용품, 반려동물 산책용품

【가격】
개당 예상 판매가 10,000원 이상만. 20,000원 이상이면 더 좋다.

【옵션】
색상·사이즈를 합친 옵션이 3개 이하로 팔 수 있는 상품. 의류는 프리사이즈나 밴딩처럼 사이즈 분기가 적은 것만.

【형식】
키워드는 2~3단어 상품명 형태 (예: 등산 스틱, 낚시 받침대, 방한 넥워머, 반려견 리드줄, 캠핑 수납 가방)
상품 키워드 10개를 아래 JSON으로만 응답:
{"seeds": [{"keyword": "키워드", "source": "youtube|instagram|threads|naver", "reason": "수요 근거 1문장"}]}`;
}

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
    const prompt = buildDiscoverPrompt(new Date());
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text ?? '';
    return parseSeedResponse(text);
  } catch {
    return [];
  }
}
