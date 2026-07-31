/**
 * coupang-price.ts
 * 쿠팡 실판매가 추정과 로켓그로스 손익 계산.
 *
 * 근거 문서:
 *   20-wiki/outputs/1688 진입 카테고리 필터 2026-07-28  — 마진 기준
 *   20-wiki/sources/로켓그로스 요금표 2026-07-28        — 물류비
 */

import type { LogisticsSize } from '@/types/shortlist';
import { getRgShippingFee, type RgSizeType } from '@/lib/roi/rg-fees';

/**
 * 쿠팡 판매수수료.
 * 주의: 이 값이 calculator/coupang-fees.ts 등 여러 곳에 각각 하드코딩되어 있다.
 * 정식 소스를 만드는 일은 별도 정리 과제로 둔다.
 *
 * export하는 이유: 수수료는 쿠팡이라는 외부 플랫폼의 사실이라 이 모듈 밖에서도
 * 재사용될 여지가 있다. 반면 TARGET_MARGIN_RATE·MARGIN_TO_LOGISTICS는 이
 * 모듈이 내리는 정책적 판단이라 캡슐화한다.
 */
export const COMMISSION_RATE = 0.108;

/**
 * 쇼트리스트의 사이즈 값 → 로켓그로스 요율표(rg-fees.ts) 키.
 * 값이 다른 이유: 쇼트리스트 쪽은 DB CHECK 제약에 'xsmall'로 박혀 있고,
 * 요율표 쪽은 대형 이상까지 다루느라 'extra_small' 표기를 쓴다.
 */
const RG_SIZE_KEY: Record<LogisticsSize, RgSizeType> = {
  xsmall: 'extra_small',
  small: 'small',
  medium: 'medium',
};

/**
 * 로켓그로스 입출고비+배송비 (원). 판매된 상품에만 부과된다.
 * 값은 rg-fees.ts에서 파생한다 — 요율표가 바뀌면 그 파일만 고치면 된다.
 */
export const LOGISTICS_FEE: Record<LogisticsSize, number> = {
  xsmall: getRgShippingFee(RG_SIZE_KEY.xsmall),
  small: getRgShippingFee(RG_SIZE_KEY.small),
  medium: getRgShippingFee(RG_SIZE_KEY.medium),
};

/** 목표 마진율 — 광고 손익분기 ROAS 333% 이하를 만드는 하한 */
const TARGET_MARGIN_RATE = 0.3;

/** 개당 마진이 물류비의 몇 배 이상이어야 하는가 — 요율 인상 완충 */
const MARGIN_TO_LOGISTICS = 1.5;

/**
 * 진입 가능한 최소 판매가(원).
 *
 * 두 조건을 모두 만족해야 하므로 큰 쪽을 취한다.
 *   ① 마진율 30% 이상
 *   ② 개당 마진 ≥ 물류비 × 1.5
 *
 * 원가가 낮을수록 ②가, 높을수록 ①이 지배한다.
 */
export function breakEvenPrice(effectiveCost: number, size: LogisticsSize): number {
  const logi = LOGISTICS_FEE[size];
  const byRate = (effectiveCost + logi) / (1 - COMMISSION_RATE - TARGET_MARGIN_RATE);
  // logi * (1 + MARGIN_TO_LOGISTICS): 물류비 자체를 회수(logi)하고,
  // 그 위에 물류비의 MARGIN_TO_LOGISTICS배를 마진으로 더 얹는다.
  const byAmount = (effectiveCost + logi * (1 + MARGIN_TO_LOGISTICS)) / (1 - COMMISSION_RATE);
  return Math.ceil(Math.max(byRate, byAmount));
}

/** 개당 마진(원). 음수면 적자다. */
export function marginOf(
  sellingPrice: number,
  effectiveCost: number,
  size: LogisticsSize,
): number {
  return Math.round(
    sellingPrice * (1 - COMMISSION_RATE) - LOGISTICS_FEE[size] - effectiveCost,
  );
}

