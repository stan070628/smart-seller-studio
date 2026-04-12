/**
 * 네이버 커머스 API 클라이언트
 *
 * 인증: BCRYPT 서명 → OAuth2 토큰 (client_credentials)
 * 문서: https://apicenter.commerce.naver.com
 */

import bcrypt from 'bcryptjs';
import { proxyFetch } from '@/lib/proxy-fetch';

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const API_HOST = 'https://api.commerce.naver.com';

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export interface NaverChannelProduct {
  originProductNo: number;
  channelProductNo: number;
  channelServiceType: string;
  categoryId: string;
  name: string;
  statusType: string;
  salePrice: number;
  discountedPrice: number;
  stockQuantity: number;
  deliveryFee: number;
  returnFee: number;
  exchangeFee: number;
  wholeCategoryName: string;
  representativeImage: { url: string } | null;
  sellerTags: { text: string; code?: number }[];
  regDate: string;
  modifiedDate: string;
}

export interface NaverProductSearchResult {
  contents: {
    originProductNo: number;
    channelProducts: NaverChannelProduct[];
  }[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export interface NaverCategory {
  id: string;
  name: string;
  wholeCategoryName: string;
  last: boolean;
}

// ─────────────────────────────────────────────────────────────
// 클라이언트
// ─────────────────────────────────────────────────────────────

export class NaverCommerceClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    this.clientId = process.env.NAVER_COMMERCE_CLIENT_ID ?? '';
    this.clientSecret = process.env.NAVER_COMMERCE_CLIENT_SECRET ?? '';

    if (!this.clientId || !this.clientSecret) {
      throw new Error('[네이버] NAVER_COMMERCE_CLIENT_ID, NAVER_COMMERCE_CLIENT_SECRET 환경변수가 필요합니다.');
    }
  }

  // ─── 토큰 발급 ────────────────────────────────────────────

  private async getToken(): Promise<string> {
    // 캐싱된 토큰이 유효하면 재사용
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const timestamp = Date.now();
    const password = this.clientId + '_' + timestamp;
    const hashed = bcrypt.hashSync(password, this.clientSecret);
    const sign = Buffer.from(hashed).toString('base64');

    const res = await proxyFetch(`${API_HOST}/external/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        timestamp: String(timestamp),
        client_secret_sign: sign,
        grant_type: 'client_credentials',
        type: 'SELF',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[네이버] 토큰 발급 실패: ${res.status} — ${body}`);
    }

    const json = await res.json();
    this.accessToken = json.access_token;
    // 만료 1분 전에 갱신하도록 설정
    this.tokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;

    return this.accessToken!;
  }

  // ─── 공통 요청 ─────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken();

    const res = await proxyFetch(API_HOST + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();

    if (!res.ok) {
      let errMsg: string;
      try {
        const errJson = JSON.parse(text);
        errMsg = errJson.message || errJson.error || text;
      } catch {
        errMsg = text;
      }
      throw new Error(`[네이버 API] ${res.status}: ${errMsg}`);
    }

    return text ? JSON.parse(text) as T : {} as T;
  }

  // ─── 인증 테스트 ───────────────────────────────────────────

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }

  // ─── 상품 목록 조회 ───────────────────────────────────────

  async searchProducts(
    page: number = 1,
    size: number = 20,
    statusType?: string,
  ): Promise<NaverProductSearchResult> {
    const body: Record<string, unknown> = { page, size };
    if (statusType) {
      body.productStatusTypes = [statusType];
    }

    return this.request<NaverProductSearchResult>(
      'POST',
      '/external/v1/products/search',
      body,
    );
  }

  // ─── 상품 상세 조회 ───────────────────────────────────────

  async getProductDetail(originProductNo: number): Promise<unknown> {
    return this.request<unknown>(
      'GET',
      `/external/v2/products/origin-products/${originProductNo}`,
    );
  }

  // ─── 상품 등록 ────────────────────────────────────────────

  async registerProduct(payload: Record<string, unknown>): Promise<{ originProductNo: number; smartstoreChannelProductNo: number }> {
    const res = await this.request<{ originProductNo: number; smartstoreChannelProductNo: number }>(
      'POST',
      '/external/v2/products',
      payload,
    );
    return res;
  }

  // ─── 상품 수정 ────────────────────────────────────────────

  async updateProduct(originProductNo: number, payload: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>(
      'PUT',
      `/external/v2/products/origin-products/${originProductNo}`,
      payload,
    );
  }

  // ─── 카테고리 조회 ────────────────────────────────────────

  async getCategories(): Promise<NaverCategory[]> {
    return this.request<NaverCategory[]>('GET', '/external/v1/categories');
  }

  // ─── 카테고리 검색 (키워드) ────────────────────────────────

  async searchCategories(keyword: string, limit: number = 30): Promise<NaverCategory[]> {
    const all = await this.getCategories();
    const kw = keyword.toLowerCase();
    return all
      .filter((c) => c.last && c.wholeCategoryName.toLowerCase().includes(kw))
      .slice(0, limit);
  }
}

// ─────────────────────────────────────────────────────────────
// 싱글톤
// ─────────────────────────────────────────────────────────────

let _client: NaverCommerceClient | null = null;

export function getNaverCommerceClient(): NaverCommerceClient {
  if (!_client) {
    _client = new NaverCommerceClient();
  }
  return _client;
}
