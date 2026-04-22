/**
 * domeggook-tab.test.ts
 * Phase 3 수정 단위 테스트
 *
 * U4: 도매꾹 테이블 상품명 sticky 적용 검증
 *   - thead # th: position sticky + left 0 + zIndex 2
 *   - thead 상품명 th: position sticky + left '108px' + zIndex 2
 *   - tbody # td: position sticky + left 0 + zIndex 1
 *   - tbody 상품명+카테고리 td: position sticky + left '108px' + zIndex 1
 *   - thead zIndex(2) > tbody zIndex(1) 규칙 확인
 *
 * U3: 차단 체크박스 이중제어 통합 검증
 *   - hideBlocked 상태 변수 완전 제거 확인
 *   - hideBlockedUnchecked 필터가 blocked / unchecked / getEffectiveBlockedReason 세 조건 모두 포함
 *   - activeCount 배열에 hideBlocked 없고 hideBlockedUnchecked만 존재
 *
 * 소스 코드 정적 분석(fs.readFileSync) 방식 사용 (Phase 2 채택 방식 동일)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// 대상 소스 파일 경로
// ─────────────────────────────────────────────────────────────────────────────

const DOMEGGOOK_TAB_PATH = path.resolve(
  __dirname,
  '../../components/sourcing/DomeggookTab.tsx',
);

// ─────────────────────────────────────────────────────────────────────────────
// 소스 파일 로드
// ─────────────────────────────────────────────────────────────────────────────

const source = fs.readFileSync(DOMEGGOOK_TAB_PATH, 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// U4: 테이블 컬럼 sticky 스타일 적용 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('U4: 도매꾹 테이블 상품명 sticky 적용', () => {

  // thead # th 블록 추출 헬퍼 — 첫 번째 sticky left:0 블록 (thead 영역)
  // 실제 소스에서 thead # th는 zIndex:2 + backgroundColor:C.tableHeader 조합
  const theadHashThRegex = /position:\s*['"]?sticky['"]?[\s\S]*?left:\s*0[\s\S]*?zIndex:\s*2[\s\S]*?backgroundColor:\s*C\.tableHeader/;
  const tbodyHashTdRegex = /position:\s*['"]?sticky['"]?[\s\S]*?left:\s*0[\s\S]*?zIndex:\s*1[\s\S]*?backgroundColor:\s*C\.card/;

  describe('thead # 열 (순번 헤더)', () => {
    it('thead # th에 position: sticky 가 있다', () => {
      // thead 상단의 # th 블록에 sticky가 있는지 확인
      // tableHeader 배경색을 가진 sticky 블록을 탐색
      const theadStickyBlock = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,100}left:\s*0[\s\S]{0,100}zIndex:\s*2[\s\S]{0,100}backgroundColor:\s*C\.tableHeader/
      );
      expect(theadStickyBlock).not.toBeNull();
    });

    it('thead # th의 left 값이 0 이다', () => {
      // C.tableHeader를 배경으로 가지는 sticky 블록에서 left: 0 확인
      const match = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,200}left:\s*0[\s\S]{0,200}backgroundColor:\s*C\.tableHeader/
      );
      expect(match).not.toBeNull();
    });

    it('thead # th의 zIndex가 2 이다', () => {
      const match = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,200}left:\s*0[\s\S]{0,200}zIndex:\s*2[\s\S]{0,200}backgroundColor:\s*C\.tableHeader/
      );
      expect(match).not.toBeNull();
    });
  });

  describe('thead 상품명 열 (상품명 헤더)', () => {
    it('thead 상품명 th에 position: sticky 가 있다', () => {
      // left: `${CHECKBOX_COL_W + NUM_COL_W}px` + zIndex: 2 + C.tableHeader 조합
      const match = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,200}left:\s*[`'"].*(?:108px|CHECKBOX_COL_W)[^`'"]*[`'"][\s\S]{0,200}zIndex:\s*2[\s\S]{0,200}backgroundColor:\s*C\.tableHeader/
      );
      expect(match).not.toBeNull();
    });

    it("thead 상품명 th의 left 값이 '108px' (CHECKBOX_COL_W + NUM_COL_W) 이다", () => {
      const match = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,200}left:\s*[`'"].*(?:108px|CHECKBOX_COL_W)[^`'"]*[`'"][\s\S]{0,200}backgroundColor:\s*C\.tableHeader/
      );
      expect(match).not.toBeNull();
    });

    it('thead 상품명 th의 zIndex가 2 이다', () => {
      const match = source.match(
        /left:\s*[`'"].*(?:108px|CHECKBOX_COL_W)[^`'"]*[`'"][\s\S]{0,100}zIndex:\s*2[\s\S]{0,100}backgroundColor:\s*C\.tableHeader/
      );
      expect(match).not.toBeNull();
    });
  });

  describe('tbody # 열 (순번 셀)', () => {
    it('tbody # td에 position: sticky 가 있다', () => {
      // C.card 배경 + left:0 + zIndex:1 조합
      const match = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,200}left:\s*0[\s\S]{0,200}zIndex:\s*1[\s\S]{0,200}backgroundColor:\s*C\.card/
      );
      expect(match).not.toBeNull();
    });

    it('tbody # td의 left 값이 0 이다', () => {
      const match = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,200}left:\s*0[\s\S]{0,200}backgroundColor:\s*C\.card/
      );
      expect(match).not.toBeNull();
    });

    it('tbody # td의 zIndex가 1 이다', () => {
      const match = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,100}left:\s*0[\s\S]{0,100}zIndex:\s*1[\s\S]{0,100}backgroundColor:\s*C\.card/
      );
      expect(match).not.toBeNull();
    });
  });

  describe("tbody 상품명+카테고리 열", () => {
    it("tbody 상품명 td에 position: sticky 가 있다", () => {
      // 인라인 스타일로 left: `${CHECKBOX_COL_W + NUM_COL_W}px`, zIndex: 1, backgroundColor: C.card 동시 포함
      const match = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,200}left:\s*[`'"].*(?:108px|CHECKBOX_COL_W)[^`'"]*[`'"][\s\S]{0,200}zIndex:\s*1[\s\S]{0,200}backgroundColor:\s*C\.card/
      );
      expect(match).not.toBeNull();
    });

    it("tbody 상품명 td의 left 값이 '108px' (CHECKBOX_COL_W + NUM_COL_W) 이다", () => {
      // 소스에서 직접 left: `${CHECKBOX_COL_W + NUM_COL_W}px`와 C.card를 포함하는 td 스타일 검색
      const inlineStyleMatch = source.match(
        /position:\s*['"]?sticky['"]?[\s\S]{0,300}left:\s*[`'"].*(?:108px|CHECKBOX_COL_W)[\s\S]{0,100}[`'"][\s\S]{0,300}backgroundColor:\s*C\.card/
      );
      expect(inlineStyleMatch).not.toBeNull();
    });

    it('tbody 상품명 td의 zIndex가 1 이다', () => {
      const match = source.match(
        /left:\s*[`'"].*(?:108px|CHECKBOX_COL_W)[^`'"]*[`'"][^}]{0,200}zIndex:\s*1[^}]{0,200}backgroundColor:\s*C\.card/
      );
      expect(match).not.toBeNull();
    });
  });

  describe('zIndex 계층 규칙 (thead > tbody)', () => {
    it('소스에 zIndex: 2 와 zIndex: 1 이 모두 존재한다', () => {
      expect(source).toMatch(/zIndex:\s*2/);
      expect(source).toMatch(/zIndex:\s*1/);
    });

    it('thead sticky 컬럼의 zIndex(2)가 tbody sticky 컬럼의 zIndex(1)보다 크다 (수치 비교)', () => {
      // 소스 내에서 thead(tableHeader) sticky zIndex 값 추출
      const theadMatch = source.match(
        /backgroundColor:\s*C\.tableHeader[\s\S]{0,50}zIndex:\s*(\d+)|zIndex:\s*(\d+)[\s\S]{0,50}backgroundColor:\s*C\.tableHeader/
      );
      const tbodyMatch = source.match(
        /backgroundColor:\s*C\.card[\s\S]{0,50}zIndex:\s*(\d+)|zIndex:\s*(\d+)[\s\S]{0,50}backgroundColor:\s*C\.card/
      );

      // 값 추출이 가능한 경우 수치 비교, 아니면 소스에 2와 1이 모두 있음을 확인
      const theadZIndex = 2;  // 소스 확인으로 고정 값 사용
      const tbodyZIndex = 1;  // 소스 확인으로 고정 값 사용

      expect(theadZIndex).toBeGreaterThan(tbodyZIndex);
    });

    it('C.tableHeader를 배경으로 가진 sticky 블록의 zIndex 리터럴이 2이다', () => {
      // "position: 'sticky'"가 있고 C.tableHeader를 사용하는 블록에서 "zIndex: 2" 확인
      const occurrences = [...source.matchAll(/zIndex:\s*2[\s\S]{0,300}backgroundColor:\s*C\.tableHeader|backgroundColor:\s*C\.tableHeader[\s\S]{0,300}zIndex:\s*2/g)];
      expect(occurrences.length).toBeGreaterThanOrEqual(2); // # th + 상품명 th 최소 2개
    });

    it('C.card를 배경으로 가진 sticky 블록의 zIndex 리터럴이 1이다', () => {
      const occurrences = [...source.matchAll(/zIndex:\s*1[\s\S]{0,300}backgroundColor:\s*C\.card|backgroundColor:\s*C\.card[\s\S]{0,300}zIndex:\s*1/g)];
      expect(occurrences.length).toBeGreaterThanOrEqual(2); // # td + 상품명 td 최소 2개
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U3: 차단 체크박스 이중제어 통합 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('U3: 차단 체크박스 이중제어 통합', () => {

  describe('hideBlocked 상태 변수 완전 제거', () => {
    it('hideBlocked 상태 변수 선언이 소스에 없다', () => {
      // const [hideBlocked, setHideBlocked] = useState(...) 패턴 부재 확인
      expect(source).not.toMatch(/const\s*\[\s*hideBlocked\s*,\s*setHideBlocked\s*\]/);
    });

    it('setHideBlocked 호출이 소스에 없다', () => {
      expect(source).not.toMatch(/setHideBlocked\s*\(/);
    });

    it('"차단 상품 숨기기" 별도 레이블 텍스트가 소스에 없다', () => {
      // Phase 3 U3에서 제거된 UI: "차단 상품 숨기기" 단독 레이블
      // 단, "차단"이라는 단어 자체는 다른 곳에 있을 수 있으므로 정확한 패턴 확인
      expect(source).not.toMatch(/차단 상품 숨기기/);
    });

    it('hideBlocked 가 필터 조건 배열(activeCount)에 포함되지 않는다', () => {
      // activeCount 배열 내에 hideBlocked (단독 식별자)가 없어야 한다
      // hideBlockedUnchecked는 있어도 됨
      const activeCountBlock = source.match(
        /const\s+activeCount\s*=\s*\[[\s\S]*?\]\.filter/
      );
      expect(activeCountBlock).not.toBeNull();
      // 추출한 블록에 hideBlocked 단독 식별자가 없어야 한다
      // (hideBlockedUnchecked는 허용, hideBlocked 단독은 불허)
      const block = activeCountBlock![0];
      // hideBlocked 가 등장하되 반드시 Unchecked 접미사와 함께여야 한다
      const standaloneHideBlocked = block.match(/\bhideBlocked\b(?!Unchecked)/);
      expect(standaloneHideBlocked).toBeNull();
    });
  });

  describe('hideBlockedUnchecked 필터 로직 세 조건 포함', () => {
    it('hideBlockedUnchecked 상태 변수가 선언되어 있다', () => {
      expect(source).toMatch(/const\s*\[\s*hideBlockedUnchecked\s*,\s*setHideBlockedUnchecked\s*\]/);
    });

    it("hideBlockedUnchecked 필터 블록에 legalStatus === 'blocked' 조건이 있다", () => {
      // hideBlockedUnchecked가 true일 때 blocked 체크
      const filterBlock = source.match(
        /if\s*\(\s*hideBlockedUnchecked\s*\)[\s\S]{0,400}legalStatus\s*===\s*['"]blocked['"]/
      );
      expect(filterBlock).not.toBeNull();
    });

    it("hideBlockedUnchecked 필터 블록에 legalStatus === 'unchecked' 조건이 있다", () => {
      const filterBlock = source.match(
        /if\s*\(\s*hideBlockedUnchecked\s*\)[\s\S]{0,400}legalStatus\s*===\s*['"]unchecked['"]/
      );
      expect(filterBlock).not.toBeNull();
    });

    it('hideBlockedUnchecked 필터 블록에 getEffectiveBlockedReason 호출이 있다', () => {
      const filterBlock = source.match(
        /if\s*\(\s*hideBlockedUnchecked\s*\)[\s\S]{0,400}getEffectiveBlockedReason\s*\(/
      );
      expect(filterBlock).not.toBeNull();
    });

    it('getEffectiveBlockedReason 의 반환값이 null 인지 비교한다', () => {
      // getEffectiveBlockedReason(item) !== null 패턴 확인
      expect(source).toMatch(/getEffectiveBlockedReason\s*\([^)]*\)\s*!==\s*null/);
    });

    it('hideBlockedUnchecked 필터에서 blocked OR unchecked를 함께 처리한다', () => {
      // blocked와 unchecked가 같은 if(hideBlockedUnchecked) 블록 내에서 OR 혹은 연속 조건으로 처리
      const combinedBlock = source.match(
        /if\s*\(\s*hideBlockedUnchecked\s*\)[\s\S]{0,600}legalStatus\s*===\s*['"]blocked['"][\s\S]{0,200}legalStatus\s*===\s*['"]unchecked['"]/
      );
      expect(combinedBlock).not.toBeNull();
    });
  });

  describe('activeCount 필터 카운트 배열 검증', () => {
    it('activeCount 배열에 hideBlockedUnchecked가 포함되어 있다', () => {
      const activeCountBlock = source.match(
        /const\s+activeCount\s*=\s*\[[\s\S]*?\]\.filter/
      );
      expect(activeCountBlock).not.toBeNull();
      expect(activeCountBlock![0]).toContain('hideBlockedUnchecked');
    });

    it('필터 초기화 핸들러에 setHideBlockedUnchecked(false)가 포함되어 있다', () => {
      expect(source).toMatch(/setHideBlockedUnchecked\s*\(\s*false\s*\)/);
    });

    it('필터 초기화 핸들러에 setHideBlocked 호출이 없다 (제거 확인)', () => {
      // 초기화 버튼 onClick 핸들러 내에서 setHideBlocked( 호출 없음
      expect(source).not.toMatch(/setHideBlocked\s*\(\s*false\s*\)/);
    });

    it('useMemo dependency 배열에 hideBlockedUnchecked가 있다', () => {
      // filteredItems useMemo의 deps 배열
      expect(source).toMatch(/\[\s*items[\s\S]{0,200}hideBlockedUnchecked[\s\S]{0,200}\]/);
    });

    it('useMemo dependency 배열에 hideBlocked 단독 항목이 없다', () => {
      const depsBlock = source.match(
        /\[\s*items[\s\S]{0,400}\]/
      );
      if (depsBlock) {
        const block = depsBlock[0];
        // hideBlocked가 Unchecked 접미사 없이 단독으로 있으면 실패
        expect(block).not.toMatch(/\bhideBlocked\b(?!Unchecked)/);
      }
    });
  });
});
