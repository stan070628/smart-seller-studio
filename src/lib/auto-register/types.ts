// src/lib/auto-register/types.ts

export type SourceType = 'domeggook' | 'costco';

export interface ParsedUrl {
  source: SourceType;
  itemId: string;
}

/** AI가 단일 필드에 대해 반환하는 제안값 + 신뢰도 */
export interface MappedField<T = string> {
  value: T;
  confidence: number; // 0~1
}

/** ai-map route가 반환하는 전체 매핑 결과 */
export interface MappedCoupangFields {
  sellerProductName: MappedField<string>;
  displayCategoryCode: MappedField<number>;
  brand: MappedField<string>;
  salePrice: MappedField<number>;
  originalPrice: MappedField<number>;
  stockQuantity: MappedField<number>;
  deliveryChargeType: MappedField<'FREE' | 'NOT_FREE'>;
  deliveryCharge: MappedField<number>;
  searchTags: MappedField<string[]>;
}

/** 학습 엔진에 저장하는 단일 필드 수정 이력 */
export interface FieldCorrection {
  sourceType: SourceType;
  fieldName: keyof MappedCoupangFields;
  aiValue: string;
  acceptedValue: string;
  wasCorrected: boolean;
}

/** 학습 엔진이 반환하는 단일 필드 신뢰 상태 */
export interface FieldTrustStatus {
  fieldName: string;
  recentCount: number;
  acceptedCount: number;
  trustScore: number; // acceptedCount / recentCount
  isTrusted: boolean; // trustScore >= 0.8 && recentCount >= 5
}

/** 자동 모드 가용 여부 요약 */
export interface AutoModeStatus {
  isAvailable: boolean;
  fieldsTrusted: number;
  fieldsTotal: number;
  untrustedFields: string[];
}

/** parse-url route가 반환하는 정규화된 상품 데이터 */
export interface NormalizedProductOptionValue {
  label: string;         // 표시용 (e.g., "핑크", "S")
  fullName: string;      // 도매꾹 원본 옵션명
  priceAdjustment: number; // 기준가 대비 조정액 (원), 음수 가능
  stock: number;
}

export interface NormalizedProductOption {
  typeName: string;                    // 옵션 종류명 (e.g., "컬러", "사이즈")
  values: NormalizedProductOptionValue[];
}

export interface NormalizedProduct {
  source: SourceType;
  itemId: string;
  title: string;
  price: number;
  originalPrice?: number;
  imageUrls: string[];           // 첫 번째가 대표 이미지 (썸네일용)
  detailImageUrls?: string[];    // 상세페이지 전용 이미지 (상세 HTML에서 추출)
  description: string;           // 텍스트 설명 (HTML 제거)
  brand?: string;
  manufacturer?: string; // 제조사
  countryOfOrigin?: string; // 원산지 (예: 미국산, 국산)
  categoryHint?: string; // 소스 카테고리명 (AI 매핑 힌트용)
  detailHtml?: string;   // 상세페이지 HTML (있으면)
  deliFee?: number;      // 실제 배송비 (도매꾹: deli.dome.fee 또는 deli.fee)
  moq?: number;          // 최소주문수량
  options?: NormalizedProductOption[]; // 상품 옵션 (도매꾹 selectOpt 파싱)
  certification?: string; // KC 인증번호 (도매꾹 상세 HTML에서 추출)
  suggestedTags?: string[]; // 네이버 연관검색어 기반 추천 검색태그
  specs?: Array<{ label: string; value: string }>; // 소스 URL에서 추출한 정형 스펙 (AI 상세페이지 생성 시 우선 반영)
  specText?: string; // 구조화된 피처 텍스트 (고시정보 AI용) — detailHtml과 별개
}
