/**
 * 그로스 운영비(개당) 세분화 모델.
 *
 * 기존 계산 엔진(margin-1688.ts)은 그로스 운영비를 단일 스칼라
 * `groceryRunningCost`로만 받는다. 이 모듈은 그 한 값을
 *   입출고비 + 배송비 + 보관비 + 반품비 + 포장/부자재비
 * 로 분해해 현실적으로 산출하고, 합계(total)를 엔진에 그대로 넘긴다.
 *
 * 요율 출처: 쿠팡 판매자센터 "로켓그로스 비용/수수료" 페이지 (2026-07 확인).
 * - 입출고비 / 배송비는 사이즈별로 분리 부과되며 표시가는 "~"(최소 시작가).
 *   실제 비용은 카테고리·사이즈 유형·판매가에 따라 변동한다.
 * - 극소형/소형/중형만 화면에서 확인. 대형/특대형/초대형은 아직 미확인 추정치.
 * - 보관비: 매 입고시 30일 무료(프로모션). 초과분 일할 과금(단가는 상세기준, 추정 10원/일).
 * - 반품 회수/재입고/반출비: 프로모션 중 매달 20건까지 무료 → 소량 판매 시 실질 0.
 */

// 쿠팡 로켓그로스 사이즈 유형 (세변합 cm + 무게 kg 기준, 2026-07 개편)
export type RocketSize = '극소형' | '소형' | '중형' | '대형1' | '대형2' | '특대형';

export const ROCKET_SIZES: RocketSize[] = [
  '극소형', '소형', '중형', '대형1', '대형2', '특대형',
];

/** 사이즈 판정 기준(세변합 & 무게 — 둘 중 하나라도 초과 시 상위 사이즈) */
export const SIZE_CRITERIA: Record<RocketSize, string> = {
  극소형: '세변합 ~80cm & ~2kg',
  소형: '80~100cm & 2~5kg',
  중형: '100~120cm & 5~10kg',
  대형1: '120~140cm & 10~15kg',
  대형2: '140~160cm & 15~20kg',
  특대형: '160~250cm & 20~30kg',
};

/** 쿠팡 로켓그로스 입출고비(원, 판매된 상품당 최소 시작가, VAT 별도) */
export const ROCKET_INOUT: Record<RocketSize, number> = {
  극소형: 600,
  소형: 650,
  중형: 1240,
  // ⚠️ 아래 3개는 화면 미확인 추정치 — 실제 페이지 값으로 교체 필요
  대형1: 2000,
  대형2: 3000,
  특대형: 4500,
};

/** 쿠팡 로켓그로스 배송비(원, 판매된 상품당 최소 시작가, VAT 별도) */
export const ROCKET_SHIPPING: Record<RocketSize, number> = {
  극소형: 1125,
  소형: 1250,
  중형: 1500,
  // ⚠️ 아래 3개는 화면 미확인 추정치 — 실제 페이지 값으로 교체 필요
  대형1: 2500,
  대형2: 3500,
  특대형: 5000,
};

/** 화면에서 실제값을 확인한 사이즈(나머지는 추정) */
export const CONFIRMED_SIZES: RocketSize[] = ['극소형', '소형', '중형'];

/** 반출비: 월 20개 무료 후 개당 요금(원, 사이즈 무관) */
export const SHIPOUT_FEE_AFTER_FREE = 300;

/** 보관비: 무료 보관일 이후 1일·개당 요금(원) — 추정(상세기준 확인 필요) */
export const STORAGE_FEE_PER_DAY = 10;
/** 매 입고시 무료 보관일 (프로모션) */
export const FREE_STORAGE_DAYS = 30;
/** 로켓그로스 세이버 가입 시 무료 보관일 */
export const SAVER_FREE_STORAGE_DAYS = 60;

/** 네이버/판매자 직접배송 시 개당 택배비 기본값(원) */
export const DEFAULT_PARCEL_FEE = 3500;

export type GroceryChannel = 'coupang' | 'naver';

export interface GroceryCostInput {
  channel: GroceryChannel;
  /** 쿠팡 로켓그로스 사이즈 (coupang일 때 입출고비·배송비 자동 결정) */
  size: RocketSize;
  /** 네이버/판매자배송 개당 택배비 (naver일 때 사용) */
  parcelFee: number;
  /** 예상 보관일 (무료일 초과분만 과금) */
  storageDays: number;
  /** 반품률(%) */
  returnRatePct: number;
  /** 회당 반품 처리비(회수+재입고, 원). 프로모션 무료 구간이면 0으로 두면 됨 */
  returnCostPerCase: number;
  /** 개당 포장/부자재비(원) */
  packagingCost: number;
  /** 로켓그로스 세이버 가입 여부 (보관 60일 무료 + 반품 회수/재입고비 무제한 무료) */
  saver: boolean;
}

export interface GroceryCostBreakdown {
  /** 입출고비 (쿠팡) — 네이버는 0 */
  inout: number;
  /** 배송비(쿠팡 사이즈별) 또는 택배비(네이버) */
  shipping: number;
  /** 개당 보관비 */
  storage: number;
  /** 개당 평균 반품비 (반품률 × 회당 처리비) */
  returnCost: number;
  /** 포장/부자재비 */
  packaging: number;
  /** 합계 → groceryRunningCost로 계산 엔진에 전달 */
  total: number;
}

export const DEFAULT_GROCERY_INPUT: Omit<GroceryCostInput, 'channel'> = {
  size: '소형',
  parcelFee: DEFAULT_PARCEL_FEE,
  storageDays: 30,
  returnRatePct: 3,
  returnCostPerCase: 0, // 프로모션 중 월 20건 무료 → 기본 0, 초과 시 사용자가 입력
  packagingCost: 300,
  saver: false,
};

export function calcGroceryCost(input: GroceryCostInput): GroceryCostBreakdown {
  const isCoupang = input.channel === 'coupang';

  const inout = isCoupang ? ROCKET_INOUT[input.size] : 0;
  const shipping = isCoupang
    ? ROCKET_SHIPPING[input.size]
    : Math.max(0, input.parcelFee);

  const freeDays = input.saver ? SAVER_FREE_STORAGE_DAYS : FREE_STORAGE_DAYS;
  const billableDays = Math.max(0, input.storageDays - freeDays);
  const storage = isCoupang ? billableDays * STORAGE_FEE_PER_DAY : 0;

  // 세이버 가입 시 반품 회수/재입고비 무제한 무료
  const returnCost = input.saver
    ? 0
    : Math.round(
        (Math.max(0, input.returnRatePct) / 100) *
          Math.max(0, input.returnCostPerCase),
      );

  const packaging = Math.max(0, input.packagingCost);

  const total = Math.round(inout + shipping + storage + returnCost + packaging);

  return { inout, shipping, storage, returnCost, packaging, total };
}
