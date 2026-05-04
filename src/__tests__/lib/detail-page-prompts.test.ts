/**
 * detail-page-prompts.test.ts
 *
 * parseDetailPageResponse, buildDetailPageUserPrompt 동작 검증
 *
 * RED: 함수가 export되지 않거나 시그니처가 다르면 즉시 실패
 * GREEN: 함수가 올바르게 구현되어 있으면 통과
 */

import { describe, it, expect } from 'vitest';
import {
  parseDetailPageResponse,
  buildDetailPageUserPrompt,
  checkProhibitedPhrases,
  buildCategorySystemPrompt,
  type ProductImageAnalysis,
  type DetailPageCategory,
} from '@/lib/ai/prompts/detail-page';

// ─── 픽스처 ────────────────────────────────────────────────────────────────

const validContent = {
  headline: '헤드라인',
  subheadline: '서브헤드라인',
  sellingPoints: [
    { icon: '✨', title: '포인트1', description: '설명1' },
    { icon: '💎', title: '포인트2', description: '설명2' },
    { icon: '🌟', title: '포인트3', description: '설명3' },
  ],
  features: [
    { title: '특징1', description: '설명1' },
    { title: '특징2', description: '설명2' },
    { title: '특징3', description: '설명3' },
  ],
  specs: [
    { label: '소재', value: '스테인리스' },
    { label: '용량', value: '1L' },
  ],
  usageSteps: ['1단계', '2단계'],
  warnings: ['주의1', '주의2'],
  ctaText: '지금 구매',
};

const validImageAnalysis: ProductImageAnalysis = {
  material: '스테인리스 스틸',
  shape: '원통형 텀블러',
  colors: ['실버', '블랙'],
  keyComponents: ['뚜껑', '본체', '손잡이'],
};

// ─── parseDetailPageResponse ────────────────────────────────────────────────