/**
 * 상품명에서 검색어 후보를 만든다.
 *
 * 도매꾹 상품명은 키워드 나열형이라 앞 4단어만 잘라 쓰면 상품 정체를 놓친다.
 * 실제로 "접이식 쓰레기통 걸이형휴지통…"이 "접이식 쓰레기통"으로 검색되어
 * 캠핑용 대형 트래쉬박스(중앙값 36,580원)를 잡았고, 실제 상품은 5,490원짜리
 * 봉투걸이였다. 그래서 앞·중간·뒤 구간을 각각 검색해 결과를 합친다.
 */
export function buildSearchQueries(title: string, max = 4): string[] {
  const cleaned = title
    .replace(/\[[^\]]*\]/g, ' ')          // [판매자태그]
    .replace(/\([^)]*\)/g, ' ')           // (부가설명)
    .replace(/[A-Z]{2,}[-_]?\d{3,}/g, ' ') // 모델코드 GTF58047
    .replace(/[/\\+&_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));

  if (words.length === 0) return [title.slice(0, 20)];

  const starts = [0, 2, 4, Math.max(0, words.length - 4)];
  const out: string[] = [];
  for (const s of starts) {
    const chunk = words.slice(s, s + 4).join(' ');
    if (chunk.length > 3 && !out.includes(chunk)) out.push(chunk);
  }
  return out.slice(0, max);
}

/** 쿠팡 시세 추정 결과 */
export interface CoupangPriceEstimate {
  /** 하위 25% 가격 — 진입 기준가 */
  p25: number;
  /** 쿠팡몰 표본 수 */
  sampleN: number;
}

/** 표본이 이보다 적으면 판정하지 않는다 */
const MIN_SAMPLE = 3;

/** 부속품·사은품 노이즈를 거르는 하한 */
const MIN_PRICE = 1000;

interface NaverShopItem {
  lprice: string;
  mallName: string;
}

async function searchNaverShop(query: string): Promise<NaverShopItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  const url = new URL('https://openapi.naver.com/v1/search/shop.json');
  url.searchParams.set('query', query);
  url.searchParams.set('display', '100');
  url.searchParams.set('sort', 'sim');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: NaverShopItem[] };
    return data.items ?? [];
  } catch {
    // 네트워크 오류는 표본 없음으로 처리한다. 호출자가 unknown 판정을 내린다.
    return [];
  }
}

/**
 * 쿠팡 실판매가를 추정한다.
 *
 * 네이버 쇼핑에는 쿠팡 상품이 연동되어 들어온다. mallName이 '쿠팡'인 항목만
 * 추리면 쿠팡 실판가를 근사할 수 있다.
 *
 * 하위 25%를 쓰는 이유 — 2026-07-31 실측 오차:
 *   최저가   −34% ~ −73%  (스펙이 다른 저가 상품을 잡는다)
 *   하위 25%  −11% ~  +9%  ← 채택
 *   중앙값     0% ~ +324%  (고가 상품에 끌려간다)
 *
 * 표본이 MIN_SAMPLE 미만이면 null을 반환한다. 판정 불가와 탈락은 다르다.
 */
export async function estimateCoupangPrice(
  title: string,
): Promise<CoupangPriceEstimate | null> {
  const prices: number[] = [];

  for (const query of buildSearchQueries(title)) {
    const items = await searchNaverShop(query);
    for (const it of items) {
      if (it.mallName !== '쿠팡') continue;
      const p = parseInt(it.lprice, 10);
      if (Number.isFinite(p) && p >= MIN_PRICE) prices.push(p);
    }
  }

  if (prices.length < MIN_SAMPLE) return null;

  prices.sort((a, b) => a - b);
  return {
    p25: prices[Math.floor(prices.length / 4)],
    sampleN: prices.length,
  };
}
