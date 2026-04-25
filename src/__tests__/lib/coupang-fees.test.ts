import { describe, it, expect } from 'vitest';
import { resolveCoupangFee, COUPANG_DEFAULT_FEE, COUPANG_FEE_MAP, matchesPrefix } from '@/lib/calculator/coupang-fees';

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

describe('matchesPrefix — segment 경계 단위 테스트', () => {
  it('prefix와 정확히 일치하는 fullPath는 매칭된다', () => {
    expect(matchesPrefix('식품', '식품')).toBe(true);
  });
  it('segment 경계 안에서 매칭된다', () => {
    expect(matchesPrefix('식품/과일', '식품')).toBe(true);
  });
  it('prefix 다음 글자가 / 가 아니면 매칭되지 않는다', () => {
    // "식품관" 같은 가상의 1차 카테고리가 prefix "식품"과 잘못 매칭되지 않음
    expect(matchesPrefix('식품관/하위', '식품')).toBe(false);
  });
  it('역방향 prefix(prefix가 더 김)는 매칭되지 않는다', () => {
    expect(matchesPrefix('식품', '식품/과일')).toBe(false);
  });
});

describe('COUPANG_FEE_MAP invariants', () => {
  it('모듈 로드 시 정렬/중복/rate 검증을 통과한다', () => {
    // import 자체가 IIFE assertion을 실행하므로 import가 던지지 않으면 OK
    expect(COUPANG_FEE_MAP).toBeDefined();
  });
});

import { getCoupangCategoryNames } from '@/lib/calculator/coupang-fees';