describe('parseDetailPageResponse', () => {
  describe('유효한 JSON', () => {
    it('완전한 JSON 문자열을 파싱하여 DetailPageContent를 반환한다', () => {
      const result = parseDetailPageResponse(JSON.stringify(validContent));
      expect(result.headline).toBe('헤드라인');
      expect(result.subheadline).toBe('서브헤드라인');
      expect(result.sellingPoints).toHaveLength(3);
      expect(result.ctaText).toBe('지금 구매');
    });

    it('코드 블록으로 감싸진 JSON에서도 올바르게 파싱한다', () => {
      const wrapped = `\`\`\`json\n${JSON.stringify(validContent)}\n\`\`\``;
      const result = parseDetailPageResponse(wrapped);
      expect(result.headline).toBe('헤드라인');
    });

    it('앞뒤에 설명 텍스트가 있어도 JSON을 추출해 파싱한다', () => {
      const withText = `다음은 결과입니다:\n${JSON.stringify(validContent)}\n이상입니다.`;
      const result = parseDetailPageResponse(withText);
      expect(result.headline).toBe('헤드라인');
    });

    it('ctaText가 없으면 "지금 구매하기"를 기본값으로 사용한다', () => {
      const withoutCta = { ...validContent, ctaText: '' };
      const result = parseDetailPageResponse(JSON.stringify(withoutCta));
      expect(result.ctaText).toBe('지금 구매하기');
    });
  });

  describe('필수 필드 누락 오류', () => {
    it('JSON이 없으면 에러를 던진다', () => {
      expect(() => parseDetailPageResponse('JSON이 아닌 텍스트')).toThrow();
    });

    it('headline이 없으면 에러를 던진다', () => {
      const noHeadline = { ...validContent, headline: '' };
      expect(() => parseDetailPageResponse(JSON.stringify(noHeadline))).toThrow(/headline/);
    });

    it('subheadline이 없으면 에러를 던진다', () => {
      const noSub = { ...validContent, subheadline: '' };
      expect(() => parseDetailPageResponse(JSON.stringify(noSub))).toThrow(/subheadline/);
    });
  });

  describe('수량 제약 위반 오류', () => {
    it('sellingPoints가 3개가 아니면 에러를 던진다 (2개)', () => {
      const twoPoints = { ...validContent, sellingPoints: validContent.sellingPoints.slice(0, 2) };
      expect(() => parseDetailPageResponse(JSON.stringify(twoPoints))).toThrow(/sellingPoints/);
    });

    it('sellingPoints가 3개가 아니면 에러를 던진다 (4개)', () => {
      const fourPoints = {
        ...validContent,
        sellingPoints: [...validContent.sellingPoints, { icon: '🔥', title: '포인트4', description: '설명4' }],
      };
      expect(() => parseDetailPageResponse(JSON.stringify(fourPoints))).toThrow(/sellingPoints/);
    });

    it('features가 3개 미만이면 에러를 던진다', () => {
      const twoFeatures = { ...validContent, features: validContent.features.slice(0, 2) };
      expect(() => parseDetailPageResponse(JSON.stringify(twoFeatures))).toThrow(/features/);
    });

    it('features가 5개 초과이면 에러를 던진다', () => {
      const sixFeatures = {
        ...validContent,
        features: Array.from({ length: 6 }, (_, i) => ({ title: `특징${i}`, description: `설명${i}` })),
      };
      expect(() => parseDetailPageResponse(JSON.stringify(sixFeatures))).toThrow(/features/);
    });

    it('specs가 2개 미만이면 에러를 던진다', () => {
      const oneSpec = { ...validContent, specs: [validContent.specs[0]] };
      expect(() => parseDetailPageResponse(JSON.stringify(oneSpec))).toThrow(/specs/);
    });

    it('specs가 6개 초과이면 에러를 던진다', () => {
      const sevenSpecs = {
        ...validContent,
        specs: Array.from({ length: 7 }, (_, i) => ({ label: `항목${i}`, value: `값${i}` })),
      };
      expect(() => parseDetailPageResponse(JSON.stringify(sevenSpecs))).toThrow(/specs/);
    });

    it('usageSteps가 2개 미만이면 에러를 던진다', () => {
      const oneStep = { ...validContent, usageSteps: ['1단계만'] };
      expect(() => parseDetailPageResponse(JSON.stringify(oneStep))).toThrow(/usageSteps/);
    });

    it('usageSteps가 4개 초과이면 에러를 던진다', () => {
      const fiveSteps = { ...validContent, usageSteps: ['1', '2', '3', '4', '5'] };
      expect(() => parseDetailPageResponse(JSON.stringify(fiveSteps))).toThrow(/usageSteps/);
    });

    it('warnings가 2개 미만이면 에러를 던진다', () => {
      const oneWarning = { ...validContent, warnings: ['주의1만'] };
      expect(() => parseDetailPageResponse(JSON.stringify(oneWarning))).toThrow(/warnings/);
    });

    it('warnings가 3개 초과이면 에러를 던진다', () => {
      const fourWarnings = { ...validContent, warnings: ['1', '2', '3', '4'] };
      expect(() => parseDetailPageResponse(JSON.stringify(fourWarnings))).toThrow(/warnings/);
    });
  });
});

// ─── buildDetailPageUserPrompt ──────────────────────────────────────────────

describe('buildDetailPageUserPrompt', () => {
  it('이미지 분석 결과가 항상 포함된다', () => {
    const result = buildDetailPageUserPrompt(validImageAnalysis);
    expect(result).toContain('스테인리스 스틸');
    expect(result).toContain('원통형 텀블러');
    expect(result).toContain('실버');
    expect(result).toContain('뚜껑');
  });

  it('productName이 있으면 포함된다', () => {
    const result = buildDetailPageUserPrompt(validImageAnalysis, '프리미엄 텀블러');
    expect(result).toContain('프리미엄 텀블러');
  });

  it('productName이 없으면 상품명 줄이 없다', () => {
    const result = buildDetailPageUserPrompt(validImageAnalysis);
    expect(result).not.toContain('상품명:');
  });

  it('productSpecs가 있으면 스펙 섹션이 포함된다', () => {
    const specs = [{ label: '용량', value: '500ml' }, { label: '소재', value: '스테인리스' }];
    const result = buildDetailPageUserPrompt(validImageAnalysis, undefined, specs);
    expect(result).toContain('용량');
    expect(result).toContain('500ml');
    expect(result).toContain('스테인리스');
  });

  it('productSpecs가 없으면 스펙 섹션이 없다', () => {
    const result = buildDetailPageUserPrompt(validImageAnalysis, '상품명');
    expect(result).not.toContain('홈페이지 스펙 정보');
  });

  it('JSON 생성 지시문이 포함된다', () => {
    const result = buildDetailPageUserPrompt(validImageAnalysis);
    expect(result).toContain('JSON');
  });
});

