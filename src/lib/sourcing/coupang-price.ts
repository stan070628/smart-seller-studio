/**
 * coupang-price.ts
 * 쿠팡 실판매가 추정과 로켓그로스 손익 계산.
 *
 * 근거 문서:
 *   20-wiki/outputs/1688 진입 카테고리 필터 2026-07-28  — 마진 기준
 *   20-wiki/sources/로켓그로스 요금표 2026-07-28        — 물류비
 *
 * 기존 naver-shopping.ts와의 차이:
 *   naver-shopping.searchNaverLowestPrice는 display=5·sort=asc로 정규화된
 *   단일 최적 매칭(최저가 1건)을 뽑는다. 이 모듈은 display=100·sort=sim으로
 *   모집단을 통째로 받아 mallName='쿠팡'만 추린 뒤 분위수(하위 25%)를
 *   계산한다. 목적이 "가격 하나"가 아니라 "가격 분포"라 파라미터가 다르다.
 */

import type { LogisticsSize } from '@/types/shortlist';
import { resolveRgShippingFee, type RgSizeType } from '@/lib/roi/rg-fees';
import { effectiveFeeRate } from '@/lib/tax';

/**
 * 쿠팡 판매수수료.
 * 주의: 이 값이 calculator/coupang-fees.ts 등 여러 곳에 각각 하드코딩되어 있다.
 * 정식 소스를 만드는 일은 별도 정리 과제로 둔다.
 *
 * VAT 처리: 쿠팡 고지 요율은 VAT 별도다. 간이과세자는 매입세액 공제를 받지 못해
 * VAT가 그대로 비용이 되므로 effectiveFeeRate()를 거쳐 실질 부담률을 쓴다.
 *
 * export하는 이유: 수수료는 쿠팡이라는 외부 플랫폼의 사실이라 이 모듈 밖에서도
 * 재사용될 여지가 있다. 반면 TARGET_MARGIN_RATE·MARGIN_TO_LOGISTICS는 이
 * 모듈이 내리는 정책적 판단이라 캡슐화한다.
 */
export const COMMISSION_RATE = effectiveFeeRate(0.108);

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
 * VAT 처리: 로켓그로스 물류비도 VAT 별도 고지다. 간이과세자는 매입세액 공제를
 * 받지 못해 물류비 VAT가 그대로 원가가 되므로 resolveRgShippingFee()로 실효원가를 쓴다.
 * measuredFee(첫 인자)는 정산서 기반 실측값 자리인데, 이 상수는 사이즈 유형별
 * 기본값만 다루므로 null을 넘겨 항상 사이즈 유형 기본값을 쓰게 한다.
 */
export const LOGISTICS_FEE: Record<LogisticsSize, number> = {
  xsmall: resolveRgShippingFee(null, RG_SIZE_KEY.xsmall),
  small: resolveRgShippingFee(null, RG_SIZE_KEY.small),
  medium: resolveRgShippingFee(null, RG_SIZE_KEY.medium),
};

/** 목표 마진율 — 광고 손익분기 ROAS 333% 이하를 만드는 하한 */
const TARGET_MARGIN_RATE = 0.3;

/** 개당 마진이 물류비의 몇 배 이상이어야 하는가 — 요율 인상 완충 */
const MARGIN_TO_LOGISTICS = 1.5;

/**
 * 목표 역산 기준 최소 판매가(원) — 이 값 미만으로는 팔지 않는다.
 *
 * breakEvenPrice와 달리 원가에서 계산되는 값이 아니라 사업상 정한 하한선이다.
 * 원가가 아무리 싸서 손익분기를 넘겨도 1만원 미만 가격대는 진입하지 않는다.
 * 그래서 판정에서 손익분기보다 먼저 본다.
 *
 * export하는 이유: 판정이 세 곳(keyword-pipeline·shortlist-verify·SupplierCompare)에서
 * 내려지는데 각자 상수를 들고 있으면 값이 어긋난다. 실제로 keyword-pipeline과
 * DiscoveryTab에 사본이 두 벌 있었다. 판정 상수의 정본은 이 파일이다.
 */
export const MIN_SELL_PRICE_KRW = 10000;

/**
 * 기본 사입 수량 — 개당 배송비를 환산하는 기준이다.
 *
 * 30인 이유: 1688에서 2개만 샘플로 사서 붙여넣어도 배송비는 실제 사입 예정
 * 수량으로 나눠야 한다. 샘플 수량으로 나누면 국제배송비 최소 구간(0.5kg·4,180원)이
 * 통째로 두세 개에 얹혀 개당 원가가 뻥튀기되고, 팔 수 있는 상품이 미달로 보인다.
 *
 * 도매꾹 개당 배송비(unitDeliveryFee)에도 같은 값이 쓰인다 — 두 공급처를
 * 같은 사입 규모로 비교해야 판정이 공정하다.
 */
export const DEFAULT_ORDER_QTY = 30;

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

  // 4단어씩 자르되 시작점을 2단어씩 겹치게 잡는다(0,2,4,끝-4).
  // 겹치지 않게 자르면 상품 정체가 구간 경계에 걸려 잘려나갈 수 있다.
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

/**
 * 표본이 이보다 적으면 판정하지 않는다.
 *
 * 잠정값이다. 표본 3~5건 구간의 신뢰도는 설계 문서 단계에서 근거가 얇다고
 * 명시된 채로 남아 있다 — 운영하며 coupang_sample_n과 실제 진입 결과를
 * 대조해 보정할 예정이다. 지금 3을 "검증된 하한"으로 읽지 말 것.
 */
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
  if (!clientId || !clientSecret) {
    // 조용히 삼키면 API 키가 만료돼도 모든 후보가 "표본 부족"으로만 보이고
    // 원인이 로그에 안 남는다. 이 숫자가 매입 결정을 좌우하므로 반드시 남긴다.
    console.error('[coupang-price] NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 미설정');
    return [];
  }

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
    if (!res.ok) {
      console.error(`[coupang-price] API 오류 (${res.status}): query="${query}"`);
      return [];
    }
    const data = (await res.json()) as { items?: NaverShopItem[] };
    return data.items ?? [];
  } catch (err) {
    // 네트워크 오류도 표본 없음으로 처리하지만(호출자가 unknown 판정을 내린다),
    // 원인 추적을 위해 반드시 로그는 남긴다.
    console.error(`[coupang-price] 요청 실패: query="${query}"`, err);
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
 *
 * 이 함수 자체는 호출 간 지연을 넣지 않는다 — 이 저장소 관례는 지연을
 * 호출부(라우트·cron)에 두는 것이다(src/app/api/sourcing/naver-prices/route.ts의
 * NAVER_CALL_DELAY_MS 참고). 이 함수를 배치로 여러 건 돌릴 때는 호출부가
 * 같은 방식으로 페이싱을 넣어야 한다. (Task 8 cron 작성 시 잊지 말 것.)
 */
export async function estimateCoupangPrice(
  title: string,
): Promise<CoupangPriceEstimate | null> {
  const prices: number[] = [];

  // 쿼리를 순차로 await한다. 상품 1건당 buildSearchQueries가 최대 4개를
  // 만드므로 100건을 처리하면 최대 400회 순차 호출이 된다 — Promise.all로
  // 바꾸고 싶어질 지점이지만, 네이버 쇼핑 API는 초당 호출 제한이 문서화돼
  // 있지 않아 동시 호출 시 429 폭풍 위험이 있다. 직렬 호출은 의도한 설계다.
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
