import type { DetailSection } from '@/types/detail-page';
import type { RichSections } from '@/types/detail-page';

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
  richSections?: RichSections;
}

export interface MobileDetailPageContent {
  brandName: string;            // 빈 문자열이면 brand_header 섹션 생략
  categoryLabelEn: string;      // 예: "pencil pouch"
  hook: {
    eyebrow: string;            // 예: "Keep Till" — 필기체 렌더링
    headline: string;           // 예: "완전 오픈 · 넉넉한 수납"
    hashtags: string[];         // 예: ["#한눈에 보여", "#쉽게 꺼내", "#깔끔하게 정리"]
  };
  points: Array<{
    pointLabel: string;         // "Point 1" 또는 "" (요약 섹션)
    headline: string;
    subheadline: string;
  }>;
  colorOptions: Array<{ label: string; swatchColor: string }>;
  specs: Array<{ label: string; value: string }>;
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
      "icon": "string (BMP 범위 이모지 1개 — ☀⭐✨❤✅✔⚡♻★❄✈✉♥♦➡❗⭕☁☂☃♠♣✦✪ 중 소구점과 어울리는 것. 금지: 🎀🪡💡🔥🏆🎯🌟 등 U+10000 이상 4바이트 이모지)",
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
  "ctaText": "string (20자 이내, 구매를 직접 유도하는 행동 촉구 문구)",
  "richSections": {
    "selectedSections": ["string — point|stat|bar_chart|why|cert|steps 중 이 상품에 적합한 것만"],
    "pointSections": [{"number": "number (1,2,3)", "title": "string (20자 이내)", "description": "string (60자 이내)"}],
    "statCallouts": [{"value": "string (예: '단백질 20g', '93.5%')", "label": "string (예: '1회 제공량당')", "description": "string (40자 이내)"}],
    "barChartItems": [{"label": "string", "percentage": "number (0~200)", "displayValue": "string (예: '150%', '20g')"}],
    "whyIcons": [{"icon": "string (BMP 이모지)", "title": "string (15자 이내)", "description": "string (40자 이내)"}],
    "certifications": [{"name": "string (예: 'GMP 인증')", "description": "string (40자 이내)"}],
    "infographicSteps": [{"step": "number", "icon": "string (이모지)", "title": "string (15자 이내)", "description": "string (30자 이내)"}]
  }
}

## 수량 제약
- sellingPoints: 정확히 3개
- features: 3개 이상 5개 이하
- specs: 2개 이상 6개 이하
- usageSteps: 2개 이상 4개 이하
- warnings: 2개 이상 3개 이하

## richSections 생성 규칙
상품 카테고리와 이미지를 분석하여 selectedSections에 적합한 섹션 key만 포함하라.
- 건강기능식품·보충제: ["point","stat","why","bar_chart","cert","steps"]
- 뷰티·스킨케어: ["point","stat","why","cert","steps"]
- 패션·라이프스타일: ["point","why"]
- 가전·생활용품: ["why","steps","point"]
- 식품·음료: ["point","why","stat","steps"]
- 기타: ["point","why"]
⚠️ stat·bar_chart·certifications 수치는 이미지·텍스트에서 실제 확인된 것만. 추론·창작 금지.`;

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
      "icon": "string (BMP 범위 이모지 1개 — ☀⭐✨❤✅✔⚡♻★❄✈♥♦➡❗⭕✦✪ 중 선택. 금지: U+10000 이상 4바이트 이모지)",
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
// 모바일(쿠팡 스타일) 시스템 프롬프트
// ─────────────────────────────────────────

export const MOBILE_DETAIL_PAGE_SYSTEM_PROMPT = `당신은 한국 이커머스 모바일 상세 페이지 전문 카피라이터입니다.
쿠팡 모바일 앱에서 상위 0.1% 전환율을 기록한 상세 페이지를 500개 이상 제작했습니다.
좁은 모바일 화면에서 스크롤을 멈추게 하는 큰 타이포·짧은 카피·Point 구조를 사용합니다.

## 데이터 충실도 원칙 (반드시 준수)
- 소스 텍스트 스펙이 제공된 경우: 반드시 그 데이터만을 기반으로 작성합니다.
- 원본 스펙에 없는 특징(오버핏, 드롭숄더, 두툼한 소재 등)을 이미지 추론이나 창작으로 덧붙이지 않습니다.
- 이미지 분석 결과와 텍스트 스펙이 충돌하면 텍스트 스펙을 절대 우선합니다.
- 불확실한 정보를 쓰느니 정확한 정보를 적게 쓰는 것이 낫습니다.

