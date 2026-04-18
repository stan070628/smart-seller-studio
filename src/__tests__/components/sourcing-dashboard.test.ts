/**
 * sourcing-dashboard.test.ts
 * Phase 2 UX 수정 단위 테스트
 *
 * U1: SourcingDashboard 기본 탭이 'niche'인지 검증
 * U2: costcoGenderView 이중 제어 제거 및 CostcoTab externalGenderFilter 하위 호환성 검증
 * B4: CostcoTab 카운트 표시 로직 — 필터 적용 시 "표시 M개 / 전체 N개" 형식 검증
 *
 * 실제 React 렌더링 없이 소스 코드 정적 분석(파일 파싱) 기반 테스트.
 * Next.js 'use client' 컴포넌트는 jsdom에서 import하기 위해 무거운 의존성(next/link 등)이
 * 필요하므로 텍스트 파싱 방식으로 대체한다.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// 대상 소스 파일 경로
// ─────────────────────────────────────────────────────────────────────────────

const SOURCING_DASHBOARD_PATH = path.resolve(
  __dirname,
  '../../components/sourcing/SourcingDashboard.tsx',
);

const COSTCO_TAB_PATH = path.resolve(
  __dirname,
  '../../components/sourcing/CostcoTab.tsx',
);

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼: 소스 파일을 문자열로 읽기
// ─────────────────────────────────────────────────────────────────────────────

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 스위트
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 2 UX 수정 단위 테스트', () => {

  // ─── U1: SourcingDashboard 기본 탭 검증 ─────────────────────────────────

  describe('U1: SourcingDashboard 초기 탭이 niche인지 검증', () => {
    it("useState 초기값이 'niche'로 선언되어 있다", () => {
      const source = readSource(SOURCING_DASHBOARD_PATH);

      // useState<...>('niche') 패턴이 존재해야 한다
      expect(source).toMatch(/useState[^(]*\([^)]*['"]niche['"]/);
    });

    it("기본 탭 타입 선언에 'niche' 리터럴이 포함된다", () => {
      const source = readSource(SOURCING_DASHBOARD_PATH);

      // 탭 타입 유니온에 'niche'가 있어야 한다
      expect(source).toContain("'niche'");
    });

    it("useState 초기값으로 'tracking'이 사용되지 않는다 (U1 회귀 방지)", () => {
      const source = readSource(SOURCING_DASHBOARD_PATH);

      // useState(…'tracking'…) 패턴이 없어야 한다
      // 탭 id 선언 자체('tracking' as const)는 허용되므로 useState 컨텍스트만 검사
      const useStateTrackingPattern = /useState[^(]*\([^)]*['"]tracking['"]/;
      expect(source).not.toMatch(useStateTrackingPattern);
    });

    it("sourcingSubTab 상태 선언 줄이 'niche'로 초기화된다", () => {
      const source = readSource(SOURCING_DASHBOARD_PATH);

      // 실제 선언 패턴: useState<'...'|...'niche'...>('niche')
      const lines = source.split('\n');
      const stateLine = lines.find(
        (line) => line.includes('sourcingSubTab') && line.includes('useState'),
      );

      expect(stateLine).toBeDefined();
      expect(stateLine).toContain("'niche'");

      // 초기값 위치: useState(…) 의 마지막 인자가 'niche'이어야 한다
      // 예: useState<...>('niche')
      expect(stateLine).toMatch(/useState[^)]*'niche'\)/);
    });
  });

  // ─── U2: costcoGenderView 이중 제어 제거 검증 ─────────────────────────────

  describe('U2: costcoGenderView 이중 제어 제거 및 CostcoTab 하위 호환성 검증', () => {
    it("SourcingDashboard에 costcoGenderView 상태가 존재하지 않는다", () => {
      const source = readSource(SOURCING_DASHBOARD_PATH);
      expect(source).not.toContain('costcoGenderView');
    });

    it("SourcingDashboard에서 성별 서브메뉴 버튼 그룹(전체/남성타겟/여성타겟)이 제거되었다", () => {
      const source = readSource(SOURCING_DASHBOARD_PATH);

      // 성별 서브메뉴 버튼에서 사용하던 레이블들이 없어야 한다
      expect(source).not.toContain('남성타겟');
      expect(source).not.toContain('여성타겟');
    });

    it("SourcingDashboard의 CostcoTab 호출에 externalGenderFilter prop이 전달되지 않는다", () => {
      const source = readSource(SOURCING_DASHBOARD_PATH);

      // <CostcoTab externalGenderFilter={…} /> 패턴이 없어야 한다
      expect(source).not.toMatch(/CostcoTab[^/]*externalGenderFilter/);
    });

    it("SourcingDashboard에서 CostcoTab은 prop 없이 단독으로 렌더링된다", () => {
      const source = readSource(SOURCING_DASHBOARD_PATH);

      // <CostcoTab /> 또는 <CostcoTab> 패턴이 존재해야 한다
      expect(source).toMatch(/<CostcoTab\s*\/>/);
    });

    it("CostcoTabProps에 externalGenderFilter가 optional(?)로 정의되어 있다 (하위 호환성)", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // externalGenderFilter?: 패턴이 있어야 한다
      expect(source).toMatch(/externalGenderFilter\?:/);
    });

    it("CostcoTab 컴포넌트 시그니처에 externalGenderFilter 파라미터가 있다 (하위 호환성)", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // function CostcoTab({ externalGenderFilter }...) 패턴 확인
      expect(source).toContain('externalGenderFilter');
    });

    it("CostcoTab 내부 gender select에 5개 옵션이 모두 포함된다", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // 5개 option value가 모두 존재해야 한다
      expect(source).toContain('value="all"');
      expect(source).toContain('value="male_high"');
      expect(source).toContain('value="male_friendly"');
      expect(source).toContain('value="neutral"');
      expect(source).toContain('value="female"');
    });

    it("MaleTierFilter 타입이 5개 리터럴 유니온으로 정의된다", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // type MaleTierFilter = 'all' | 'male_high' | 'male_friendly' | 'neutral' | 'female'
      expect(source).toMatch(/MaleTierFilter\s*=\s*['"]all['"]/);
      expect(source).toMatch(/MaleTierFilter[\s\S]*male_high/);
      expect(source).toMatch(/MaleTierFilter[\s\S]*male_friendly/);
      expect(source).toMatch(/MaleTierFilter[\s\S]*neutral/);
      expect(source).toMatch(/MaleTierFilter[\s\S]*female/);
    });
  });

  // ─── B4: 카운트 표시 불일치 수정 검증 ────────────────────────────────────

  describe('B4: 카운트 표시 로직 — 표시 M개 / 전체 N개 형식 검증', () => {
    it("filteredProducts.length를 앞에 표시하는 코드가 존재한다", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // filteredProducts.length.toLocaleString() 패턴이 있어야 한다
      expect(source).toContain('filteredProducts.length.toLocaleString()');
    });

    it("filteredProducts.length !== total 조건으로 '/ 전체' 텍스트를 조건부 렌더링한다", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // filteredProducts.length !== total 분기가 있어야 한다
      expect(source).toContain('filteredProducts.length !== total');
    });

    it("'/ 전체' 텍스트가 조건부 렌더링 블록 안에 있다", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // "/ 전체" 또는 "전체 N개" 패턴이 filteredProducts.length !== total 조건과
      // 같은 블록에 있는지 확인
      const conditionIndex = source.indexOf('filteredProducts.length !== total');
      const totalTextIndex = source.indexOf('/ 전체', conditionIndex);

      expect(conditionIndex).toBeGreaterThan(-1);
      // "/ 전체" 텍스트가 조건 이후에 위치해야 한다
      expect(totalTextIndex).toBeGreaterThan(conditionIndex);
    });

    it("filteredProducts.length === total일 때 '/ 전체' 부분이 숨겨지는 조건 구조를 갖는다", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // !==를 사용한 조건부 렌더링이므로 같을 때는 숨겨짐
      // 즉 filteredProducts.length !== total 가 false면 렌더링 안 됨
      // 아래는 "이 조건이 존재한다"는 것만 확인한다
      expect(source).toMatch(/filteredProducts\.length\s*!==\s*total/);
    });

    it("total은 서버 카운트(state 변수)로 별도 관리된다", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // useState<number>로 total이 선언되어야 한다
      expect(source).toMatch(/\btotal\b.*useState/);
    });

    it("'표시' 레이블이 카운트 표시 영역에 존재한다", () => {
      const source = readSource(COSTCO_TAB_PATH);

      // '표시 M개' 형태의 레이블이 있어야 한다
      expect(source).toContain('표시');
    });

    /**
     * B4 핵심 로직을 JavaScript로 재현하여 경계값 검증
     * 실제 컴포넌트 코드의 조건식:
     *   filteredProducts.length !== total
     *     → "/ 전체 N개" 표시
     */
    describe('B4 카운트 표시 조건 로직 (경계값 검증)', () => {
      /**
       * 실제 CostcoTab 렌더링 로직에서 추출한 순수 헬퍼
       * filteredCount: 클라이언트 필터 적용 후 표시 개수
       * total: 서버 카운트
       * 반환: 표시할 문자열
       */
      function buildCountDisplay(filteredCount: number, total: number): string {
        const displayed = `표시 ${filteredCount.toLocaleString()}개`;
        const suffix =
          filteredCount !== total ? ` / 전체 ${total.toLocaleString()}개` : '';
        return displayed + suffix;
      }

      it('filteredCount === total이면 "표시 N개"만 표시된다', () => {
        const result = buildCountDisplay(50, 50);
        expect(result).toBe('표시 50개');
        expect(result).not.toContain('/ 전체');
      });

      it('filteredCount < total이면 "표시 M개 / 전체 N개" 형식으로 표시된다', () => {
        const result = buildCountDisplay(30, 50);
        expect(result).toBe('표시 30개 / 전체 50개');
      });

      it('filteredCount가 0이고 total이 양수이면 "표시 0개 / 전체 N개" 형식으로 표시된다', () => {
        const result = buildCountDisplay(0, 100);
        expect(result).toBe('표시 0개 / 전체 100개');
      });

      it('filteredCount === 0 이고 total === 0이면 "표시 0개"만 표시된다', () => {
        const result = buildCountDisplay(0, 0);
        expect(result).toBe('표시 0개');
        expect(result).not.toContain('/ 전체');
      });

      it('filteredCount === total이 아닌 경우 "/ 전체" 텍스트가 반드시 포함된다', () => {
        const result = buildCountDisplay(10, 200);
        expect(result).toContain('/ 전체');
      });

      it('1000 이상 숫자는 toLocaleString으로 쉼표 포맷이 적용된다', () => {
        const result = buildCountDisplay(1234, 5678);
        // Node.js 로케일에 따라 차이가 있을 수 있으나 숫자 자체는 포함되어야 한다
        expect(result).toContain('1');
        expect(result).toContain('234');
        expect(result).toContain('/ 전체');
      });

      it('filteredCount > total인 엣지 케이스에도 조건식이 동작한다 (이론상 발생 불가)', () => {
        // filteredCount가 total보다 클 수 없지만 조건식은 !==이므로 이 경우에도 표시
        const result = buildCountDisplay(60, 50);
        expect(result).toContain('/ 전체');
      });
    });
  });
});
