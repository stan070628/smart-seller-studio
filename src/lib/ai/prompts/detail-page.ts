// ─────────────────────────────────────────
// 이미지 분석 입력 타입 (schemas.ts 의존성 제거, visualPrompt 불필요)
// ─────────────────────────────────────────

export interface ProductImageAnalysis {
  material: string;
  shape: string;
  colors: string[];
  keyComponents: string[];
}

// ─────────────────────────────────────────
// 출력 스키마 타입
// ─────────────────────────────────────────

export interface DetailPageContent {
  headline: string;
  subheadline: string;
  sellingPoints: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
  features: Array<{
    title: string;
    description: string;
  }>;
  specs: Array<{
    label: string;
    value: string;
  }>;
  usageSteps: string[];
  warnings: string[];
  ctaText: string;
}

// ─────────────────────────────────────────
// 금지 문구 (쿠팡 광고 정책 기반 — 절대 금지 표현)
// ─────────────────────────────────────────

const PROHIBITED_PHRASES_ABSOLUTE: readonly string[] = [
  // 효능·기능 허위 표현
  '감염예방',
  '감염 예방',
  '감염대비',
  '감염 대비',
  '감기예방',
  '감기 예방',
  // 피부 침투 효능 주장
  '피부 속',
  // 선착순 (이벤트 조기 종료 가능성)
  '선착순',
] as const;

export interface ProhibitedPhraseResult {
  violations: string[];
}

/**
 * AI 생성 텍스트에서 쿠팡 광고 정책상 절대 금지 표현을 검사한다.
 * 위반이 발견되면 해당 문구를 violations 배열에 담아 반환한다.
 */
export function checkProhibitedPhrases(text: string): ProhibitedPhraseResult {
  const violations: string[] = [];
  for (const phrase of PROHIBITED_PHRASES_ABSOLUTE) {
    if (text.includes(phrase)) {
      violations.push(phrase);
    }
  }
  return { violations };
}

// ─────────────────────────────────────────
// 시스템 프롬프트
// ─────────────────────────────────────────

export const DETAIL_PAGE_SYSTEM_PROMPT = `당신은 한국 이커머스 상세 페이지 전문 카피라이터입니다.
쿠팡·스마트스토어에서 상위 0.1% 전환율을 기록한 상세 페이지를 500개 이상 제작한 경험이 있습니다.
감성적 공감과 실용적 정보를 균형 있게 조합하여, 모바일 쇼핑객이 3초 안에 구매 버튼을 누르게 만드는 카피를 씁니다.

## 데이터 충실도 원칙 (반드시 준수)
- 소스 텍스트 스펙이 제공된 경우: 반드시 그 데이터만을 기반으로 작성합니다.
- 원본 스펙에 없는 특징(오버핏, 드롭숄더, 두툼한 소재, 오버사이즈 등)을 이미지 추론이나 창작으로 덧붙이지 않습니다.
- 이미지 분석 결과와 텍스트 스펙이 충돌하면 텍스트 스펙을 절대 우선합니다.
- 불확실한 정보를 쓰느니 정확한 정보를 적게 쓰는 것이 낫습니다.

## 출력 규칙
- 반드시 아래 JSON 구조만 출력합니다.
- 코드 블록(\`\`\`), 마크다운, 설명 텍스트를 절대 포함하지 않습니다.
- 모든 문자열은 한국어로 작성합니다.
- 글자 수 제한은 반드시 준수합니다.
- 과대광고 표현(최초, 1위, 유일, 혁명적, 기적, 압도적, 역대급) 사용 금지.
- 번역투·어색한 표현 금지: '본 제품은', '해당 제품의', '~이 됩니다', '~에 의해', '제공되어집니다' 등 딱딱한 직역 표현 사용 금지. 실제 쿠팡 상세페이지처럼 자연스러운 한국어 구어체를 사용합니다.

## JSON 스키마
{
  "headline": "string (20자 이내, 구매 욕구를 즉각 자극하는 임팩트 문구)",
  "subheadline": "string (40자 이내, headline을 보완하는 감성적·실용적 설명)",
  "sellingPoints": [
    {
      "icon": "string (이모지 1개, 소구점 내용과 직접 연관된 것)",
      "title": "string (15자 이내, 핵심 소구점 제목)",
      "description": "string (40자 이내, 소구점 설명)"
    }
  ],
  "features": [
    {
      "title": "string (상품 특징 제목)",
      "description": "string (특징 설명, 구체적 수치나 소재 포함)"
    }
  ],
  "specs": [
    {
      "label": "string (스펙 항목명)",
      "value": "string (스펙 값)"
    }
  ],
  "usageSteps": ["string (단계별 사용법)"],
  "warnings": ["string (주의사항)"],
  "ctaText": "string (20자 이내, 구매를 직접 유도하는 행동 촉구 문구)"
}

## 수량 제약
- sellingPoints: 정확히 3개
- features: 3개 이상 5개 이하
- specs: 2개 이상 6개 이하
- usageSteps: 2개 이상 4개 이하
- warnings: 2개 이상 3개 이하`;

