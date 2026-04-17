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

export interface NaverOrder {
  productOrderId: string;
  orderId: string;
  orderDate: string;
  paymentDate?: string;   // 실제 네이버 API 필드명
  payDate?: string;       // 혹시 다른 버전에서 사용할 수 있는 필드
  productOrderStatus: string;
  claimStatus: string | null;
  productName: string;
  productId: string;
  productQuantity?: number;  // 실제 네이버 API 필드명
  quantity?: number;          // 대체 필드명 대비
  productPayAmount?: number;  // 실제 네이버 API 필드명 (결제금액)
  totalPaymentAmount?: number; // 대체 필드명 대비
  deliveryFeeAmount?: number;
  ordererName?: string;
  ordererTel?: string | null;
  shippingAddress: {
    name: string;
    tel1: string | null;
    baseAddress: string;
    detailAddress: string;
    zipCode: string;
  } | null;
  deliveryCompany: string | null;
  trackingNumber: string | null;
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
        // invalidInputs 필드가 있으면 상세 필드별 오류 표시
        const details = errJson.invalidInputs
          ? errJson.invalidInputs.map((i: { name?: string; message?: string }) => `${i.name}: ${i.message}`).join(', ')
          : '';
        errMsg = (errJson.message || errJson.error || text) + (details ? ` [${details}]` : '');
      } catch {
        errMsg = text;
      }
      console.error('[네이버 API] 에러 응답 전문:', text.slice(0, 1000));
      throw new Error(`[네이버 API] ${res.status}: ${errMsg}`);
    }

    return text ? JSON.parse(text) as T : {} as T;
  }

  // ─── 이미지 업로드 (multipart/form-data) ────────────────────

  /**
   * 외부 이미지 URL을 네이버 CDN에 업로드하고 네이버 이미지 URL을 반환한다.
   * 네이버 상품 등록 시 반드시 이 URL을 사용해야 함 (외부 URL 직접 사용 불가).
   */
  async uploadImageFromUrl(imageUrl: string): Promise<string> {
    // 1. 외부 이미지 다운로드
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) throw new Error(`이미지 다운로드 실패: ${imageUrl} (${imgRes.status})`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // 파일명 추출
    const urlPath = new URL(imageUrl).pathname;
    const filename = urlPath.split('/').pop() || 'image.jpg';

    // 2. 네이버 이미지 업로드 API 호출
    const token = await this.getToken();
    const boundary = `----NaverImageUpload${Date.now()}`;

    const bodyParts: Buffer[] = [];
    // multipart form field: imageFiles
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="imageFiles"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
    bodyParts.push(Buffer.from(header, 'utf-8'));
    bodyParts.push(buffer);
    bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'));

    const multipartBody = Buffer.concat(bodyParts);

    const res = await proxyFetch(`${API_HOST}/external/v1/product-images/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(multipartBody.length),
      },
      body: multipartBody,
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('[네이버 이미지 업로드] 에러:', text.slice(0, 500));
      throw new Error(`[네이버] 이미지 업로드 실패: ${res.status}`);
    }

    const json = JSON.parse(text);
    const naverUrl = json.images?.[0]?.url;
    if (!naverUrl) throw new Error('[네이버] 이미지 업로드 응답에 URL 없음');

    return naverUrl;
  }

  /**
   * 여러 이미지를 순차 업로드하고 네이버 URL 배열을 반환한다.
   */
  async uploadImagesFromUrls(imageUrls: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const url of imageUrls) {
      try {
        const naverUrl = await this.uploadImageFromUrl(url);
        results.push(naverUrl);
      } catch (e) {
        console.warn('[네이버 이미지 업로드] 스킵:', url, e);
      }
    }
    return results;
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

  async registerProduct(
    payload: Record<string, unknown>,
    _retry = true,
  ): Promise<{ originProductNo: number; smartstoreChannelProductNo: number }> {
    try {
      return await this.request<{ originProductNo: number; smartstoreChannelProductNo: number }>(
        'POST',
        '/external/v2/products',
        payload,
      );
    } catch (err) {
      if (!_retry) throw err;

      const msg = err instanceof Error ? err.message : '';

      // 400 검증 오류에서 문제 필드를 제거하고 임시저장으로 재시도
      // 현재 알려진 문제 필드: productCertificationInfos
      const REMOVABLE_FIELDS: { path: string[]; keyword: string }[] = [
        { path: ['originProduct', 'detailAttribute', 'productCertificationInfos'], keyword: 'productCertificationInfos' },
      ];

      const matched = REMOVABLE_FIELDS.find((f) => msg.includes(f.keyword));
      if (!matched) throw err;

      console.warn(`[네이버] ${matched.keyword} 오류 → 해당 필드 제거 후 임시저장으로 재시도`);

      const fallback = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      // path를 따라 내려가며 마지막 키를 delete
      let node: Record<string, unknown> = fallback;
      for (let i = 0; i < matched.path.length - 1; i++) {
        node = node[matched.path[i]] as Record<string, unknown>;
        if (!node) break;
      }
      if (node) delete node[matched.path[matched.path.length - 1]];

      return this.registerProduct(fallback, false);
    }
  }

  // ─── 상품 수정 ────────────────────────────────────────────

  async updateProduct(originProductNo: number, payload: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>(
      'PUT',
      `/external/v2/products/origin-products/${originProductNo}`,
      payload,
    );
  }

  // ─── 주문 목록 조회 ───────────────────────────────────────────

  /**
   * 네이버 주문 조회 — 2단계 프로세스
   *
   * Step 1: last-changed-statuses → productOrderId 목록 수집
   *   - 엔드포인트: GET /external/v1/pay-order/seller/product-orders/last-changed-statuses
   *   - 24시간 단위만 허용 → 날짜별로 순차 조회
   *   - 유효한 lastChangedType: PAYED | DISPATCHED | PURCHASE_DECIDED |
   *                              EXCHANGED | CANCELED | RETURNED | ABSENTED | CLAIMED | CLAIM_REJECTED_BY_SELLER
   *   - DELIVERING / DELIVERED 는 유효하지 않음
   *
   * Step 2: product-orders/query → 상세 정보 조회
   *   - 엔드포인트: POST /external/v1/pay-order/seller/product-orders/query
   */
  async getOrders(params: {
    fromDate: string;  // "2024-01-01" (YYYY-MM-DD)
    toDate: string;    // "2024-01-07"
  }): Promise<{ contents: NaverOrder[] }> {
    const VALID_STATUSES = [
      'PAYED',
      'DISPATCHED',
      'PURCHASE_DECIDED',
      'EXCHANGED',
      'CANCELED',
      'RETURNED',
    ];

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // 날짜 범위를 하루씩 순회
    const from = new Date(params.fromDate);
    const to   = new Date(params.toDate);
    const productOrderIds = new Set<string>();

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      for (const status of VALID_STATUSES) {
        await sleep(120); // rate limit 방지
        try {
          const query = new URLSearchParams({
            lastChangedFrom: `${dateStr}T00:00:00.000+09:00`,
            lastChangedTo:   `${dateStr}T23:59:59.000+09:00`,
            lastChangedType: status,
          });
          const res = await this.request<{ data?: { productOrderIds?: string[] } }>(
            'GET',
            `/external/v1/pay-order/seller/product-orders/last-changed-statuses?${query.toString()}`,
          );
          const ids = res.data?.productOrderIds ?? [];
          ids.forEach((id) => productOrderIds.add(id));
        } catch (err) {
          console.warn(`[네이버 주문] ${dateStr} ${status} 조회 실패:`, err instanceof Error ? err.message : err);
        }
      }
    }

    if (productOrderIds.size === 0) {
      console.info('[네이버 주문] 해당 기간 주문 없음');
      return { contents: [] };
    }

    // Step 2: 상세 조회
    console.info(`[네이버 주문] 상세 조회: ${productOrderIds.size}건`);
    const detail = await this.request<{ data?: { contents?: NaverOrder[] } }>(
      'POST',
      '/external/v1/pay-order/seller/product-orders/query',
      { productOrderIds: Array.from(productOrderIds) },
    );

    return { contents: detail.data?.contents ?? [] };
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
