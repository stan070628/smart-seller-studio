/**
 * base.ts
 * 오픈마켓 플랫폼 어댑터 공통 인터페이스 정의
 * 각 플랫폼 어댑터는 PlatformAdapter를 구현한다.
 */

import type { PlatformId } from '@/types/listing';

// ─────────────────────────────────────────────────────────────────────────────
// 플랫폼 등록 결과
// ─────────────────────────────────────────────────────────────────────────────
export interface RegisterResult {
  success: boolean;
  platformProductId?: string;
  platformProductUrl?: string;
  errorCode?: string;
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 플랫폼 공통 상품 정보 (각 어댑터가 플랫폼별 포맷으로 변환)
// ─────────────────────────────────────────────────────────────────────────────
export interface CommonProduct {
  sourcingItemId: string;
  title: string;
  description: string;
  price: number;
  costPrice: number;
  stock: number;
  images: string[];
  weight?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 플랫폼 어댑터 인터페이스
// ─────────────────────────────────────────────────────────────────────────────
export interface PlatformAdapter {
  /** 어댑터가 담당하는 플랫폼 ID */
  platformId: PlatformId;

  /**
   * 자격증명(API 키, OAuth 토큰 등) 유효성 검증
   * @returns 유효하면 true, 아니면 false
   */
  validateCredentials(creds: Record<string, string>): Promise<boolean>;

  /**
   * 상품 등록 요청
   * @param product - 공통 상품 정보
   * @param creds - 플랫폼 자격증명
   * @param categoryId - 플랫폼별 카테고리 ID
   * @returns 등록 결과
   */
  registerProduct(
    product: CommonProduct,
    creds: Record<string, string>,
    categoryId: string
  ): Promise<RegisterResult>;
}