// ─── checkProhibitedPhrases ─────────────────────────────────────────────────

describe('checkProhibitedPhrases', () => {
  it('금지 표현이 없으면 violations가 빈 배열이다', () => {
    const result = checkProhibitedPhrases('좋은 품질의 제품입니다');
    expect(result.violations).toHaveLength(0);
  });

  it('"감염예방" 을 탐지한다', () => {
    const result = checkProhibitedPhrases('감염예방에 효과적입니다');
    expect(result.violations).toContain('감염예방');
  });

  it('"피부 속" 을 탐지한다', () => {
    const result = checkProhibitedPhrases('피부 속 깊이 침투합니다');
    expect(result.violations).toContain('피부 속');
  });

  it('"선착순" 을 탐지한다', () => {
    const result = checkProhibitedPhrases('선착순 100명 한정 특가');
    expect(result.violations).toContain('선착순');
  });

  it('"감기예방" 을 탐지한다', () => {
    const result = checkProhibitedPhrases('감기예방에 도움이 됩니다');
    expect(result.violations).toContain('감기예방');
  });

  it('여러 금지 표현이 있으면 모두 반환한다', () => {
    const result = checkProhibitedPhrases('감염예방에 효과적이고 피부 속까지 케어됩니다');
    expect(result.violations).toContain('감염예방');
    expect(result.violations).toContain('피부 속');
    expect(result.violations).toHaveLength(2);
  });

  it('금지 표현이 아닌 유사 단어는 탐지하지 않는다', () => {
    const result = checkProhibitedPhrases('감기에 걸리지 않도록 따뜻하게 입으세요');
    expect(result.violations).toHaveLength(0);
  });
});

// ─── buildCategorySystemPrompt ──────────────────────────────────────────────

describe('buildCategorySystemPrompt', () => {
  it('basic 카테고리는 기본 카피라이터 프롬프트를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('basic');
    expect(prompt).toContain('이커머스 상세 페이지 전문 카피라이터');
  });

  it('fashion 카테고리 프롬프트는 착용과 소재 안내를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('fashion');
    expect(prompt).toContain('착용');
    expect(prompt).toContain('소재');
    expect(prompt).toContain('세탁');
  });

  it('living 카테고리 프롬프트는 기능과 인증 안내를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('living');
    expect(prompt).toContain('기능');
    expect(prompt).toContain('인증');
  });

  it('food 카테고리 프롬프트는 원재료와 조리 안내를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('food');
    expect(prompt).toContain('원재료');
    expect(prompt).toContain('조리');
  });

  it('food 카테고리 프롬프트는 의학적 효능 금지 경고를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('food');
    expect(prompt).toContain('의학적 효능');
  });

  it('studioMode=true 면 스튜디오 전문가 페르소나 프롬프트를 사용한다', () => {
    const prompt = buildCategorySystemPrompt('basic', true);
    expect(prompt).toContain('스튜디오 촬영 제품');
  });

  it('studioMode=false(기본값) 면 일반 카피라이터 프롬프트를 사용한다', () => {
    const prompt = buildCategorySystemPrompt('basic', false);
    expect(prompt).not.toContain('스튜디오 촬영 제품');
    expect(prompt).toContain('이커머스 상세 페이지 전문 카피라이터');
  });

  it('category 생략 시 basic 으로 동작한다', () => {
    const withBasic = buildCategorySystemPrompt('basic');
    const withDefault = buildCategorySystemPrompt();
    expect(withDefault).toBe(withBasic);
  });
});