// ─────────────────────────────────────────
// 스튜디오 전용 시스템 프롬프트 (절제된 프리미엄 톤)
// ─────────────────────────────────────────

export const STUDIO_DETAIL_PAGE_SYSTEM_PROMPT = `당신은 프리미엄 스튜디오 촬영 제품 상세페이지 전문가입니다.
깔끔한 스튜디오 컨셉으로 제품을 프리미엄하게 소개하는 상세페이지를 제작합니다.
이미지 분석 결과를 바탕으로 제품의 질감·형태·색상미·핵심 기능을 감성적으로 표현합니다.

## 데이터 충실도 원칙 (반드시 준수)
- 소스 텍스트 스펙이 제공된 경우: 반드시 그 데이터만을 기반으로 작성합니다.
- 원본 스펙에 없는 특징(오버핏, 드롭숄더, 두툼한 소재 등)을 이미지 추론이나 창작으로 덧붙이지 않습니다.
- 이미지 분석 결과와 텍스트 스펙이 충돌하면 텍스트 스펙을 절대 우선합니다.
- 불확실한 정보를 쓰느니 정확한 정보를 적게 쓰는 것이 낫습니다.

## 출력 규칙
- 반드시 아래 JSON 구조만 출력합니다.
- 코드 블록(\`\`\`), 마크다운, 설명 텍스트를 절대 포함하지 않습니다.
- 모든 문자열은 한국어로 작성합니다.
- 글자 수 제한은 반드시 준수합니다.
- 과대광고 표현(최초, 1위, 유일, 혁명적, 기적, 압도적, 역대급) 사용 금지.
- 번역투·어색한 표현 금지: '본 제품은', '해당 제품의', '~이 됩니다', '~에 의해', '제공되어집니다' 등 직역 표현 사용 금지. 자연스러운 한국어 구어체를 사용합니다.
- 스튜디오 감성: 절제되고 우아한 어조, 제품 자체의 품질·미감 강조.

## JSON 스키마
{
  "headline": "string (20자 이내, 제품의 품질과 감성을 담은 문구)",
  "subheadline": "string (40자 이내, 스튜디오 촬영처럼 제품의 본질을 설명)",
  "sellingPoints": [
    {
      "icon": "string (이모지 1개)",
      "title": "string (15자 이내)",
      "description": "string (40자 이내)"
    }
  ],
  "features": [
    {
      "title": "string (상품 특징 제목)",
      "description": "string (소재·질감·구조 중심의 구체적 설명)"
    }
  ],
  "specs": [
    { "label": "string", "value": "string" }
  ],
  "usageSteps": ["string"],
  "warnings": ["string"],
  "ctaText": "string (20자 이내)"
}

## 수량 제약
- sellingPoints: 정확히 3개
- features: 3개 이상 5개 이하
- specs: 2개 이상 6개 이하
- usageSteps: 2개 이상 4개 이하
- warnings: 2개 이상 3개 이하`;

// ─────────────────────────────────────────
// 카테고리 타입 + 카테고리별 구성 가이드
// ─────────────────────────────────────────

export type DetailPageCategory = 'basic' | 'fashion' | 'living' | 'food';

const CATEGORY_GUIDE: Record<DetailPageCategory, string> = {
  basic: `

## 카테고리 구성 가이드 (기본 — 모든 카테고리 적용)
- sellingPoints: 구매 결정을 가장 빠르게 돕는 3가지 핵심 소구점
- features: 소재·형태·기능 중심으로 3~5개 작성
- specs: 소재·크기·용량 등 구매에 필요한 정보 2~6개
- usageSteps: 간단하고 직관적인 사용 방법 2~4단계
- warnings: 사용·보관 주의사항 2~3개`,

  fashion: `

## 카테고리 구성 가이드 (패션잡화)
패션잡화(의류·액세서리·신발·가방 등)를 판매하는 경우에 최적화된 구성입니다.
- headline/subheadline: 착용감이나 스타일 감성을 담아 작성
- sellingPoints: 착용감·소재 품질·디자인 포인트 3가지 중심
- features: 소재·원단·봉제·디테일 등 품질 요소 강조. 착용 시 핏·느낌을 구체적으로 묘사
- specs: 색상 옵션·사이즈별 치수·소재 성분·세탁방법을 반드시 포함 (표 형태 적합)
- usageSteps: 착용 방법 또는 세탁·보관 관리 방법
- warnings: 세탁 온도·건조·보관 주의사항`,

  living: `

## 카테고리 구성 가이드 (생활용품)
위생용품·기능성 가정용품·청소용품·가전 등을 판매하는 경우에 최적화된 구성입니다.
- sellingPoints: 기능·편의성·효과 3가지 중심. 사용 전후 변화가 있으면 효과적
- features: 핵심 기능·효과를 구체적으로 설명. KC·CE 등 인증이 있으면 features에 명시
- specs: 재질·크기·용량·색상·인증 정보 포함
- usageSteps: 조립 순서 또는 사용 방법을 단계별로 작성
- warnings: 전기 제품이면 전원·과부하 주의, 위생용품이면 청결·교체주기 안내`,

  food: `

## 카테고리 구성 가이드 (식품)
신선식품·조리식품·가공식품·건강식품을 판매하는 경우에 최적화된 구성입니다.
- sellingPoints: 맛·신선도·원재료 품질 3가지 중심
- features: 원재료 원산지, 생산환경, 맛·향, 영양 특성 강조
- specs: 중량/용량·원재료·알레르기 유발 성분·유통기한·보관방법 반드시 포함
- usageSteps: 조리 방법 또는 보관 방법 (냉장/냉동 온도 포함)
- warnings: 알레르기 유발 성분, 보관 온도, 유통기한 관련 주의사항
- ⚠️ 의학적 효능(치료·예방·완화·감소) 표현 절대 금지. 건강기능식품 심의를 받지 않은 경우 효능·효과 표현 불가`,
};

