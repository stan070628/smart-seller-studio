// 네이버 쇼핑 API 응답 아이템
export interface NaverShoppingItem {
  title: string;
  link: string;
  image: string;
  lprice: string;
  hprice: string;
  mallName: string;
  productId: string;
  productType: string;
  brand: string;
  maker: string;
  category1: string;
  category2: string;
  category3: string;
  category4: string;
}

// 니치점수 계산 입력
export interface NicheScoreInput {
  keyword: string;
  totalProductCount: number;
  avgPrice: number;
  medianPrice: number;
  uniqueSellerCount: number;
  sampleSize: number;
  brandProductCount: number;
  top3SellerProductCount: number;
  hasLargeSizeKeyword: boolean;
  hasBulkyCategory: boolean;
  officialStoreBrandRatio: number;
}

// 니치점수 결과
export interface NicheScoreResult {
  totalScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  breakdown: {
    rocketNonEntry: number;       // 0~30
    competitionLevel: number;     // 0~20
    sellerDiversity: number;      // 0~15
    monopolyLevel: number;        // 0~10
    brandRatio: number;           // 0~10
    priceMarginViability: number; // 0~10
    domesticRarity: number;       // 0~5
  };
  signals: string[];
}

// DB에서 조회한 키워드
export interface NicheKeyword {
  id: string;
  keyword: string;
  categoryTag: string | null;
  totalScore: number;
  grade: string;
  breakdown: NicheScoreResult['breakdown'];
  signals: string[];
  rawTotalProducts: number | null;
  rawAvgPrice: number | null;
  rawMedianPrice: number | null;
  rawUniqueSellers: number | null;
  analyzedAt: string;
}

// 관심 키워드
export interface NicheWatchlistItem {
  id: string;
  keyword: string;
  memo: string | null;
  latestScore: number | null;
  latestGrade: string | null;
  createdAt: string;
}

// 점수 이력
export interface NicheScoreSnapshot {
  snapshotDate: string;
  totalScore: number;
  grade: string;
  rawTotalProducts: number | null;
  rawAvgPrice: number | null;
}

// ─────────────────────────────────────────────────────────────
// 경쟁 상품 / 전일 판매 추적
// ─────────────────────────────────────────────────────────────

export type CompetitorPlatform = 'coupang' | 'naver' | 'gmarket' | 'auction' | 'etc';
export type SnapshotInputMethod = 'manual' | 'bookmarklet' | 'extension' | 'api';

// 경쟁 상품 마스터
export interface NicheCompetitorProduct {
  id: string;
  keyword: string;
  platform: CompetitorPlatform;
  productUrl: string | null;
  productId: string | null;
  productName: string;
  sellerName: string | null;
  imageUrl: string | null;
  isRocket: boolean;
  isAd: boolean;
  rankPosition: number | null;
  isTracking: boolean;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

// 일별 판매 스냅샷
export interface NicheSalesSnapshot {
  id: string;
  competitorId: string;
  keyword: string;
  platform: string;
  snapshotDate: string;
  price: number | null;
  originalPrice: number | null;
  reviewCount: number | null;
  rating: number | null;
  salesCount: number | null;
  reviewDelta: number | null;
  salesRank: number | null;
  rankPosition: number | null;
  inputMethod: SnapshotInputMethod;
  memo: string | null;
  createdAt: string;
}

// 경쟁 현황 요약 (뷰 조회 결과)
export interface NicheCompetitorSummary {
  competitorId: string;
  keyword: string;
  platform: string;
  productName: string;
  sellerName: string | null;
  productUrl: string | null;
  isRocket: boolean;
  isAd: boolean;
  latestDate: string | null;
  price: number | null;
  reviewCount: number | null;
  rating: number | null;
  salesCount: number | null;
  reviewDelta: number | null;
  rankPosition: number | null;
  prevPrice: number | null;
  priceChange: number | null;
  reviewChange: number | null;
}

// 알림
export interface NicheAlert {
  id: string;
  keyword: string;
  grade: string;
  totalScore: number;
  isRead: boolean;
  createdAt: string;
}
