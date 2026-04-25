import { describe, it, expect } from 'vitest';
import { resolveCoupangFee, COUPANG_DEFAULT_FEE, COUPANG_FEE_MAP } from '@/lib/calculator/coupang-fees';

describe('resolveCoupangFee — empty path 처리', () => {
  it('빈 문자열은 matched=false + 기본값 10.8%', () => {
    const r = resolveCoupangFee('');
    expect(r.matched).toBe(false);
    expect(r.rate).toBe(0.108);
    expect(r.matchedPrefix).toBeNull();
  });
  it('null 입력은 matched=false', () => {
    expect(resolveCoupangFee(null).matched).toBe(false);
  });
  it('undefined 입력은 matched=false', () => {
    expect(resolveCoupangFee(undefined).matched).toBe(false);
  });
  it('COUPANG_DEFAULT_FEE 노출', () => {
    expect(COUPANG_DEFAULT_FEE.rate).toBe(0.108);
    expect(COUPANG_DEFAULT_FEE.categoryName).toBe('기타');
  });
});

describe('resolveCoupangFee — prefix 매칭', () => {
  // 임시 매핑이 비어있는 동안에도 동작 검증을 위해 테스트용 path는 매칭 결과를 직접 비교하지 않고
  // 로직만 검증한다. 실제 매핑은 Task 5에서 채워지고 Task 9에서 회귀 테스트가 추가된다.
  it('prefix와 정확히 일치하는 fullPath는 매칭된다 (fixture 매핑 가정)', () => {
    // COUPANG_FEE_MAP이 비어 있을 동안에는 모두 미매칭. 이 테스트는 Task 5 후 의미를 가짐.
    // 매핑이 채워졌을 때 startsWith가 아닌 segment-aware 매칭을 사용하는지 확인.
    const r = resolveCoupangFee('식품');
    if (COUPANG_FEE_MAP.some((e) => e.prefix === '식품')) {
      expect(r.matched).toBe(true);
    } else {
      expect(r.matched).toBe(false);
    }
  });
  it('prefix 다음 글자가 / 가 아니면 매칭되지 않는다 (회귀 방지)', () => {
    // 가상의 "식품관" 같은 1차 카테고리가 생겨도 prefix "식품"과 잘못 매칭되지 않음
    const r = resolveCoupangFee('식품관/하위');
    expect(r.matchedPrefix).not.toBe('식품');
  });
  it('알 수 없는 1차 카테고리는 matched=false', () => {
    const r = resolveCoupangFee('새로운미지카테고리/하위');
    expect(r.matched).toBe(false);
    expect(r.rate).toBe(0.108);
  });
});