describe('getCoupangCategoryNames', () => {
  it('중복 제거된 카테고리명 배열을 반환한다', () => {
    const names = getCoupangCategoryNames();
    expect(Array.isArray(names)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('resolveCoupangFee — 정상 매칭 (잠정 매핑)', () => {
  it('식품 카테고리는 6.5%', () => {
    expect(resolveCoupangFee('식품/가공식품/통조림').rate).toBe(0.065);
    expect(resolveCoupangFee('식품/가공식품/통조림').matched).toBe(true);
  });
  it('가전디지털/스마트폰은 4%', () => {
    expect(resolveCoupangFee('가전디지털/스마트폰/갤럭시').rate).toBe(0.04);
  });
  it('가전디지털/생활가전은 7.8%', () => {
    expect(resolveCoupangFee('가전디지털/생활가전/공기청정기').rate).toBe(0.078);
  });
  it('가전디지털만 있을 때 1차 fallback (생활가전 7.8%)', () => {
    expect(resolveCoupangFee('가전디지털').rate).toBe(0.078);
  });
  it('주방용품은 10.8%', () => {
    expect(resolveCoupangFee('주방용품/조리도구/주방잡화').rate).toBe(0.108);
  });
  // 회귀 방지 (이전 정규식 오분류 케이스)
  it('자동차용품 경로에 "차"가 있어도 식품으로 분류되지 않는다', () => {
    const r = resolveCoupangFee('자동차용품/차량용품/방향제');
    expect(r.categoryName).not.toBe('식품');
    expect(r.rate).not.toBe(0.065);
  });
  it('반려동물 사료 경로에 "먹"이 있어도 식품으로 분류되지 않는다', () => {
    const r = resolveCoupangFee('반려동물용품/강아지/먹이');
    expect(r.categoryName).not.toBe('식품');
  });
});

import { getCoupangFeeRateByCategoryName } from '@/lib/calculator/coupang-fees';

describe('getCoupangFeeRateByCategoryName', () => {
  it('등록된 카테고리명은 해당 rate 반환', () => {
    expect(getCoupangFeeRateByCategoryName('식품')).toBe(0.065);
    expect(getCoupangFeeRateByCategoryName('주방용품')).toBe(0.108);
    expect(getCoupangFeeRateByCategoryName('디지털기기')).toBe(0.04);
  });
  it('알 수 없는 카테고리명은 COUPANG_DEFAULT_FEE.rate 반환', () => {
    expect(getCoupangFeeRateByCategoryName('존재하지않음')).toBe(COUPANG_DEFAULT_FEE.rate);
  });
});

import { assertCoupangFeeMapInvariants, type CoupangFeeEntry } from '@/lib/calculator/coupang-fees';

describe('assertCoupangFeeMapInvariants — 위반 fixture', () => {
  it('정렬 위반 (짧은 prefix가 긴 prefix 위) → throw', () => {
    const bad: CoupangFeeEntry[] = [
      { prefix: '식품', rate: 0.065, categoryName: '식품' },
      { prefix: '식품/가공식품', rate: 0.065, categoryName: '식품' },
    ];
    expect(() => assertCoupangFeeMapInvariants(bad)).toThrow(/정렬 위반/);
  });
  it('중복 prefix → throw', () => {
    const bad: CoupangFeeEntry[] = [
      { prefix: '식품', rate: 0.065, categoryName: '식품' },
      { prefix: '식품', rate: 0.065, categoryName: '식품' },
    ];
    // 정렬 위반이 먼저 잡히지만, 동일 메시지 패턴은 둘 다 정렬/중복 메시지 중 하나
    expect(() => assertCoupangFeeMapInvariants(bad)).toThrow();
  });
  it('rate가 0이면 throw', () => {
    const bad: CoupangFeeEntry[] = [{ prefix: '식품', rate: 0, categoryName: '식품' }];
    expect(() => assertCoupangFeeMapInvariants(bad)).toThrow(/rate 범위 위반/);
  });
  it('rate가 1 이상이면 throw', () => {
    const bad: CoupangFeeEntry[] = [{ prefix: '식품', rate: 1.5, categoryName: '식품' }];
    expect(() => assertCoupangFeeMapInvariants(bad)).toThrow(/rate 범위 위반/);
  });
});

describe('getCoupangCategoryNames — dedupe/order 강화', () => {
  it('동일 categoryName이 여러 prefix에 등장해도 1회만 포함', () => {
    const names = getCoupangCategoryNames();
    const uniqueByName = new Set(COUPANG_FEE_MAP.map((e) => e.categoryName));
    expect(names.length).toBe(uniqueByName.size);
  });
  it('등록 순서를 보존한다 (첫 등장 기준)', () => {
    const names = getCoupangCategoryNames();
    const firstSeenOrder: string[] = [];
    const seen = new Set<string>();
    for (const e of COUPANG_FEE_MAP) {
      if (!seen.has(e.categoryName)) {
        seen.add(e.categoryName);
        firstSeenOrder.push(e.categoryName);
      }
    }
    expect(names).toEqual(firstSeenOrder);
  });
});

describe('회귀 — 원본 버그 (카테고리 78780)', () => {
  it('주방용품 fullPath는 6.5%(식품)로 잘못 분류되지 않는다', () => {
    // 카테고리 코드 78780이 매핑되는 fullPath 예시 ("주방용품/조리도구/주방잡화" 등)
    const r = resolveCoupangFee('주방용품/조리도구/주방잡화');
    expect(r.rate).toBe(0.108);
    expect(r.rate).not.toBe(0.065);
    expect(r.categoryName).toBe('주방용품');
    expect(r.matched).toBe(true);
  });

  it('"차"가 path에 있어도 식품으로 매칭되지 않는다 (이전 정규식 버그)', () => {
    const cases = [
      '자동차용품/차량용품/방향제',
      '자동차용품/주차용품',
      '스포츠/레저/자전거',
    ];
    for (const path of cases) {
      const r = resolveCoupangFee(path);
      expect(r.categoryName).not.toBe('식품');
      expect(r.rate).not.toBe(0.065);
    }
  });

  it('"먹"이 path에 있어도 식품으로 매칭되지 않는다 (이전 정규식 버그)', () => {
    const r = resolveCoupangFee('반려동물용품/강아지/먹이');
    expect(r.categoryName).not.toBe('식품');
  });
});

describe('helper contract — name 전용 vs fullPath 전용 분리', () => {
  it('getCoupangFeeRateByCategoryName은 dropdown name 전용 (fullPath를 주면 기본값 반환)', () => {
    // helper는 strict equality로 categoryName을 매칭하므로 fullPath를 받으면 무매치 → 기본값
    expect(getCoupangFeeRateByCategoryName('식품/가공식품/통조림')).toBe(COUPANG_DEFAULT_FEE.rate);
  });
  it('getCoupangFeeRateByCategoryName은 빈 문자열/공백을 안전하게 기본값 처리', () => {
    expect(getCoupangFeeRateByCategoryName('')).toBe(COUPANG_DEFAULT_FEE.rate);
    expect(getCoupangFeeRateByCategoryName('  ')).toBe(COUPANG_DEFAULT_FEE.rate);
  });
  it('resolveCoupangFee는 fullPath 전용 (dropdown name 만 주면 정확 매칭으로만 통과)', () => {
    // "식품" 자체는 매핑된 prefix와 정확히 일치하므로 매칭됨 (좋은 동작)
    expect(resolveCoupangFee('식품').matched).toBe(true);
    // "디지털기기"는 categoryName이지만 prefix가 아니므로 미매칭
    expect(resolveCoupangFee('디지털기기').matched).toBe(false);
  });
});
