/**
 * 쿠팡 OPEN API 클라이언트
 *
 * 인증: HMAC-SHA256 서명 (CEA 방식)
 * 문서: https://developers.coupangcorp.com
 */

import crypto from 'crypto';
import { proxyFetch } from '@/lib/proxy-fetch';

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const API_HOST = 'https://api-gateway.coupang.com';
const API_DELAY = 200;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export interface CoupangOrderItem {
  vendorItemPackageName: string;
  productId: number;
  vendorItemId: number;
  vendorItemName: string;
  sellerProductId: number;
  sellerProductName: string;
  sellerProductItemName: string;
  shippingCount: number;
  salesPrice: number;
  orderPrice: number;
  discountPrice: number;
  cancelCount: number;
  estimatedShippingDate: string;
  canceled: boolean;
}

export interface CoupangOrder {
  shipmentBoxId: number;
  orderId: number;
  orderedAt: string;
  paidAt: string | null;
  status: string;
  shippingPrice: number;
  remoteArea: boolean;
  parcelPrintMessage: string;
  splitShipping: boolean;
  orderer: { name: string; email: string; safeNumber: string } | null;
  receiver: {
    name: string;
    safeNumber: string;
    addr1: string;
    addr2: string;
    postCode: string;
  } | null;
  orderItems: CoupangOrderItem[];
  deliveryCompanyName: string;
  invoiceNumber: string;
  inTrasitDateTime: string;
  deliveredDate: string;
}

export interface CoupangSellerProduct {
  sellerProductId: number;
  sellerProductName: string;
  displayCategoryCode: number;
  productId: number;
  vendorId: string;
  brand: string;
  statusName: string;
  createdAt: string;
  saleStartedAt: string;
  saleEndedAt: string;
}

export interface CoupangCategory {
  displayCategoryCode: number;
  displayCategoryName: string;
  children?: CoupangCategory[];
}

/** 상품 등록 요청 바디 (필수 필드) */
export interface CoupangProductPayload {
  displayCategoryCode: number;
  sellerProductName: string;
  vendorId: string;
  saleStartedAt: string;
  saleEndedAt: string;
  brand: string;
  generalProductName: string;
  deliveryInfo: {
    deliveryType: string;           // ROCKET | NORMAL
    deliveryAttributeType: string;  // OVERSEA_DELIVERY | COLD_FRESH | ...
    deliveryCompanyCode: string;
    deliveryChargeType: string;     // FREE | NOT_FREE | ...
    deliveryCharge: number;
    freeShipOverAmount: number;
    deliveryChargeOnReturn: number;
    returnCenterCode: string;
    outboundShippingPlaceCode: string;
  };
  returnCharge: number;
  items: CoupangProductItem[];
}

export interface CoupangProductItem {
  itemName: string;
  originalPrice: number;
  salePrice: number;
  maximumBuyCount: number;
  maximumBuyForPerson: number;
  unitCount: number;
  images: { imageOrder: number; imageType: string; vendorPath: string }[];
  attributes: { attributeTypeName: string; attributeValueName: string }[];
  contents: { contentsType: string; contentDetails: { content: string; detailType: string }[] }[];
  notices: { noticeCategoryName: string; noticeCategoryDetailName: string; content: string }[];
}

export interface CoupangApiResponse<T = unknown> {
  code: string;
  message: string;
  data?: T;
  nextToken?: string;
}

// ─────────────────────────────────────────────────────────────
// 클라이언트
// ─────────────────────────────────────────────────────────────

export class CoupangClient {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly vendorId: string;

  constructor() {
    this.accessKey = process.env.COUPANG_ACCESS_KEY ?? '';
    this.secretKey = process.env.COUPANG_SECRET_KEY ?? '';
    this.vendorId = process.env.COUPANG_VENDOR_ID ?? '';

    if (!this.accessKey || !this.secretKey || !this.vendorId) {
      throw new Error('[쿠팡] COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY, COUPANG_VENDOR_ID 환경변수가 필요합니다.');
    }
  }

  get vendor() { return this.vendorId; }

  // ─── HMAC 서명 생성 ────────────────────────────────────────

  private generateAuth(method: string, urlWithQuery: string): string {
    const [path, ...qParts] = urlWithQuery.split('?');
    const query = qParts.join('?') || '';

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const datetime =
      String(now.getUTCFullYear()).slice(2) +
      pad(now.getUTCMonth() + 1) +
      pad(now.getUTCDate()) +
      'T' +
      pad(now.getUTCHours()) +
      pad(now.getUTCMinutes()) +
      pad(now.getUTCSeconds()) +
      'Z';

    // 구분자 없이 단순 연결
    const message = datetime + method.toUpperCase() + path + query;
    const signature = crypto.createHmac('sha256', this.secretKey).update(message).digest('hex');

    return `CEA algorithm=HmacSHA256, access-key=${this.accessKey}, signed-date=${datetime}, signature=${signature}`;
  }

  // ─── 공통 요청 ─────────────────────────────────────────────

