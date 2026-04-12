/**
 * naver-shopping.ts
 * 네이버 쇼핑 검색 API 클라이언트
 *
 * 공식 API: GET https://openapi.naver.com/v1/search/shop.json
 * 헤더: X-Naver-Client-Id, X-Naver-Client-Secret
 * 하루 호출 한도: 25,000회
 */

import { parseProductUnit } from './unit-parser';
import type { ParsedUnit } from './unit-parser';

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

interface NaverShopItem {
  title: string;    // HTML 태그 포함 상품명
  lprice: string;   // 최저가 문자열 ("0" = 미정)
  hprice: string;   // 최고가 문자열
  mallName: string; // 쇼핑몰명
  productId: string;
  link: string;
}

interface NaverShopResponse {
  total: number;
  start: number;
  display: number;
  items: NaverShopItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 검색어 전처리
//
// 코스트코 상품명에는 묶음 수량·용량·규격이 포함되어 있어
// 그대로 검색하면 단품 가격이 매칭됨.
// 핵심 브랜드+제품명만 남기고 수량/용량 정보는 제거한다.
//
// 예시:
//   "베지밀 오트밀 두유 190ml x 24 x 3"  → "베지밀 오트밀 두유"
//   "캐스트롤 엔진오일 0W-20 1L 6개"      → "캐스트롤 엔진오일 0W-20"
//   "닥터브로너스 캐스틸 솝 950ml + 60ml" → "닥터브로너스 캐스틸 솝"
//   "아이깨끗해 핸드솝 4L X 1"            → "아이깨끗해 핸드솝"
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeProductQuery(title: string): string {
  let q = title.trim();

  // 1. 괄호 안 내용 제거 (규격·용량 설명이 많음)
  //    "클렌저 950ml (공펌프용기490ml x 1포함)" → "클렌저 950ml"
  q = q.replace(/\([^)]*\)/g, '').trim();
  q = q.replace(/\[[^\]]*\]/g, '').trim();

  // 2. 묶음 수량 패턴 제거
  //    "x 24 x 3", "× 6", "X 2팩", "x3", "6개", "2팩", "24입", "3박스"
  //    숫자 + 단위 조합 (개|팩|박스|세트|입|묶음|통|병|캔|포|매|롤|장|켤레)
  const UNIT = '(개|팩|박스|세트|입|묶음|통|병|캔|포|매|롤|장|켤레|구|조각|피스|piece|pk|ct)';
  q = q.replace(new RegExp(`[xX×]\\s*\\d+\\s*[xX×]\\s*\\d+\\s*${UNIT}?`, 'gi'), ''); // x6x4팩
  q = q.replace(new RegExp(`[xX×]\\s*\\d+\\s*${UNIT}?`, 'gi'), '');       // x 6개, x3
  q = q.replace(new RegExp(`\\d+\\s*${UNIT}`, 'gi'), '');                  // 6개, 24입, 2팩

  // 3. 용량/중량 패턴 제거 (숫자 + 용량단위)
  //    "190ml", "1.8kg", "4L", "950ml + 60ml", "500g x 2"
  const VOL = '(ml|ML|mL|l|L|kg|KG|g|G|mg|MG|oz|fl\\.?oz)';
  q = q.replace(new RegExp(`\\d+(\\.\\d+)?\\s*${VOL}(\\s*[+&]\\s*\\d+(\\.\\d+)?\\s*${VOL})*`, 'gi'), '');

  // 4. 연속 공백·특수문자 정리
  q = q.replace(/[/\\+&_]+/g, ' ');
  q = q.replace(/\s{2,}/g, ' ').trim();

  // 5. 끝에 남은 단독 숫자·단위 제거
  q = q.replace(/\s+\d+\s*$/g, '').trim();

  // 6. 너무 짧아지면 원본 앞 2단어만 사용
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return title.split(/\s+/).slice(0, 3).join(' ');
  }

  // 7. 검색 효율을 위해 최대 4단어로 제한
  return words.slice(0, 4).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// 단가 비교 전용 검색어 정규화
