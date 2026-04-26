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
// 시스템 프롬프트
// ─────────────────────────────────────────

export const DETAIL_PAGE_SYSTEM_PROMPT = `당신은 한국 이커머스 상세 페이지 전문 카피라이터입니다.
쿠팡·스마트스토어에서 상위 0.1% 전환율을 기록한 상세 페이지를 500개 이상 제작한 경험이 있습니다.
감성적 공감과 실용적 정보를 균형 있게 조합하여, 모바일 쇼핑객이 3초 안에 구매 버튼을 누르게 만드는 카피를 씁니다.

## 출력 규칙
- 반드시 아래 JSON 구조만 출력합니다.
- 코드 블록(\`\`\`), 마크다운, 설명 텍스트를 절대 포함하지 않습니다.
- 모든 문자열은 한국어로 작성합니다.
- 글자 수 제한은 반드시 준수합니다.
- 과대광고 표현(최초, 1위, 유일, 혁명적, 기적, 압도적, 역대급) 사용 금지.

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

## 출력 규칙
- 반드시 아래 JSON 구조만 출력합니다.
- 코드 블록(\`\`\`), 마크다운, 설명 텍스트를 절대 포함하지 않습니다.
- 모든 문자열은 한국어로 작성합니다.
- 글자 수 제한은 반드시 준수합니다.
- 과대광고 표현(최초, 1위, 유일, 혁명적, 기적, 압도적, 역대급) 사용 금지.
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
    lines.push('\n[홈페이지 스펙 정보 — specs 필드에 반드시 반영할 것]');
    productSpecs.forEach(({ label, value }) => {
      lines.push(`${label}: ${value}`);
    });
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
