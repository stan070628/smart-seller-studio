/**
 * listing.ts
 * 오픈마켓 상품 자동등록 관련 타입 정의
 */

export type PlatformId = 'elevenst' | 'naver' | 'coupang' | 'gmarket' | 'shopee';

export interface PlatformMeta {
  id: PlatformId;
  label: string;
  emoji: string;
  authType: string;
  enabled: boolean; // Phase별로 활성화
}

export const PLATFORMS: PlatformMeta[] = [
  { id: 'elevenst', label: '11번가', emoji: '🏪', authType: 'api_key', enabled: true },
  { id: 'naver', label: '네이버', emoji: '🟢', authType: 'oauth2', enabled: true },
  { id: 'coupang', label: '쿠팡', emoji: '🟠', authType: 'hmac', enabled: true },
  { id: 'gmarket', label: 'G마켓', emoji: '🔴', authType: 'jwt', enabled: false },
  { id: 'shopee', label: 'Shopee', emoji: '🧡', authType: 'hmac', enabled: false },
];

export type ListingStatus = 'draft' | 'pending' | 'uploading' | 'registered' | 'failed' | 'deleted';

export interface ProductListing {
  id: string;
  sourcingItemId: string;
  platformId: PlatformId;
  title: string;
  price: number;
  status: ListingStatus;
  platformProductId: string | null;
  platformProductUrl: string | null;
  errorMessage: string | null;
  registeredAt: string | null;
  createdAt: string;
}
