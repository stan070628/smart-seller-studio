// PlanClient.tsx에서 추출 — 대시보드와 플랜 페이지 양쪽에서 사용

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
    title: '기반 세팅',
    goal: '100개 상품 등록, 첫 판매 발생',
    revenueTarget: '50만원',
    tasks: [
      { id: 'w1-1', text: '아이템스카우트(itemscout.io) 가입 및 사용법 숙지' },
      { id: 'w1-2', text: '틈새 키워드 발굴 — 월 검색량 1,000 이상 / 경쟁상품수 검색량의 5배 미만 / 상위 리뷰 100개 미만' },
      { id: 'w1-3', text: '발굴 키워드 30개 목록 작성' },
      { id: 'w1-4', text: '도매꾹 위 키워드 매칭 상품 100개 선별 (마진 30% 이상 / 위탁 가능 / 배송 3일 이내)' },
      { id: 'w1-5', text: '코스트코 주말 방문: 온라인 미출시 상품 10개 스캔 (경쟁 셀러 3개 미만)' },
      { id: 'w1-6', text: 'Smart Seller Studio 도매꾹 대량 등록 기능 완성 (타이틀/카테고리/이미지/가격 자동 입력)' },
      { id: 'w1-7', text: '스마트스토어 소개/로고/배너 정비' },
      { id: 'w1-8', text: 'CS 자동 응답 메시지 설정' },
    ],
  },
  2: {
    title: '첫 판매 달성',
    goal: '100개 등록, 광고 시작',
    revenueTarget: '100만원',
    tasks: [
      { id: 'w2-1', text: 'Smart Seller Studio로 스마트스토어에 50개 등록' },
      { id: 'w2-2', text: '나머지 50개 추가 등록 (총 100개)' },
      { id: 'w2-3', text: '각 상품 AI 상세페이지 생성 (Step3 활용)' },
      { id: 'w2-4', text: '상품 타이틀 키워드 최적화 (메인+세부키워드)' },
      { id: 'w2-5', text: '네이버 검색광고 계정 세팅' },
      { id: 'w2-6', text: '쇼핑 키워드 광고 캠페인 생성 (일 3만원, 키워드 10개)' },
      { id: 'w2-7', text: '쿠팡 스폰서드 프로덕트 5개 (일 1만원)' },
      { id: 'w2-8', text: '첫 2주 가격: 경쟁자 최저가보다 5~10% 저렴하게' },
      { id: 'w2-9', text: '지인/가족 5명 구매 부탁 → 첫 리뷰 5개 확보' },
    ],
  },
  3: {
    title: '위너 발굴 1',
    goal: '팔리는 상품 TOP 5 발굴',
    revenueTarget: '200만원',
    tasks: [
      { id: 'w3-1', text: '상품별 CTR 확인 → 1% 미만 상품 타이틀/이미지 교체' },
      { id: 'w3-2', text: '전환율 확인 → 클릭 있는데 구매 없는 상품 가격/상세페이지 수정' },
      { id: 'w3-3', text: '광고 ROAS 계산 (목표 300% 이상)' },
      { id: 'w3-4', text: '성과 하위 30개 상품 새 키워드 상품으로 교체' },
      { id: 'w3-5', text: '추가 50개 등록 (총 150개)' },
      { id: 'w3-6', text: '새 카테고리 1개 탐색' },
      { id: 'w3-7', text: '구매자 리뷰 요청 메시지 발송' },
      { id: 'w3-8', text: '상품별 리뷰 5개 이상 확보 목표' },
    ],
  },
  4: {
    title: '위너 발굴 2',
    goal: '위너 상품 5개 확정, 사입 준비',
    revenueTarget: '300만원',
    tasks: [
      { id: 'w4-1', text: '2주 누적 데이터로 판매량 TOP 5 상품 선정' },
      { id: 'w4-2', text: 'TOP 5 기준: 2주 내 3건 이상 / ROAS 300% 이상 / 리뷰 3개 이상' },
      { id: 'w4-3', text: 'TOP 5 광고 예산 2배 확대' },
      { id: 'w4-4', text: 'TOP 5 상세페이지 전면 리뉴얼' },
      { id: 'w4-5', text: 'TOP 5 쿠팡에도 등록' },
      { id: 'w4-6', text: '사입 시 마진 30% 이상 상품 파악' },
      { id: 'w4-7', text: '소량 테스트 사입 결정 (10~20개)' },
    ],
  },
  5: {
    title: '사입 실행',
    goal: '사입 시작, 마진 개선',
    revenueTarget: '400만원',
    tasks: [
      { id: 'w5-1', text: 'TOP 3 상품 사입 발주 (예산 100만원)' },
      { id: 'w5-2', text: '사입 상품 스마트스토어 재등록 (직접 배송 강조)' },
      { id: 'w5-3', text: '사입 상품 쿠팡 로켓그로스 등록 시도' },
      { id: 'w5-4', text: '스마트스토어 광고 일 예산 5만원으로 증액' },
      { id: 'w5-5', text: '쿠팡 광고 사입 상품 중심 일 3만원' },
      { id: 'w5-6', text: '스마트스토어 플러스 스토어 지원 조건 확인' },
      { id: 'w5-7', text: '리뷰 20개 이상 확보' },
    ],
  },
  6: {
    title: '사입 스케일',
    goal: '월 300만원 페이스',
    revenueTarget: '500만원',
    tasks: [
      { id: 'w6-1', text: '사입 상품 vs 위탁 마진 비교 분석' },
      { id: 'w6-2', text: '실패 사입 상품 즉시 가격 인하 or 재판매' },
      { id: 'w6-3', text: '위탁 중 꾸준한 상품 추가 사입 검토' },
      { id: 'w6-4', text: '번들 구성 (TOP 상품 + 관련 상품 세트)' },
      { id: 'w6-5', text: '번들로 객단가 20~30% 상승 목표' },
    ],
  },
  7: {
    title: '채널 다변화',
    goal: '월 500만원 달성',
    revenueTarget: '600만원',
    tasks: [
      { id: 'w7-1', text: '도매토피아 / 오너클랜 / 1688.com 탐색' },
      { id: 'w7-2', text: '코스트코 주말 2회 방문 → 추가 틈새 상품 발굴' },
      { id: 'w7-3', text: '계절 상품 / 특정 취미 상품 조사' },
      { id: 'w7-4', text: '위탁 상품 총 200개 이상 등록 유지' },
    ],
  },
  8: {
    title: '광고 최적화',
    goal: '월 500~600만원',
    revenueTarget: '700만원',
    tasks: [
      { id: 'w8-1', text: '광고 ROAS 300% 이상 확인 후 예산 확대' },
      { id: 'w8-2', text: '사입 상품 재고 회전 확인 (재발주 타이밍)' },
      { id: 'w8-3', text: '실패 상품 정리 → 예산 위너에 집중' },
    ],
  },
  9: {
    title: '공격적 확장',
    goal: '월 700만원',
    revenueTarget: '800만원',
    tasks: [
      { id: 'w9-1', text: '광고비 일 10만원으로 확대 (ROAS 300% 이상 확인 후)' },
      { id: 'w9-2', text: '카카오쇼핑 채널 등록' },
      { id: 'w9-3', text: '인스타그램 쇼핑 연동' },
      { id: 'w9-4', text: '11번가 / 위메프 추가 등록' },
      { id: 'w9-5', text: '검증 위너 추가 사입 (예산 50만원)' },
      { id: 'w9-6', text: '5~6월 시즌 상품 소싱' },
    ],
  },
  10: {
    title: '스케일업 중',
    goal: '월 800만원',
    revenueTarget: '900만원',
    tasks: [
      { id: 'w10-1', text: '일 매출 25만원 이상 안정적 발생 확인' },
      { id: 'w10-2', text: '리뷰 50개 이상 확보' },
      { id: 'w10-3', text: '스마트스토어 기획전 참여 신청' },
    ],
  },
  11: {
    title: '최종 스케일',
    goal: '월 900만원',
    revenueTarget: '950만원',
    tasks: [
      { id: 'w11-1', text: '광고 ROAS 기반 예산 최대 투입' },
      { id: 'w11-2', text: '쿠팡 로켓그로스 추가 상품 입고' },
      { id: 'w11-3', text: 'Smart Seller Studio 상품 등록 완전 자동화 완성' },
    ],
  },
  12: {
    title: '목표 달성',
    goal: '월 1,000만원',
    revenueTarget: '1,000만원',
    tasks: [
      { id: 'w12-1', text: '반품/교환 처리 프로세스 문서화' },
      { id: 'w12-2', text: '재고 회전 관리 시스템 구축' },
      { id: 'w12-3', text: '다음 달 소싱 계획 수립' },
      { id: 'w12-4', text: '월 매출 1,000만원 달성 확인' },
    ],
  },
};

// 주차별 누적 매출 목표 (만원)
export const WEEKLY_TARGETS: readonly number[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000];

// 플랜 시작일 (고정)
export const PLAN_START = new Date('2026-04-22T00:00:00+09:00');
