// --- 도매꾹 API 응답 타입 (v4.1 / v4.5 기준) ---

// getItemList (ver=4.1) 응답의 페이지 헤더
export interface DomeggookListHeader {
  numberOfItems: number;
  currentPage: number;
  itemsPerPage: number;
  numberOfPages: number;
  sort: string;
}

// getItemList (ver=4.1) 응답의 개별 상품
export interface DomeggookListItem {
  no: number;
  title: string;
  price: number;          // 판매가
  thumb: string;          // 썸네일 URL
  id: string;             // 판매자 ID
  nick?: string;          // 판매자 닉네임
  unitQty: number;        // 묶음 수량
  url: string;            // 상품 페이지 URL
  deli: {
    who: string;          // 'P': 판매자, 'B': 구매자
    fee: string;
  };
  market: {
    domeggook: boolean;
    supply: boolean;
  };
  qty?: {
    inventory: number;    // v4.1부터 목록에 포함
  };
  domePrice?: string;     // 도매가 (문자열로 내려오는 경우 있음)
}

// getItemList (ver=4.1) 전체 응답
export interface DomeggookListResponse {
  header: DomeggookListHeader;
  list: DomeggookListItem[];
  errors?: unknown;       // 에러 객체가 있으면 API 오류로 처리
}

// getItemView (ver=4.5) 응답 내 상세 데이터
export interface DomeggookItemDetail {
  basis: {
    no: number;
    title: string;
    status: string;
  };
  category?: {
    current?: { name?: string };
  };
  seller?: {
    id?: string;
    nick?: string;
  };
  price?: {
    dome?: number;
    supply?: number;
    resale?: {
      Recommand?: number;  // 도매꾹 API 오타 그대로 사용
    };
  };
  qty?: {
    inventory: number;
    domeMoq?: number;      // 최소주문수량
  };
  deli?: {
    who?: string;          // 'S'=무료, 'P'=선결제, 'B'=착불, 'C'=구매자선택
    fee?: number;          // 배송비 (원)
  };
  image?: {
    url?: string;
  };
  thumb?: {
    small?: string;
    large?: string;
    original?: string;   // 대표이미지 원본 URL (760px)
    smallPng?: string;
    largePng?: string;
  };
  desc?: {
    license?: {
      usable?: string;   // "true" | "false" (문자열)
      msg?: string;
    };
    contents?: {
      item?: string;     // 상품상세 HTML
      deli?: string;
      event?: string;
      otherItem?: string;
    };
  };
  selectOpt?: string;    // 옵션 JSON 문자열
}

// getItemView (ver=4.5) 전체 응답
export interface DomeggookItemViewResponse {
  data: DomeggookItemDetail;
  errors?: unknown;
}

// --- 분석 결과 타입 ---

export interface SalesAnalysisItem {
  id: string;
  itemNo: number;
  title: string;
  status: string | null;
  categoryName: string | null;
  sellerNick: string | null;
  imageUrl: string | null;
  domeUrl: string | null;
  isTracking: boolean;
  latestDate: string;
  latestInventory: number;
  latestPriceDome: number | null;
  latestPriceSupply: number | null;
  prevInventory1d: number | null;
  sales1d: number;
  prevInventory7d: number | null;
  prev7dDate: string | null;
  sales7d: number;
  avgDailySales: number;
  // 마진율 관련 추가 필드
  moq: number | null;                    // 최소주문수량
  unitQty: number | null;               // 묶음수량
  deliWho: string | null;               // 배송비 부담: 'S'=무료, 'P'=선결제, 'B'=착불, 'C'=구매자선택
  deliFee: number | null;               // 배송비 (원)
  priceResaleRecommend: number | null;  // 추천판매가
  marginRate: number | null;            // 마진율 (%)
  // Legal 방어 로직 필드
  legalStatus: 'blocked' | 'warning' | 'safe' | 'unchecked';
  legalIssues: LegalIssueItem[];
  legalCheckedAt: string | null;
  // IP(지식재산권) 리스크 필드 — KIPRIS 검증 결과
  ipRiskLevel: 'low' | 'medium' | 'high' | null;
  ipCheckedAt: string | null;
  // 네이버 쇼핑 시장 최저가
  marketLowestPrice: number | null;
  marketPriceSource: 'naver_api' | 'manual' | null;
  marketPriceUpdatedAt: string | null;
  // 수량별 가격 티어
  priceTiers: PriceTiers;
  // v2 드롭쉬핑 스코어링 필드 (023 migration)
  scoreTotal: number | null;
  scoreLegalIp: number | null;
  scorePriceComp: number | null;
  scoreCsSafety: number | null;
  scoreMargin: number | null;
  scoreDemand: number | null;
  scoreSupply: number | null;
  scoreMoqFit: number | null;
  scoreCalculatedAt: string | null;
  csRiskLevel: 'low' | 'medium' | 'high' | null;
  csRiskReason: string | null;
  dropshipMoqStrategy: 'single' | '1+1' | '2+1' | null;
  dropshipBundlePrice: number | null;
  dropshipPriceGapRate: number | null;
  // v2 보너스·차단 필드 (024 migration)
  maleTier: 'high' | 'mid' | 'neutral' | 'female' | null;
  maleScore: number | null;
  maleBonus: number | null;
  seasonBonus: number | null;
  seasonLabels: string | null;
  blockedReason: string | null;
  needsReview: boolean;
  // 시장가 (024 migration)
  naverLowestPrice: number | null;
  naverAvgPrice: number | null;
  naverSellerCount: number | null;
  coupangLowestPrice: number | null;
  hasRocket: boolean | null;
  marketUpdatedAt: string | null;
  // 드롭쉬핑 공급자
  supportsDropship: boolean;
  dropshipFee: number | null;
  alternativeSellers: number | null;
  sellerRating: number | null;
  sellerYears: number | null;
}

export interface PriceTier {
  minQty: number;
  unitPrice: number;
}

export interface PriceTiers {
  dome: PriceTier[];
  supply: PriceTier[];
  resale: PriceTier[];
}

export interface LegalIssueItem {
  layer: 'kc' | 'banned' | 'trademark';
  severity: 'RED' | 'YELLOW' | 'GREEN';
  code: string;
  message: string;
  detail: Record<string, unknown>;
}

export interface CollectionLog {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  itemsFetched: number;
  snapshotsSaved: number;
  errors: unknown | null;
  triggerType: 'cron' | 'manual';
}
