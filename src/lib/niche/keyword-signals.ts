/**
 * 키워드 및 카테고리 시그널 감지 유틸리티
 * 로켓배송 비진출 가능성을 간접적으로 추정하는 데 사용
 */

// 대형/업소용 키워드 — 로켓배송 물류 처리가 어려운 키워드
const LARGE_SIZE_KEYWORDS = [
  '업소용', '대형', '산업용', '설비', '매장용', '상업용',
  '공업용', '전문가용', '3상', '380V', '대용량',
];

// 대형 카테고리 — 부피가 크거나 무거워 로켓배송 입점이 어려운 카테고리
const BULKY_CATEGORIES = [
  '대형가전', '가구', '사무용가구', '주방설비',
  '냉장/냉동', '세탁/건조', '에어컨', '보일러',
  '운동기구', '캠핑텐트', '파라솔',
];

// 공식스토어/직영 패턴 — 공식 채널 비율 추정에 사용
const OFFICIAL_PATTERNS = ['공식', '스토어', 'Official', '본사', '직영'];

/**
 * 키워드 자체 또는 상품 제목 목록에서 대형/업소용 시그널 감지
 * @param keyword  분석 대상 키워드
 * @param titles   네이버 쇼핑 샘플 상품 제목 배열
 * @returns 시그널 감지 여부
 */
export function detectLargeSizeKeyword(keyword: string, titles: string[]): boolean {
  // 키워드 자체에서 먼저 검사 (대소문자 무관)
  const normalizedKeyword = keyword.toLowerCase();
  const matchedByKeyword = LARGE_SIZE_KEYWORDS.some((signal) =>
    normalizedKeyword.includes(signal.toLowerCase()),
  );
  if (matchedByKeyword) return true;

  // 상품 제목 배열에서 검사 — 절반 이상이 시그널 포함 시 true
  if (titles.length === 0) return false;
  const matchCount = titles.filter((title) => {
    const normalizedTitle = title.toLowerCase();
    return LARGE_SIZE_KEYWORDS.some((signal) =>
      normalizedTitle.includes(signal.toLowerCase()),
    );
  }).length;

  return matchCount / titles.length >= 0.5;
}

/**
 * 카테고리 목록에서 대형/부피 카테고리 시그널 감지
 * @param categories  상품 카테고리 문자열 배열 (category1~4 모두 포함 가능)
 * @returns 시그널 감지 여부
 */
export function detectBulkyCategory(categories: string[]): boolean {
  return categories.some((category) => {
    const normalized = category.toLowerCase();
    return BULKY_CATEGORIES.some((bulky) =>
      normalized.includes(bulky.toLowerCase()),
    );
  });
}

/**
 * mallName 배열에서 공식스토어/직영 비율 계산
 * @param mallNames  네이버 쇼핑 샘플의 mallName 배열
 * @returns 0~1 사이의 공식스토어 비율
 */
export function detectOfficialStoreRatio(mallNames: string[]): number {
  if (mallNames.length === 0) return 0;

  const officialCount = mallNames.filter((name) => {
    return OFFICIAL_PATTERNS.some((pattern) =>
      name.toLowerCase().includes(pattern.toLowerCase()),
    );
  }).length;

  return officialCount / mallNames.length;
}
