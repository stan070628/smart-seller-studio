/**
 * 플랫폼별 수수료 데이터
 * 기준일: 2025년 10월 (수수료는 주기적으로 업데이트 필요)
 *
 * 참고:
 * - 쿠팡: marketplace.coupang.com
 * - 네이버: sell.smartstore.naver.com
 * - G마켓: esmplus.com
 * - 11번가: soffice.11st.co.kr
 * - Shopee: seller.shopee.com
 */

// ─── 쿠팡 윙 ──────────────────────────────────────────────────
export const COUPANG_WING = {
  shippingFeeRate: 0.033, // 선결제 배송비 × 3.3% (VAT 포함)
  serverFeeMonthly: 55000,
  serverFeeThreshold: 1_000_000,
} as const;

// ─── 쿠팡 로켓그로스 ──────────────────────────────────────────
export type RocketSize = '극소형' | '소형' | '중형' | '대형' | '특대형' | '초대형';

export const COUPANG_ROCKET_LOGISTICS: Record<RocketSize, number> = {
  // 입출고 + 배송 요금 (프로모션 종료 후 기준, 판매자센터 확인 필요)
  '극소형': 1800,
  '소형': 2500,
  '중형': 3200,
  '대형': 4500,
  '특대형': 6500,
  '초대형': 9000,
};

export const COUPANG_ROCKET = {
  freeStorageDays: 30,
  storageFeePerDay: 10, // 추정 단가 (판매자센터 확인 필요)
} as const;

// ─── 네이버 스마트스토어 ──────────────────────────────────────
export type NaverGrade = '영세' | '중소1' | '중소2' | '일반' | '스타트제로';

export const NAVER_ORDER_MGMT_FEE: Record<NaverGrade, number> = {
  '영세': 0.0198,
  '중소1': 0.0264,
  '중소2': 0.0297,
  '일반': 0.0363,
  '스타트제로': 0,
};

export type NaverInflow = '네이버쇼핑' | '마케팅링크';

export const NAVER_SALES_FEE: Record<NaverInflow, number> = {
  '네이버쇼핑': 0.0273,
  '마케팅링크': 0.0091,
};

// ─── G마켓 ─────────────────────────────────────────────────────
export const GMARKET_CATEGORIES: Record<string, number> = {
  '생활용품': 0.11,
  '주방용품': 0.11,
  '디지털/가전': 0.04,
  '패션의류': 0.13,
  '뷰티/화장품': 0.11,
  '식품': 0.10,
};

export const GMARKET = {
  shippingFeeRate: 0.033,
  couponSellerShare: 0.01, // 쿠폰 할인액의 1%
} as const;

// ─── 11번가 ────────────────────────────────────────────────────
export const ELEVENST_CATEGORIES: Record<string, number> = {
  '생활용품': 0.13,
  '헤어케어': 0.11,
  '일반의료용품': 0.11,
  '디지털/가전': 0.06,
  '패션의류': 0.13,
  '뷰티/화장품': 0.13,
  '식품': 0.11,
};

export const ELEVENST = {
  shippingFeeRate: 0.033,
  couponSellerShare: 0.02, // 쿠폰 할인액의 2%
  newSellerPromoRate: 0.06,
} as const;

// ─── Shopee ────────────────────────────────────────────────────
export type ShopeeCountry = '말레이시아' | '싱가포르' | '태국';

export const SHOPEE_DATA: Record<
  ShopeeCountry,
  {
    currency: string;
    commission: Record<string, number>;
    transactionFee: number;
  }
> = {
  '말레이시아': {
    currency: 'MYR',
    commission: {
      '생활용품': 0.04,
      '뷰티/퍼스널케어': 0.085,
      '패션': 0.095,
      '식품/음료': 0.05,
      '전자제품': 0.03,
    },
    transactionFee: 0.0212,
  },
  '싱가포르': {
    currency: 'SGD',
    commission: {
      '생활용품': 0.045,
      '뷰티/퍼스널케어': 0.09,
      '패션': 0.10,
      '식품/음료': 0.055,
      '전자제품': 0.035,
    },
    transactionFee: 0.02,
  },
  '태국': {
    currency: 'THB',
    commission: {
      '생활용품': 0.04,
      '뷰티/퍼스널케어': 0.08,
      '패션': 0.09,
      '식품/음료': 0.05,
      '전자제품': 0.03,
    },
    transactionFee: 0.0218,
  },
};

export type ShopeeProgram = '없음' | 'Coins Cashback' | 'Free Shipping';

export const SHOPEE_SERVICE_PROGRAMS: Record<ShopeeProgram, number> = {
  '없음': 0,
  'Coins Cashback': 0.0327,
  'Free Shipping': 0.03,
};
