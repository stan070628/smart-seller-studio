/**
 * 로켓배송 비진출 가능성이 높은 카테고리별 시드 키워드 상수
 * 니치 키워드 탐색의 출발점으로 사용
 */

// 대형가전 / 업소용 가전 — 부피·중량으로 쿠팡 물류 처리 어려움
export const SEED_KEYWORDS_LARGE_APPLIANCES: string[] = [
  '업소용 냉장고',
  '업소용 제빙기',
  '업소용 냉동고',
  '산업용 건조기',
  '업소용 식기세척기',
  '업소용 진열냉장고',
  '업소용 쇼케이스',
  '업소용 냉동쇼케이스',
  '업소용 에어컨',
  '산업용 에어컨',
  '업소용 냉각기',
  '업소용 온수기',
  '업소용 보일러',
  '산업용 냉각탑',
  '업소용 냉각수조',
];

// 가구 / 대형 인테리어 — 배송 비용과 설치 문제로 로켓 불리
export const SEED_KEYWORDS_FURNITURE: string[] = [
  '업소용 테이블',
  '산업용 선반',
  '대형 캐비넷',
  '업소용 의자',
  '공장용 선반',
  '창고용 선반',
  '산업용 랙',
  '업소용 파티션',
  '사무용 파티션 대형',
  '업소용 주방수납',
  '업소용 트롤리',
  '대형 옷장',
  '업소용 로커',
];

// 산업용품 / 업소용 설비 — 전문 용도로 로켓배송 재고 보유 어려움
export const SEED_KEYWORDS_INDUSTRIAL: string[] = [
  '산업용 저울',
  '업소용 진공포장기',
  '산업용 청소기',
  '업소용 탈수기',
  '산업용 믹서기',
  '업소용 분쇄기',
  '업소용 슬라이서',
  '산업용 압력게이지',
  '산업용 펌프',
  '업소용 순환펌프',
  '산업용 환풍기',
  '업소용 튀김기',
  '업소용 오븐',
  '업소용 컨벡션오븐',
  '업소용 그릴',
  '업소용 솥',
  '업소용 압력솥',
  '업소용 육절기',
  '업소용 제면기',
];

// 특수 / 틈새 — 수요는 있으나 로켓배송이 들어오기 어려운 니치 품목
export const SEED_KEYWORDS_SPECIALTY: string[] = [
  '반신욕기',
  '좌훈기',
  '화덕',
  '제빙기 가정용',
  '훈연기',
  '숙성고',
  '와인셀러',
  '와인냉장고',
  '김치냉장고 스탠드',
  '발효기',
  '요구르트제조기',
  '아이스크림기계',
  '솜사탕기계',
  '팝콘기계',
  '순대찜기',
  '약탕기 대형',
  '한방약탕기',
  '족욕기 대형',
  '찜질기 업소용',
  '이동식 사우나',
];

// 아웃도어 / 대형 레저 — 부피 문제로 쿠팡 입점 제한
export const SEED_KEYWORDS_OUTDOOR: string[] = [
  '캠핑 텐트 대형',
  '파라솔 대형',
  '바베큐 그릴 대형',
  '캠핑 쉘터 대형',
  '글램핑 텐트',
  '이벤트 텐트',
  '행사용 천막',
  '업소용 파라솔',
  '대형 그늘막',
  '캠핑 카고트레일러',
  '루프탑텐트',
  '카누',
  '카약',
  '수상자전거',
  '대형 튜브',
  '전동서프보드',
];

// 전체 시드 키워드 (중복 없이 통합)
export const ALL_SEED_KEYWORDS: string[] = [
  ...SEED_KEYWORDS_LARGE_APPLIANCES,
  ...SEED_KEYWORDS_FURNITURE,
  ...SEED_KEYWORDS_INDUSTRIAL,
  ...SEED_KEYWORDS_SPECIALTY,
  ...SEED_KEYWORDS_OUTDOOR,
];

// 카테고리 레이블 매핑 (키워드 → 카테고리명)
export const SEED_KEYWORD_CATEGORY_MAP: Record<string, string> = {
  ...Object.fromEntries(SEED_KEYWORDS_LARGE_APPLIANCES.map((k) => [k, '대형가전/업소용'])),
  ...Object.fromEntries(SEED_KEYWORDS_FURNITURE.map((k) => [k, '가구/대형인테리어'])),
  ...Object.fromEntries(SEED_KEYWORDS_INDUSTRIAL.map((k) => [k, '산업용품/업소설비'])),
  ...Object.fromEntries(SEED_KEYWORDS_SPECIALTY.map((k) => [k, '특수/틈새'])),
  ...Object.fromEntries(SEED_KEYWORDS_OUTDOOR.map((k) => [k, '아웃도어/대형레저'])),
};
