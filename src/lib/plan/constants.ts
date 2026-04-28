// PlanClient.tsx에서 추출 — 대시보드와 플랜 페이지 양쪽에서 사용
//
// 전략 v2 (2026-04-27) 기준 12주 로드맵
// 근거: docs/superpowers/specs/2026-04-27-seller-strategy-v2-design.md
// 채널: 쿠팡 로켓그로스(50%) + 쿠팡 일반판매(25%) + 네이버 스마트스토어(25%)
// 소싱: Week 1~3 도매꾹 위탁 → Week 4+ 1688 직사입 단계적 전환

export interface WbsTask {
  id: string;
  text: string;
}

export interface WeekData {
  title: string;
  goal: string;
  revenueTarget: string;
  tasks: WbsTask[];
}

export const WBS_DATA: Record<number, WeekData> = {
  1: {
    title: '셋업 + 키워드 발굴',
    goal: '도매꾹 SKU 80~100개 선별 + 3채널 계정 셋업',
    revenueTarget: '셋업',
    tasks: [
      { id: 'w1-1', text: '회피 리스트 자동 필터 적용된 도매꾹 시드 키워드 30개 발굴 (월 검색 3,000~30,000 / 경쟁상품 500개 미만)' },
      { id: 'w1-2', text: '도매꾹 SKU 80~100개 선별 (마진 30%↑, 위탁 가능, 부피 50cm 이하)' },
      { id: 'w1-3', text: '사업자등록증 발급 / 네이버 스마트스토어 가입 / 쿠팡 윙 가입 (3채널 셋업)' },
      { id: 'w1-4', text: '쿠팡 로켓그로스 진입 조건 확인 + 입점 신청' },
      { id: 'w1-5', text: '네이버 검색광고 / 쿠팡 윙 광고 계정 세팅' },
      { id: 'w1-6', text: 'CS 자동 응답 메시지 사전 작성 (3채널 별도)' },
      { id: 'w1-7', text: 'SmartSellerStudio /sourcing 워크플로우 숙지 (도매꾹/니치/마진계산기)' },
    ],
  },
  2: {
    title: '3채널 동시 등록 + 광고 시작',
    goal: '80~100 SKU 등록 완료, 첫 매출 발생',
    revenueTarget: '50만원 (누적)',
    tasks: [
      { id: 'w2-1', text: '쿠팡 일반판매(셀러관리)에 80~100 SKU 등록' },
      { id: 'w2-2', text: '네이버 스마트스토어에 동일 SKU 등록 (3채널 동시 노출)' },
      { id: 'w2-3', text: '쿠팡 로켓그로스 우선 등록 가능 SKU 분류 (Week 6 그로스 전환 후보)' },
      { id: 'w2-4', text: 'AI 상세페이지 일괄 생성 (Step3 워크플로우)' },
      { id: 'w2-5', text: '광고 일 1만원/채널 시작 (3채널 합계 일 3만원)' },
      { id: 'w2-6', text: '첫 가격: 경쟁자 최저가 -5~10%' },
      { id: 'w2-7', text: '지인 5명 구매 부탁 → 첫 리뷰 5개 확보' },
    ],
  },
  3: {
    title: '위너 후보 선별',
    goal: '데이터 기반 하위 30% 교체 + 위너 후보 10개 선별',
    revenueTarget: '150만원 (누적)',
    tasks: [
      { id: 'w3-1', text: '채널별 클릭/노출/CTR 데이터 누적 분석' },
      { id: 'w3-2', text: 'CTR 1% 미만 상품 타이틀/대표 이미지 교체' },
      { id: 'w3-3', text: '전환율 1.5% 미만 상품 가격/상세페이지 보정' },
      { id: 'w3-4', text: '하위 30% 상품 즉시 도매꾹 신규 키워드로 교체' },
      { id: 'w3-5', text: '위너 후보 10개 선별 (누적 클릭 100+, 광고 ROAS 250%+, 판매 5건+)' },
      { id: 'w3-6', text: '광고 일 1.5만원/채널로 증액 (3채널 합계 일 4.5만원)' },
      { id: 'w3-7', text: '도매꾹 신규 시드 키워드 30개 발굴 (Week 4 추가 등록 대비)' },
    ],
  },
  4: {
    title: '1688 첫 발주',
    goal: '위너 5~10개 확정 + 1688 사입 시작',
    revenueTarget: '300만원 (누적)',
    tasks: [
      { id: 'w4-1', text: '2주 누적 데이터로 위너 TOP 5~10 확정 (전환율 1.5%↑, ROAS 250%↑, 리뷰 1+)' },
      { id: 'w4-2', text: '/sourcing/trademark-precheck로 위너 후보 KIPRIS 등록상표 사전 검사' },
      { id: 'w4-3', text: '/sourcing/margin-calculator로 위탁 vs 1688 사입 마진 비교 + 전환 임계값 확인' },
      { id: 'w4-4', text: '통과한 위너 5~10개 1688 첫 발주 (개당 50~100개 소량 테스트)' },
      { id: 'w4-5', text: '도매꾹 신규 키워드 30개 추가 등록 (총 110~130 SKU)' },
      { id: 'w4-6', text: '광고 일 2만원/채널로 증액 (3채널 합계 일 6만원, 누적 자본 광고비 약 94만원)' },
      { id: 'w4-7', text: '위너 상세페이지 전면 리뉴얼 (사입 발주분 도착 시 재사용)' },
    ],
  },
  5: {
    title: '1688 입고 + 검수',
    goal: '사입 입고 + KC/상표권 검수 + 로켓그로스 입고 신청',
    revenueTarget: '400만원 (누적)',
    tasks: [
      { id: 'w5-1', text: '1688 발주 입고 진행 (한국 도착 + 통관)' },
      { id: 'w5-2', text: '/sourcing/inbound-checklist로 SKU별 입고 체크리스트 PDF 출력 + 검수' },
      { id: 'w5-3', text: '포장/사이즈/바코드 3편 영상 기준 자체 검수 (회송 회피)' },
      { id: 'w5-4', text: 'KC 인증 필요 항목 사전 확인 (해당 시 인증 진행)' },
      { id: 'w5-5', text: '로켓그로스 입고 신청 + 라벨/박스 적용' },
      { id: 'w5-6', text: '광고 일 2.5만원/채널 (3채널 합계 일 7.5만원)' },
      { id: 'w5-7', text: '/sourcing/margin-calculator로 실제 사입 마진 재검증' },
    ],
  },
  6: {
    title: '로켓그로스 활성화',
    goal: '그로스 첫 매출 + 위너 광고 집중',
    revenueTarget: '550만원 (누적)',
    tasks: [
      { id: 'w6-1', text: '쿠팡 로켓그로스 첫 매출 발생 확인' },
      { id: 'w6-2', text: '광고 위너 집중 → 일 5만원/채널 (위너 전용)' },
      { id: 'w6-3', text: '일반판매(셀러관리) → 그로스로 전환 (위너 한정)' },
      { id: 'w6-4', text: 'ROAS 200% 미만 비위너 채널 광고 예산 30% 삭감' },
      { id: 'w6-5', text: '리뷰 5+ 위너 확보' },
      { id: 'w6-6', text: '광고 일 3만원/채널 (3채널 합계 일 9만원, 누적 자본 광고비 약 210만원)' },
    ],
  },
  7: {
    title: '광고 자체조달 + 2차 사입',
    goal: '매출 마진 광고비 재투자 시작 + 위너 추가 사입',
    revenueTarget: '700만원 (누적)',
    tasks: [
      { id: 'w7-1', text: '자본 광고비 한도 250만원 도달 → 매출 마진 50% 광고 재투자 시작' },
      { id: 'w7-2', text: '그로스 매출 본격화 (일 평균 10만원 이상 안정)' },
      { id: 'w7-3', text: '네이버 광고 ROAS 300%+ 위너 광고 비중 추가 확대' },
      { id: 'w7-4', text: '2차 사입 발주 (위너 추가 100~200개)' },
      { id: 'w7-5', text: '/sourcing/trademark-precheck로 신규 위너 사전 검사' },
      { id: 'w7-6', text: '광고 일 4만원/채널 (3채널 합계 일 12만원)' },
    ],
  },
  8: {
    title: 'CS 자동화 + 시드 사이클',
    goal: '리뷰 시스템 + 다음 분기 시드 키워드',
    revenueTarget: '800만원 (누적)',
    tasks: [
      { id: 'w8-1', text: '포토리뷰 적립 이벤트 시작 (3채널 동시)' },
      { id: 'w8-2', text: 'CS 자동 응답 패턴 정교화 (자주 묻는 질문 5종)' },
      { id: 'w8-3', text: '광고 ROAS 350%+ 위너 광고 2배 확대' },
      { id: 'w8-4', text: '/sourcing/margin-calculator 위탁 vs 사입 비교 → 사입 전환 추가 결정' },
      { id: 'w8-5', text: '신규 시드 키워드 사이클 시작 (다음 분기 준비)' },
      { id: 'w8-6', text: '광고 일 5만원/채널 (3채널 합계 일 15만원)' },
    ],
  },
  9: {
    title: '인접 영역 SKU 확장',
    goal: '신규 30 SKU 등록 + 2차 입고',
    revenueTarget: '870만원 (누적)',
    tasks: [
      { id: 'w9-1', text: '위너 카테고리 인접 영역 신규 SKU 30개 발굴' },
      { id: 'w9-2', text: '도매꾹 일괄 등록 → 3채널 동시 노출' },
      { id: 'w9-3', text: '2차 사입 입고 + /sourcing/inbound-checklist 검수' },
      { id: 'w9-4', text: '신규 SKU 광고 일 1만원/채널로 데이터 수집 시작' },
      { id: 'w9-5', text: '위너 광고 ROAS 유지 + 일 5만원/채널 지속' },
    ],
  },
  10: {
    title: '스케일 사입',
    goal: '위너 대량 사입 + 단일 SKU 일매출 30만원',
    revenueTarget: '920만원 (누적)',
    tasks: [
      { id: 'w10-1', text: '위너 검증 통과 SKU 스케일 사입 (개당 200~300개)' },
      { id: 'w10-2', text: '광고 위너 집중 → 일 7~10만원/채널' },
      { id: 'w10-3', text: '단일 SKU 일매출 30만원 달성 위너 확보' },
      { id: 'w10-4', text: '리뷰 100+ 위너 만들기 (포토리뷰 이벤트 강화)' },
      { id: 'w10-5', text: '재고 회전 관리 (안전재고 30일분 유지)' },
    ],
  },
  11: {
    title: '기획전 + SEO',
    goal: '리뷰 100+ 위너 5개 확보',
    revenueTarget: '970만원 (누적)',
    tasks: [
      { id: 'w11-1', text: '쿠팡 기획전 / 쿠폰 행사 참여 신청' },
      { id: 'w11-2', text: '네이버 검색 SEO 최적화 (상품명 키워드 재배치)' },
      { id: 'w11-3', text: '리뷰 100+ 위너 5개 확보' },
      { id: 'w11-4', text: '광고 ROAS 기반 예산 최대 투입' },
      { id: 'w11-5', text: '쿠팡 윙 카테고리 평점 4.5+ 유지' },
    ],
  },
  12: {
    title: '목표 달성 + 다음 분기 준비',
    goal: '월 1,000만원 달성 + 다음 12주 시드',
    revenueTarget: '1,000만원',
    tasks: [
      { id: 'w12-1', text: '월매출 1,000만원 달성 확인 (3채널 합계)' },
      { id: 'w12-2', text: '누적 마진 분석 + 채널별 ROI 회고' },
      { id: 'w12-3', text: '다음 분기 시드 키워드 60개 미리 발굴' },
      { id: 'w12-4', text: '부족했던 점 retrospective 작성 (회송/CS/광고 등)' },
      { id: 'w12-5', text: '다음 12주 spec v3 초안 작성 (확장 또는 수직 깊이)' },
    ],
  },
};

// 주차별 누적 매출 목표 (만원) — 전략 v2 §3 매출 곡선
export const WEEKLY_TARGETS: readonly number[] = [0, 50, 150, 300, 400, 550, 700, 800, 870, 920, 970, 1000];

// 플랜 시작일 — 전략 v2 시작
export const PLAN_START = new Date('2026-04-27T00:00:00+09:00');