  private async request<T>(method: string, urlWithQuery: string, body?: unknown): Promise<CoupangApiResponse<T>> {
    const auth = this.generateAuth(method, urlWithQuery);

    const res = await proxyFetch(API_HOST + urlWithQuery, {
      method,
      headers: {
        Authorization: auth,
        'X-Requested-By': this.accessKey,
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`[쿠팡 API] ${res.status}: ${text}`);
    }

    return JSON.parse(text) as CoupangApiResponse<T>;
  }

  // ─── 인증 테스트 (판매자 상품 1건 조회) ────────────────────

  async validateCredentials(): Promise<boolean> {
    try {
      const url = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products?vendorId=${this.vendorId}&nextToken=&maxPerPage=1&status=APPROVED`;
      const res = await this.request<CoupangSellerProduct[]>('GET', url);
      return res.code === 'SUCCESS';
    } catch {
      return false;
    }
  }

  // ─── 판매자 상품 목록 조회 ─────────────────────────────────

  async getSellerProducts(
    status: string = 'APPROVED',
    maxPerPage: number = 20,
    nextToken: string = '',
  ): Promise<{ items: CoupangSellerProduct[]; nextToken: string | null }> {
    const url =
      `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products` +
      `?vendorId=${this.vendorId}&nextToken=${nextToken}&maxPerPage=${maxPerPage}&status=${status}`;

    const res = await this.request<CoupangSellerProduct[]>('GET', url);

    return {
      items: res.data ?? [],
      nextToken: res.nextToken ?? null,
    };
  }

  // ─── 카테고리 조회 ─────────────────────────────────────────

  async getCategoryTree(): Promise<unknown> {
    const path = `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories`;
    const res = await this.request<unknown>('GET', path);
    return res.data ?? {};
  }

  // ─── 상품 등록 ─────────────────────────────────────────────

  async registerProduct(
    payload: CoupangProductPayload,
  ): Promise<{ sellerProductId: number }> {
    const url = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;

    const res = await this.request<{ sellerProductId: number }>('POST', url, payload);

    if (res.code !== 'SUCCESS' || !res.data) {
      throw new Error(`[쿠팡] 상품 등록 실패: ${res.message}`);
    }

    return res.data;
  }

  // ─── 상품 상세 조회 ───────────────────────────────────────

  async getProductDetail(sellerProductId: number): Promise<unknown> {
    const url = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${sellerProductId}`;
    const res = await this.request<unknown>('GET', url);
    if (res.code !== 'SUCCESS' || !res.data) {
      throw new Error(`[쿠팡] 상품 조회 실패: ${res.message}`);
    }
    return res.data;
  }

  // ─── 상품 수정 ────────────────────────────────────────────

  async updateProduct(
    sellerProductId: number,
    payload: CoupangProductPayload,
  ): Promise<{ sellerProductId: number }> {
    const url = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;
    // 쿠팡 수정 API는 PUT + sellerProductId를 payload에 포함
    const body = { ...payload, sellerProductId };
    const res = await this.request<{ sellerProductId: number }>('PUT', url, body);

    if (res.code !== 'SUCCESS') {
      throw new Error(`[쿠팡] 상품 수정 실패: ${res.message}`);
    }

    return res.data ?? { sellerProductId };
  }

  // ─── 출고지/반품지 조회 ────────────────────────────────────

  async getOutboundShippingPlaces(): Promise<unknown[]> {
    const url = `/v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/outboundShippingCenters`;
    const res = await this.request<unknown[]>('GET', url);
    return res.data ?? [];
  }

  async getReturnShippingCenters(): Promise<unknown[]> {
    const url = `/v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/returnShippingCenters`;
    const res = await this.request<unknown[]>('GET', url);
    return res.data ?? [];
  }

  // ─── 주문 목록 조회 ────────────────────────────────────────

  async getOrders(params: {
    createdAtFrom: string;  // YYYY-MM-DD
    createdAtTo: string;    // YYYY-MM-DD
    status?: string;        // ACCEPT | INSTRUCT | DEPARTURE | DELIVERING | FINAL_DELIVERY | CANCEL_REQUEST | CANCEL_DONE
    maxPerPage?: number;
    nextToken?: string;
  }): Promise<{ items: CoupangOrder[]; nextToken: string | null }> {
    // 쿼리 문자열 수동 조립
    const parts: string[] = [
      `createdAtFrom=${params.createdAtFrom}`,
      `createdAtTo=${params.createdAtTo}`,
      `status=${params.status ?? 'ACCEPT'}`,  // status 필수
    ];
    if (params.maxPerPage) parts.push(`maxPerPage=${params.maxPerPage}`);
    if (params.nextToken) parts.push(`nextToken=${params.nextToken}`);

    const url = `/v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/ordersheets?${parts.join('&')}`;
    await sleep(API_DELAY);
    try {
      const res = await this.request<CoupangOrder[]>('GET', url);
      return {
        items: res.data ?? [],
        nextToken: res.nextToken ?? null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${msg} || 호출URL: ${API_HOST}${url}`);
    }
  }

  // ─── 주문 상세 조회 ────────────────────────────────────────

  async getOrderDetail(orderId: number): Promise<CoupangOrder> {
    const url = `/v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/ordersheets/${orderId}`;
    await sleep(API_DELAY);
    const res = await this.request<CoupangOrder>('GET', url);
    if (!res.data) throw new Error(`[쿠팡] 주문 조회 실패: ${res.message}`);
    return res.data;
  }
}

// ─────────────────────────────────────────────────────────────
// 싱글톤
// ─────────────────────────────────────────────────────────────

let _client: CoupangClient | null = null;

export function getCoupangClient(): CoupangClient {
  if (!_client) {
    _client = new CoupangClient();
  }
  return _client;
}
