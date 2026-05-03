import type { ClassifiedImage } from '@/lib/listing/import-1688-types';
import type { DetailPageContent } from './detail-page';

// ─── 분류 프롬프트 ───────────────────────────────────────────────────────────

export const CLASSIFY_SYSTEM_PROMPT = `당신은 이커머스 상품 이미지 분류 전문가입니다.
주어진 이미지들을 아래 4가지 유형 중 하나로 분류합니다.

유형:
- main_product: 단독 상품컷 (흰색/단색 배경, 상품 전체가 보임)
- lifestyle: 사용 장면 (실생활 배경, 모델 착용/사용)
- infographic: 텍스트·수치·화살표가 포함된 설명 이미지
- size_chart: 사이즈표·규격표

JSON 배열만 출력. 설명 없음. 예: [{"index":0,"type":"main_product"}]`;

export function buildClassifyUserPrompt(count: number): string {
  return `위 ${count}개 이미지를 순서대로 분류해 주세요. JSON 배열만 반환합니다.`;
}

export function parseClassifyResponse(
  raw: string,
  urls: string[]
): ClassifiedImage[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('no JSON array');
    const parsed = JSON.parse(match[0]) as Array<{ index: number; type: string }>;
    return urls.map((url, i) => {
      const found = parsed.find((p) => p.index === i);
      const type = found?.type as ClassifiedImage['type'] | undefined;
      const validTypes: ClassifiedImage['type'][] = [
        'main_product', 'lifestyle', 'infographic', 'size_chart',
      ];
      return {
        url,
        type: validTypes.includes(type as ClassifiedImage['type'])
          ? (type as ClassifiedImage['type'])
          : 'lifestyle',
      };
    });
  } catch {
    return urls.map((url) => ({ url, type: 'lifestyle' as const }));
  }
}

// ─── 생성 프롬프트 ───────────────────────────────────────────────────────────

export const GENERATE_SYSTEM_PROMPT = `당신은 한국 이커머스 상세 페이지 전문 카피라이터입니다.
1688(중국 도매 플랫폼) 상품 이미지를 분석하여 한국 쿠팡 셀러용 상품 정보를 생성합니다.

## 핵심 규칙
- 이미지에 중국어 텍스트가 보이면 의미를 파악해 한국어로 자연스럽게 표현합니다.
- 과대광고 표현 금지: 최초·1위·유일·혁명적·기적·압도적
- 번역투 금지: '본 제품은', '해당 제품의', '~이 됩니다'
- 자연스러운 한국어 구어체로 작성합니다.

## 출력
JSON만 반환합니다. 코드블록, 마크다운, 설명 없음.

스키마:
{
  "headline": "20자 이내 임팩트 문구",
  "subheadline": "40자 이내 보완 설명",
  "sellingPoints": [
    {"icon": "이모지 1개", "title": "15자 이내", "description": "40자 이내"}
  ],
  "features": [
    {"title": "특징 제목", "description": "구체적 설명"}
  ],
  "specs": [
    {"label": "항목명", "value": "값"}
  ],
  "usageSteps": ["단계1", "단계2"],
  "warnings": ["주의사항1", "주의사항2"],
  "ctaText": "구매 유도 문구"
}

sellingPoints: 정확히 3개 / features: 3~5개 / specs: 2~6개 / usageSteps: 2~4개 / warnings: 2~3개`;

export function buildGenerateUserPrompt(): string {
  return `위 이미지들을 보고 한국 쿠팡 상세페이지용 상품 정보를 JSON으로 생성해 주세요.`;
}

export function parseGenerateContent(raw: string): DetailPageContent {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('Claude 응답 JSON 파싱에 실패했습니다.');
  }

  const d = parsed as Record<string, unknown>;
  if (typeof d.headline !== 'string' || !d.headline.trim()) {
    throw new Error('headline이 없습니다.');
  }
  if (typeof d.subheadline !== 'string') d.subheadline = '';
  if (!Array.isArray(d.sellingPoints)) d.sellingPoints = [];
  if (!Array.isArray(d.features)) d.features = [];
  if (!Array.isArray(d.specs)) d.specs = [];
  if (!Array.isArray(d.usageSteps)) d.usageSteps = [];
  if (!Array.isArray(d.warnings)) d.warnings = [];
  if (typeof d.ctaText !== 'string') d.ctaText = '지금 구매하기';

  return d as unknown as DetailPageContent;
}