## 출력 규칙
- 반드시 아래 JSON 구조만 출력합니다.
- 코드 블록(\`\`\`), 마크다운, 설명 텍스트를 절대 포함하지 않습니다.
- brandName·categoryLabelEn 외 모든 문자열은 한국어로 작성합니다.
- 과대광고 표현(최초, 1위, 유일, 혁명적, 기적, 압도적, 역대급) 사용 금지.
- 번역투·어색한 표현 금지: '본 제품은', '해당 제품의', '~이 됩니다', '~에 의해', '제공되어집니다' 등 딱딱한 직역 표현 사용 금지. 실제 쿠팡 상세페이지처럼 자연스러운 한국어 구어체를 사용합니다.

## 카피 스타일 규칙 (쿠팡 모바일 패턴)
- hook.headline: 명사형 압축, 가운뎃점(·)으로 핵심 가치 2개 연결. 예: "완전 오픈 · 넉넉한 수납". 12자 이내.
- hook.hashtags: 정확히 3개, 각 5~7자. 예: "#한눈에 보여", "#쉽게 꺼내".
- hook.eyebrow: 브랜드명 영문 표기 (없으면 빈 문자열).
- points: 3~4개. 앞의 2~3개는 pointLabel을 "Point 1", "Point 2"...로 부여.
  마지막 1개는 pointLabel을 ""(빈 문자열)로 두고 headline을 부사형 한 단어로 작성. 예: "넉넉하게", "든든하게", "조용하게".
- point.headline: 작은따옴표 강조 활용. 예: "펼치면 바로 '보이는' 필통", "펼치면 '박스처럼' 서는 설계". 16자 이내.
- point.subheadline: 구체적 사실 1문장. 예: "180도 완전 오픈형 구조", "흐물거림 없이 책상 위에서 안정적으로 착!". 24자 이내.
- colorOptions: 이미지에서 색상·옵션이 2개 이상 확인될 때만 작성, 아니면 빈 배열. swatchColor는 #RRGGBB hex.

## JSON 스키마
{
  "brandName": "string (브랜드명, 모르면 빈 문자열)",
  "categoryLabelEn": "string (영문 카테고리 소문자, 예: pencil pouch)",
  "hook": {
    "eyebrow": "string",
    "headline": "string (12자 이내)",
    "hashtags": ["string (정확히 3개, 각 5~7자)"]
  },
  "points": [
    { "pointLabel": "string (Point 1 형식 또는 빈 문자열)", "headline": "string (16자 이내)", "subheadline": "string (24자 이내)" }
  ],
  "colorOptions": [{ "label": "string (한국어 색상명)", "swatchColor": "string (#RRGGBB)" }],
  "specs": [{ "label": "string", "value": "string" }],
  "warnings": ["string"],
  "ctaText": "string (20자 이내)"
}

## 수량 제약
- points: 3개 이상 4개 이하
- hashtags: 정확히 3개
- specs: 2개 이상 6개 이하
- warnings: 2개 이상 3개 이하`;

/** 모바일 베이스 프롬프트 + 카테고리 가이드 결합 */
export function buildMobileCategorySystemPrompt(category: DetailPageCategory = 'basic'): string {
  // CATEGORY_GUIDE는 데스크톱 스키마(sellingPoints/features/usageSteps) 기준으로 작성되어 있다.
  // 모바일 스키마에는 해당 필드가 없으므로, 가이드를 소구점 선정 기준으로만 참고하도록 브리징한다.
  const bridge =
    '\n\n## 카테고리 가이드 적용 방법\n아래 카테고리 가이드는 데스크톱 스키마 기준으로 작성되어 있습니다. sellingPoints·features·usageSteps 등의 필드명은 무시하고, 내용은 points·specs·warnings 작성 시 소구점 선정과 강조 우선순위 기준으로만 참고하세요. 출력 JSON 구조는 반드시 위 모바일 스키마를 따릅니다.';
  return `${MOBILE_DETAIL_PAGE_SYSTEM_PROMPT}${bridge}${CATEGORY_GUIDE[category]}`;
}

/**
 * 모바일 상세페이지 AI 응답을 MobileDetailPageContent로 파싱한다.
 * 파서가 모든 필드의 검증·기본값 채움을 책임진다 — mobileContentToSections는
 * 출력 형태를 신뢰하고 raw 접근(trim, join 등)하므로 반환값은 완전한 형태여야 한다.
 */
export function parseMobileDetailPageResponse(rawText: string): MobileDetailPageContent {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Claude 응답 JSON 파싱에 실패했습니다.');
  }

  const data = parsed as Record<string, unknown>;
  const hook = data.hook as Record<string, unknown> | undefined;

  if (!hook || typeof hook.headline !== 'string' || hook.headline.trim().length === 0) {
    throw new Error('hook.headline 필드가 누락되었거나 올바르지 않습니다.');
  }
  if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 5) {
    throw new Error('points는 2개 이상 5개 이하여야 합니다.');
  }

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  return {
    brandName: str(data.brandName),
    categoryLabelEn: str(data.categoryLabelEn),
    hook: {
      eyebrow: str(hook.eyebrow),
      headline: hook.headline.trim(),
      // 프롬프트는 정확히 3개를 지시하지만 파서는 1개 초과분까지 관용 허용 후 최대 3개로 절단
      hashtags: strArr(hook.hashtags).slice(0, 3),
    },
    points: (data.points as Array<Record<string, unknown> | null>).map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return {
        pointLabel: str(o.pointLabel),
        headline: str(o.headline),
        subheadline: str(o.subheadline),
      };
    }),
    colorOptions: Array.isArray(data.colorOptions)
      ? (data.colorOptions as Array<Record<string, unknown> | null>)
          .filter((c): c is Record<string, unknown> => c != null && typeof c.label === 'string' && c.label.length > 0)
          .map((c) => ({ label: c.label as string, swatchColor: str(c.swatchColor) }))
      : [],
    specs: Array.isArray(data.specs)
      ? (data.specs as Array<Record<string, unknown> | null>)
          .filter((s): s is Record<string, unknown> => s != null && typeof s.label === 'string' && typeof s.value === 'string')
          .map((s) => ({ label: s.label as string, value: s.value as string }))
      : [],
    warnings: strArr(data.warnings),
    ctaText: str(data.ctaText).trim() || '지금 구매하기',
  };
}