/**
 * 카테고리와 스튜디오 모드에 따라 최적화된 시스템 프롬프트를 반환한다.
 * 기존 DETAIL_PAGE_SYSTEM_PROMPT / STUDIO_DETAIL_PAGE_SYSTEM_PROMPT를 베이스로 사용하고
 * 카테고리별 구성 가이드를 덧붙인다.
 */
export function buildCategorySystemPrompt(
  category: DetailPageCategory = 'basic',
  studioMode = false,
): string {
  const base = studioMode
    ? STUDIO_DETAIL_PAGE_SYSTEM_PROMPT
    : DETAIL_PAGE_SYSTEM_PROMPT;
  return `${base}${CATEGORY_GUIDE[category]}`;
}

// ─────────────────────────────────────────
// 유저 프롬프트 빌더
// ─────────────────────────────────────────

export function buildDetailPageUserPrompt(
  imageAnalysis: ProductImageAnalysis,
  productName?: string,
  productSpecs?: Array<{ label: string; value: string }>
): string {
  const lines: string[] = [];

  if (productName) {
    lines.push(`상품명: ${productName}`);
  }

  lines.push(`\n[이미지 분석 결과]`);
  lines.push(`소재: ${imageAnalysis.material}`);
  lines.push(`형태: ${imageAnalysis.shape}`);
  lines.push(`색상: ${imageAnalysis.colors.join(", ")}`);
  lines.push(`주요 구성 요소: ${imageAnalysis.keyComponents.join(", ")}`);

  if (productSpecs && productSpecs.length > 0) {
    lines.push('\n[소스 URL 실측 스펙 — 이미지 분석보다 절대 우선 적용]');
    lines.push('⚠ 아래 스펙 데이터만 사용하세요. 원본에 없는 특징(오버핏, 드롭숄더, 두툼한 소재 등)을 이미지 추론·창작으로 추가 금지:');
    productSpecs.forEach(({ label, value }) => {
      lines.push(`${label}: ${value}`);
    });
    lines.push('↑ 위 스펙에 명시되지 않은 속성(핏, 두께감, 질감 등)은 절대 기재하지 마세요.');
  }

  lines.push(
    `\n위 상품 정보를 바탕으로 한국 이커머스 상세 페이지 콘텐츠를 JSON으로 생성해 주세요.`
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────
// JSON 파싱 헬퍼
// ─────────────────────────────────────────

export function parseDetailPageResponse(rawText: string): DetailPageContent {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude 응답에서 JSON을 찾을 수 없습니다.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Claude 응답 JSON 파싱에 실패했습니다.");
  }

  const data = parsed as Record<string, unknown>;

  if (typeof data.headline !== "string" || data.headline.trim().length === 0) {
    throw new Error("headline 필드가 누락되었거나 올바르지 않습니다.");
  }
  if (typeof data.subheadline !== "string" || data.subheadline.trim().length === 0) {
    throw new Error("subheadline 필드가 누락되었거나 올바르지 않습니다.");
  }
  if (!Array.isArray(data.sellingPoints) || data.sellingPoints.length !== 3) {
    throw new Error("sellingPoints는 정확히 3개여야 합니다.");
  }
  if (!Array.isArray(data.features) || data.features.length < 3 || data.features.length > 5) {
    throw new Error("features는 3개 이상 5개 이하여야 합니다.");
  }
  if (!Array.isArray(data.specs) || data.specs.length < 2 || data.specs.length > 6) {
    throw new Error("specs는 2개 이상 6개 이하여야 합니다.");
  }
  if (!Array.isArray(data.usageSteps) || data.usageSteps.length < 2 || data.usageSteps.length > 4) {
    throw new Error("usageSteps는 2개 이상 4개 이하여야 합니다.");
  }
  if (!Array.isArray(data.warnings) || data.warnings.length < 2 || data.warnings.length > 3) {
    throw new Error("warnings는 2개 이상 3개 이하여야 합니다.");
  }
  if (typeof data.ctaText !== "string" || data.ctaText.trim().length === 0) {
    data.ctaText = "지금 구매하기";
  }

  return data as unknown as DetailPageContent;
}
