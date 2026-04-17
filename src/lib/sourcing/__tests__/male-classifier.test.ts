/**
 * male-classifier.test.ts
 * 남성 타겟 분류 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import { classifyMaleTarget } from '../shared/male-classifier';

describe('classifyMaleTarget — 남성 타겟', () => {
  it('낚시 카테고리 + 낚시 키워드: tier = high, bonusScore = 5', () => {
    // '낚시' 카테고리(+30) + '낚시' 강력키워드(+10) = 40점 → high
    const result = classifyMaleTarget('낚시 낚싯대 민물 루어세트', '낚시');
    expect(result.tier).toBe('high');
    expect(result.bonusScore).toBe(5);
    expect(result.isMaleTarget).toBe(true);
    expect(result.label).toBe('🔵 남성');
  });

  it('캠핑 카테고리 + 캠핑 키워드: tier = high', () => {
    // '캠핑' 카테고리(+30) + '캠핑' 강력키워드(+10) = 40점 → high
    const result = classifyMaleTarget('캠핑 텐트 4인용 남성용', '캠핑');
    expect(result.tier).toBe('high');
    expect(result.bonusScore).toBe(5);
  });

  it('남성패션잡화 + 지갑 키워드: tier = mid (15+10=25점)', () => {
    // '남성패션잡화' mid_high 카테고리(+15) + '지갑' 중간 키워드(+10) = 25점 → mid
    const result = classifyMaleTarget('프리미엄 가죽 남성 지갑', '남성패션잡화');
    expect(result.tier).toBe('mid');
    expect(result.bonusScore).toBe(3);
    expect(result.isMaleTarget).toBe(true);
  });

  it('아웃도어 카테고리 + 다용도 키워드: tier = mid, bonusScore = 3', () => {
    // '아웃도어' mid_high(+15) + '다용도' 중간키워드(+5) = 20점 → mid
    const result = classifyMaleTarget('아웃도어 다용도 배낭', '아웃도어');
    expect(result.tier).toBe('mid');
    expect(result.bonusScore).toBe(3);
  });
});

describe('classifyMaleTarget — 여성 타겟', () => {
  it('여성용 키워드: tier = female, bonusScore = 0', () => {
    const result = classifyMaleTarget('여성용 립스틱 틴트 세트', '화장품');
    expect(result.tier).toBe('female');
    expect(result.bonusScore).toBe(0);
    expect(result.isFemaleTarget).toBe(true);
    expect(result.label).toBe('🚫 여성');
  });

  it('엄마 선물 키워드: female', () => {
    const result = classifyMaleTarget('엄마 선물 꽃다발 조화', '생활용품');
    expect(result.tier).toBe('female');
  });
});

describe('classifyMaleTarget — 중립', () => {
  it('일반 생활용품: tier = neutral', () => {
    const result = classifyMaleTarget('스테인리스 텀블러 500ml', '생활용품');
    expect(result.tier).toBe('neutral');
    expect(result.bonusScore).toBe(0);
    expect(result.label).toBe('');
  });
});

describe('classifyMaleTarget — 법적 금지', () => {
  it('위스키 → legalBlocked = true', () => {
    const result = classifyMaleTarget('발렌타인 위스키 선물세트', '주류');
    expect(result.legalBlocked).toBe(true);
  });

  it('에어소프트 → legalBlocked = true', () => {
    const result = classifyMaleTarget('에어소프트건 bb탄 세트', '완구');
    expect(result.legalBlocked).toBe(true);
  });

  it('일반 상품 → legalBlocked = false', () => {
    const result = classifyMaleTarget('캠핑 텐트 4인용', '캠핑');
    expect(result.legalBlocked).toBe(false);
  });
});

describe('classifyMaleTarget — 검토 필요', () => {
  it('전동공구 → needsReview = true', () => {
    const result = classifyMaleTarget('전동공구 드릴 세트', '공구');
    expect(result.needsReview).toBe(true);
  });

  it('프로틴 → needsReview = true', () => {
    const result = classifyMaleTarget('헬스 프로틴 단백질 보충제', '건강식품');
    expect(result.needsReview).toBe(true);
  });

  it('일반 상품 → needsReview = false', () => {
    const result = classifyMaleTarget('스테인리스 텀블러', '생활용품');
    expect(result.needsReview).toBe(false);
  });
});
