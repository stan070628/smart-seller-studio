import { describe, it, expect } from 'vitest';
import { riskyClaimWarnings } from './risky-claims';

/** 섹션 트리 흉내 — 문자열이 어느 깊이에 있든 걸려야 한다 */
const sec = (...texts: string[]) => [
  { title: texts[0], blocks: [{ type: 'text', body: texts[1] ?? '' }] },
];

describe('riskyClaimWarnings', () => {
  it('빈 입력에는 경고가 없다', () => {
    expect(riskyClaimWarnings([])).toEqual([]);
    expect(riskyClaimWarnings(null)).toEqual([]);
  });

  it('실제로 생성됐던 "가품과 갈리는 곳"을 잡는다', () => {
    // 2026-08-02 나이키 다저스 티셔츠에서 AI가 스스로 만든 섹션 제목
    const w = riskyClaimWarnings(sec('가품과 갈리는 곳'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('가품');
  });

  it('"정품 보장"은 잡고 "나이키 정품"은 통과시킨다', () => {
    expect(riskyClaimWarnings(sec('정품 보장'))).toHaveLength(1);
    expect(riskyClaimWarnings(sec('100% 정품'))).toHaveLength(1);

    // 사실 서술은 막지 않는다 — 브랜드 리셀에서 정확한 표현이다
    expect(riskyClaimWarnings(sec('나이키 정품 · MLB 공식 라이선스 제품'))).toEqual([]);
    expect(riskyClaimWarnings(sec('MLB 공식 정품 인증 홀로그램 택 부착'))).toEqual([]);
  });

  it('입증 불가능한 최상급을 잡는다', () => {
    expect(riskyClaimWarnings(sec('국내 최저가'))).toHaveLength(1);
    expect(riskyClaimWarnings(sec('단독 판매 상품'))).toHaveLength(1);
  });

  it('해외 정가를 원화로만 적으면 잡고, 국가·통화를 붙이면 통과시킨다', () => {
    expect(riskyClaimWarnings(sec('정가 55,000원 상품'))).toHaveLength(1);
    expect(riskyClaimWarnings(sec('일본 현지 정가 ¥6,000'))).toEqual([]);
    // 국가명이 붙으면 원화 표기여도 오인 소지가 없다
    expect(riskyClaimWarnings(sec('일본 정가 55,000원'))).toEqual([]);
  });

  it('같은 종류가 여러 번 나와도 경고는 한 줄이다', () => {
    const w = riskyClaimWarnings(sec('가품 주의', '가품과 구별하는 법'));
    expect(w).toHaveLength(1);
  });

  it('중첩 구조 깊은 곳의 문자열도 검사한다', () => {
    const nested = [{ blocks: [{ cols: [[{ items: [{ label: '정품 보장' }] }]] }] }];
    expect(riskyClaimWarnings(nested)).toHaveLength(1);
  });

  it('서로 다른 종류는 각각 경고한다', () => {
    expect(riskyClaimWarnings(sec('가품 없음', '최저가 도전'))).toHaveLength(2);
  });
});