//
// normalizeProductQuery()와의 차이:
//   - 묶음 "x 24" 등 곱셈 수량은 제거하되
//   - 첫 번째 단위 규격("190ml", "1.36kg", "300정")은 유지
//
// 예시:
//   "베지밀 두유 190ml x 24"    → "베지밀 두유 190ml"
//   "커클랜드 아몬드 1.36kg"    → "커클랜드 아몬드 1.36kg"
//   "센트룸 비타민 300정 + 60정" → "센트룸 비타민 300정"
//   "캐스트롤 엔진오일 1L 6개"   → "캐스트롤 엔진오일 1L"
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeForUnitSearch(title: string): string {
  let q = title.trim();

  // 1. 괄호·대괄호 내용 제거
  q = q.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');

  // 2. 곱셈 수량만 제거 (x N, × N, X N) — 앞 단위 규격은 유지
  q = q.replace(/[xX×]\s*\d+(\.\d+)?/g, '');

  // 3. 덧셈 추가 규격 제거 (+ 60ml, + 60정 등)
  const VOL = '(ml|ML|mL|l|L|kg|KG|g|G|mg|oz|fl\\.?oz|정|캡슐|알|개|봉|포|팩|매)';
  q = q.replace(new RegExp(`[+]\\s*\\d+(\\.\\d+)?\\s*${VOL}`, 'gi'), '');

  // 4. 끝부분 낱개 묶음 단위 제거 (6개, 24입, 2팩 — 수량 앞에 단위가 없는 경우)
  const BUNDLE = '(개|팩|박스|세트|입|묶음|통|병|캔|포|매|롤|장|pk|ct)';
  q = q.replace(new RegExp(`\\b\\d+\\s*${BUNDLE}\\b`, 'gi'), '');

  // 5. 연속 공백·특수문자 정리
  q = q.replace(/[/\\&_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // 6. 너무 짧아지면 원본 앞 3단어 사용
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return title.split(/\s+/).slice(0, 3).join(' ');
  }

  // 7. 최대 5단어로 제한 (규격 포함이라 4→5)
  return words.slice(0, 5).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────────────────────

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

function parseLprice(lprice: string): number | null {
  if (!lprice || lprice.trim() === '' || lprice === '0') return null;
  const parsed = parseInt(stripHtmlTags(lprice), 10);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 공개 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 네이버 쇼핑 API로 상품 최저가를 검색합니다.
 *
 * 내부적으로 normalizeProductQuery()로 상품명을 전처리한 뒤 검색합니다.
 * - display=5, sort=asc → items[0].lprice가 최저가
 * - 실패 시 null 반환 (throw 하지 않음)
 * - 타임아웃: 8초
 *
 * @deprecated 단가 비교가 가능한 상품은 searchNaverUnitPrice()를 우선 사용하세요.
 *             이 함수는 단위 파싱 불가 상품의 fallback으로 유지됩니다.
 */
export async function searchNaverLowestPrice(query: string): Promise<number | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[naver-shopping] NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 미설정');
    return null;
  }

  const normalizedQuery = normalizeProductQuery(query);

  const url = new URL('https://openapi.naver.com/v1/search/shop.json');
  url.searchParams.set('query', normalizedQuery);
  url.searchParams.set('display', '5');
  url.searchParams.set('sort', 'asc');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error(`[naver-shopping] API 오류 (${res.status}): query="${normalizedQuery}", body=${errorText}`);
      return null;
    }

    const data: NaverShopResponse = await res.json();

    if (!data.items || data.items.length === 0) {
      return null;
    }

    // sort=asc이므로 items[0]이 최저가 상품
    const lowestPrice = parseLprice(data.items[0].lprice);

    console.log(
      `[naver-shopping] "${normalizedQuery}" → ${lowestPrice?.toLocaleString() ?? 'null'}원 (${data.items[0].mallName})`,
    );

    return lowestPrice;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[naver-shopping] 타임아웃: query="${normalizedQuery}"`);
    } else {
      console.error(`[naver-shopping] 요청 실패: query="${normalizedQuery}"`, err);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 단가 기반 네이버 쇼핑 검색
// ─────────────────────────────────────────────────────────────────────────────

/** searchNaverUnitPrice() 반환 타입 */
export interface NaverUnitPriceResult {
  /** 검색된 상품 총 가격 */
  totalPrice: number;
  /** 코스트코와 동일 기준 단가 (예: 100g당, 100ml당, 1개당) */
  unitPrice: number;
  /** 단가 레이블 (예: '100g당', '100ml당', '1개당') */
  unitPriceLabel: string;
  /** 매칭된 네이버 상품명 (HTML 태그 제거 후) */
  naverTitle: string;
  /** 쇼핑몰명 */
  mallName: string;
}

/**
 * 코스트코 상품의 단위 정보를 기준으로 네이버 쇼핑에서 동일 unitType 상품의
 * 단가를 검색합니다.
 *
 * 로직:
 *   1. normalizeProductQuery()로 검색어 생성
 *   2. 네이버 API display=10, sort=sim 호출
 *   3. 각 item에 parseProductUnit() 적용
 *   4. costcoUnit과 같은 unitType인 결과만 필터링
 *   5. 단가 = lprice / totalQuantity * unitPriceDivisor
 *   6. 단가가 가장 낮은 결과 반환
 *   7. 같은 unitType 없으면 null 반환
 *
 * - 실패 시 null 반환 (throw 하지 않음)
 * - 타임아웃: 8초
 */
export async function searchNaverUnitPrice(
  query: string,
  costcoUnit: ParsedUnit,
  costcoUnitPrice?: number, // 이상치 필터 기준 (코스트코 단가)
): Promise<NaverUnitPriceResult | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[naver-shopping] NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 미설정');
    return null;
  }

  const normalizedQuery = normalizeForUnitSearch(query);

  const url = new URL('https://openapi.naver.com/v1/search/shop.json');
  url.searchParams.set('query', normalizedQuery);
  url.searchParams.set('display', '20'); // 10→20: 매칭 후보 확대
  url.searchParams.set('sort', 'sim'); // 관련도 정렬 → 단가 최저를 직접 계산

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error(
        `[naver-shopping] 단가검색 API 오류 (${res.status}): query="${normalizedQuery}", body=${errorText}`,
      );
      return null;
    }

    const data: NaverShopResponse = await res.json();

    if (!data.items || data.items.length === 0) {
      return null;
    }

    // 각 item 단가 계산 후 같은 unitType만 필터링
    let bestResult: NaverUnitPriceResult | null = null;
    let bestUnitPrice = Infinity;

    for (const item of data.items) {
      const totalPrice = parseLprice(item.lprice);
      if (totalPrice === null) continue;

      const cleanTitle = stripHtmlTags(item.title);
      const parseResult = parseProductUnit(cleanTitle);

      // 같은 unitType인 경우만 비교
      if (!parseResult.success) continue;
      if (parseResult.parsed.unitType !== costcoUnit.unitType) continue;

      const { totalQuantity, unitPriceDivisor, unitPriceLabel } = parseResult.parsed;
      if (totalQuantity <= 0) continue;

      const itemUnitPrice =
        Math.round((totalPrice / totalQuantity) * unitPriceDivisor * 100) / 100;

      // 이상치 필터: 코스트코 단가 대비 0.3x ~ 30x 범위 밖은 제외
      // (오파싱된 묶음상품이나 전혀 다른 규격의 상품 차단)
      if (costcoUnitPrice && costcoUnitPrice > 0) {
        const ratio = itemUnitPrice / costcoUnitPrice;
        if (ratio < 0.3 || ratio > 30) continue;
      }

      if (itemUnitPrice < bestUnitPrice) {
        bestUnitPrice = itemUnitPrice;
        bestResult = {
          totalPrice,
          unitPrice: itemUnitPrice,
          unitPriceLabel,
          naverTitle: cleanTitle,
          mallName: item.mallName,
        };
      }
    }

    if (bestResult) {
      console.log(
        `[naver-shopping] 단가검색 "${normalizedQuery}" → ${bestResult.unitPrice}원/${bestResult.unitPriceLabel} (${bestResult.mallName})`,
      );
    }

    return bestResult;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[naver-shopping] 단가검색 타임아웃: query="${normalizedQuery}"`);
    } else {
      console.error(`[naver-shopping] 단가검색 요청 실패: query="${normalizedQuery}"`, err);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