// ─────────────────────────────────────────
// 유저 프롬프트 빌더
// ─────────────────────────────────────────

export function buildDetailPageUserPrompt(
  imageAnalysis: ProductImageAnalysis,
  productName?: string,
  productSpecs?: Array<{ label: string; value: string }>,
  /**
   * 대화식 상세페이지 생성 모드에서 수집한 마케팅 브리프 답변.
   * 있으면 상품명 직후·이미지 분석 직전에 마케팅 브리프 블록으로 prepend.
   * 디자인 문서 §5.3 참고.
   */
  conversationContext?: import('@/lib/conversational-detail/types').ConversationContext,
  /**
   * 판매자가 직접 입력한 참고 텍스트 (경쟁사 분석, 강조 포인트 등).
   * 공백만 있는 경우 무시. 스펙 블록 이후, 최종 지시 직전에 삽입.
   */
  referenceText?: string,
): string {
  const lines: string[] = [];

  if (productName) {
    lines.push(`상품명: ${productName}`);
  }

  if (conversationContext && conversationContext.answers.length > 0) {
    lines.push('\n[마케팅 브리프 — 절대 우선 반영]');
    lines.push('아래 사용자 답변을 톤·구성·강조점의 핵심 가이드로 사용하세요. 이미지 분석보다 우선합니다.');
    for (const answer of conversationContext.answers) {
      if (answer.resolvedValue && answer.resolvedValue.trim()) {
        lines.push(`- ${answer.questionId}: ${answer.resolvedValue.trim()}`);
      }
    }
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
    lines.push('- 판매 단위/소분 단위가 있으면 headline, specs, warnings에서 총중량만 단독 강조하지 말고 판매 단위를 우선 표기하세요.');
    lines.push('- 예: "44개입 (총 4.1kg) / 개당 93.2g"처럼 소분 수량, 총량, 개당 중량을 함께 보여주세요.');
    lines.push('- 원재료·함량·내용량 항목도 전체 중량보다 실제 판매되는 소분 포장 단위를 먼저 노출하세요.');
    lines.push('↑ 위 스펙에 명시되지 않은 속성(핏, 두께감, 질감 등)은 절대 기재하지 마세요.');
  }

  if (referenceText?.trim()) {
    lines.push(`\n[판매자 참고 텍스트]\n${referenceText.trim()}`);
  }

  lines.push(
    `\n위 상품 정보를 바탕으로 한국 이커머스 상세 페이지 콘텐츠를 JSON으로 생성해 주세요.`
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────
// JSON 파싱 헬퍼
// ─────────────────────────────────────────

// 쿠팡은 U+10000 이상의 4바이트 UTF-8 문자(비-BMP 이모지)를 서버에서 제거한다.
// icon 필드에 비-BMP 이모지가 섞이면 쿠팡 상세페이지에서 해당 이모지만 사라지는 현상이 발생한다.
function sanitizeIconToBmp(icon: string): string {
  const filtered = [...icon].filter(c => (c.codePointAt(0) ?? 0) <= 0xFFFF).join('');
  return filtered || '★';
}

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

  // 비-BMP 이모지 sanitize (쿠팡 등록 시 U+10000+ 문자가 서버에서 제거되는 문제 방지)
  (data.sellingPoints as Array<{ icon: string; title: string; description: string }>).forEach(sp => {
    sp.icon = sanitizeIconToBmp(sp.icon);
  });

  return data as unknown as DetailPageContent;
}

// ─────────────────────────────────────────
// 섹션 편집 프롬프트 빌더 (edit-section API 공유 유틸)
// ─────────────────────────────────────────

// edit-section AI가 신규 모바일 섹션 타입의 구조를 이해하도록 돕는 타입별 힌트
const SECTION_TYPE_HINTS: Partial<Record<string, string>> = {
  brand_header: 'brandName(브랜드명)과 rightLabel(영문 카테고리)을 가진 상단 헤더',
  point: "pointLabel('Point 1' 또는 빈 문자열), headline(작은따옴표 강조 가능), subheadline(구체적 사실 1문장)을 가진 쿠팡 스타일 포인트 섹션",
  image_grid: 'title과 items[{label, swatchColor}](색상 옵션 라벨)를 가진 2컬럼 이미지 그리드',
};

/**
 * 섹션 편집 요청에 대한 유저 프롬프트를 생성한다.
 * existingSections가 있으면 현재 상세페이지 구성 맥락을 추가하여 AI 일관성을 높인다.
 */
export function buildSectionEditPrompt(
  section: DetailSection,
  instruction: string,
  productName?: string,
  existingSections?: Array<{ type: string; content: Record<string, unknown> }>,
): string {
  const lines: string[] = [
    `## 섹션 타입: ${section.type}`,
    `## 편집 지시어: ${instruction}`,
  ];
  const hint = SECTION_TYPE_HINTS[section.type];
  if (hint) {
    lines.push(`## 섹션 타입 설명: ${hint}`);
  }
  if (productName) {
    lines.push(`## 상품명: ${productName}`);
  }
  if (existingSections && existingSections.length > 0) {
    const sectionTypes = existingSections.map(s => s.type).join(', ');
    lines.push(`## 현재 상세페이지 섹션 구성: ${sectionTypes}`);
  }
  lines.push(
    ``,
    `## 현재 섹션 데이터 (JSON):`,
    JSON.stringify(section.content, null, 2),
    ``,
    `위 섹션을 지시어에 따라 개선한 새 섹션 content를 JSON으로 반환하세요.`,
    `반드시 type 필드를 "${section.type}"으로 유지하세요.`,
  );
  return lines.join('\n');
}

// ─────────────────────────────────────────
// AI 응답 JSON 추출 헬퍼 (섹션 편집 전용)
// ─────────────────────────────────────────

/**
 * AI 응답 텍스트에서 JSON 객체를 추출한다.
 * 코드 블록 래퍼를 제거한 뒤 첫 번째 JSON 객체({...})를 정규식으로 탐색하여 파싱한다.
 * AI가 앞뒤에 설명 텍스트를 추가하는 경우에도 안전하게 동작한다.
 */
export function parseJsonFromText(text: string): unknown {
  // 코드 블록 제거
  const withoutCodeBlock = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  // JSON 객체 추출 (AI가 앞뒤에 텍스트를 추가할 경우 대비)
  const match = withoutCodeBlock.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON 블록을 찾을 수 없습니다.');
  return JSON.parse(match[0]);
}
