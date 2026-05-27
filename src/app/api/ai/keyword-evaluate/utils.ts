import { callClaude } from '@/lib/ai/claude-cli';

export interface EvaluateParams {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  topReviewCount?: number;
}

export interface EvaluateResult {
  pass: boolean | null;
  reasoning: string | null;
}

const SYSTEM_PROMPT = `당신은 한국 온라인 쇼핑몰(네이버 스마트스토어, 쿠팡) 키워드 소싱 전문가입니다.
셀러가 신규로 진입할 수 있는 키워드인지 판단합니다.

판단 기준 (네이버 쇼핑 기준):
- 경쟁 상품수 10만 이하: 틈새시장, 5만 이하: 유리
- 경쟁 상품수 50만 초과: 경쟁 심함, 100만 초과: 진입 매우 어려움
- 검색량 대비 경쟁수 비율(경쟁수/검색량): 10 이하면 유리, 50 초과면 불리
- 특정 브랜드명 포함(신일, LG, 삼성 등) 키워드는 진입 불가
- 경쟁 상품수 데이터가 없으면(null) 키워드명과 카테고리로 판단
- pass: true 기준 — 합리적으로 진입 가능성이 있으면 true, 명백히 불가능할 때만 false

반드시 JSON만 응답:
{"pass": true/false, "reasoning": "판단 근거 1~2문장"}`;

export async function evaluateKeyword(params: EvaluateParams): Promise<EvaluateResult> {
  const { keyword, searchVolume, competitorCount, topReviewCount } = params;
  const reviewLine = topReviewCount != null ? `상위 리뷰수: ${topReviewCount}` : '';
  const ccLine = competitorCount != null ? `경쟁 상품수: ${competitorCount.toLocaleString()}` : '경쟁 상품수: 데이터 없음 (키워드명과 카테고리로 판단)';
  const userPrompt = `키워드: ${keyword}
월 검색량: ${searchVolume.toLocaleString()}
${ccLine}${reviewLine ? `\n${reviewLine}` : ''}

이 키워드가 신규 셀러 진입에 적합한지 판단해주세요.`;

  try {
    const raw = await callClaude(SYSTEM_PROMPT, userPrompt, 'haiku', 256);
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.pass !== 'boolean' || typeof parsed.reasoning !== 'string') {
      return { pass: null, reasoning: null };
    }
    return { pass: parsed.pass, reasoning: parsed.reasoning };
  } catch {
    return { pass: null, reasoning: null };
  }
}
