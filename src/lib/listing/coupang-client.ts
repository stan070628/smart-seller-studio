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
  // 배송 정보 (최상위 레벨 — 쿠팡 v2 API 구조)
  deliveryMethod: string;            // SEQUENCIAL | VENDOR_DIRECT
  deliveryCompanyCode: string;
  deliveryChargeType: string;        // FREE | NOT_FREE
  deliveryCharge: number;
  freeShipOverAmount: number;
  deliveryChargeOnReturn: number;
  deliverySurcharge: number;
  remoteAreaDeliverable: string;     // Y | N
  bundlePackingDelivery: number;     // 0 | 1
  unionDeliveryType: string;         // NOT_UNION_DELIVERY | UNION_DELIVERY
  returnCenterCode: string;
  outboundShippingPlaceCode: string;
  returnChargeName: string;
  companyContactNumber: string;
  returnZipCode: string;
  returnAddress: string;
  returnAddressDetail: string;
  returnCharge: number;
  vendorUserId: string;
  items: CoupangProductItem[];
  // 하위 호환용 (이전 코드 참조 시)
  deliveryInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CoupangProductItem {
  itemName: string;
  originalPrice: number;
  salePrice: number;
  maximumBuyCount: number;
  maximumBuyForPerson: number;
  maximumBuyForPersonPeriod?: number;
  outboundShippingTimeDay?: number;
  unitCount: number;
  adultOnly?: string;            // EVERYONE | ADULT_ONLY
  taxType?: string;              // TAX | FREE
  overseasPurchased?: string;    // NOT_OVERSEAS_PURCHASED | OVERSEAS_PURCHASED
  parallelImported?: string;     // NOT_PARALLEL_IMPORTED | PARALLEL_IMPORTED
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

  // ─── 카테고리 메타 (고시정보 등) ────────────────────────────

  async getCategoryMeta(displayCategoryCode: number): Promise<Record<string, unknown>> {
    const url = `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/${displayCategoryCode}`;
    const res = await this.request<Record<string, unknown>>('GET', url);
    return (res.data ?? {}) as Record<string, unknown>;
  }

  // 카테고리 코드로 fullPath 조회 (트리 캐시 활용)
  async findCategoryFullPath(code: number): Promise<string | null> {
    const now = Date.now();
    if (!categoryTreeCache || now - categoryTreeCache.ts > 5 * 60 * 1000) {
      const raw = await this.getCategoryTree();
      categoryTreeCache = { data: raw, ts: now };
    }
    const rawData = categoryTreeCache.data;
    let roots: CoupangCategory[];
    if (Array.isArray(rawData)) {
      roots = normalizeCategoryNodes(rawData);
    } else if (rawData && typeof rawData === 'object') {
      const obj = rawData as Record<string, unknown>;
      if (Array.isArray(obj['data'])) roots = normalizeCategoryNodes(obj['data'] as unknown[]);
      else if (Array.isArray(obj['children'])) roots = normalizeCategoryNodes(obj['children'] as unknown[]);
      else if (Array.isArray(obj['child'])) roots = normalizeCategoryNodes(obj['child'] as unknown[]);
      else roots = normalizeCategoryNodes([rawData]);
    } else {
      roots = [];
    }
    const all = flattenCategories(roots, '');
    return all.find((c) => c.displayCategoryCode === code)?.fullPath ?? null;
  }

  // ─── 카테고리 조회 ─────────────────────────────────────────

  async getCategoryTree(): Promise<unknown> {
    const path = `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories`;
    const res = await this.request<unknown>('GET', path);
    return res.data ?? {};
  }

  /**
   * 카테고리 트리를 flatten하여 keyword로 필터링한 결과를 반환합니다.
   *
   * - getCategoryTree()로 전체 트리를 fetch하고 모듈 스코프에 5분간 캐시
   * - 각 노드에 조상 이름을 "/" 로 이어붙인 fullPath 생성
   * - fullPath에 keyword가 포함된 항목을 필터링 (대소문자 무시)
   * - 리프 노드(children 없는 것)를 우선하여 최대 8개 반환
   */
  async searchCategories(keyword: string): Promise<{
    displayCategoryCode: number;
    displayCategoryName: string;
    fullPath: string;
  }[]> {
    // 캐시 히트 확인 (5분 = 300,000ms)
    const now = Date.now();
    if (!categoryTreeCache || now - categoryTreeCache.ts > 5 * 60 * 1000) {
      const raw = await this.getCategoryTree();
      categoryTreeCache = { data: raw, ts: now };
    }

    // 트리를 배열로 정규화 (방어적 파싱)
    const rawData = categoryTreeCache.data;
    let roots: CoupangCategory[];
    if (Array.isArray(rawData)) {
      roots = normalizeCategoryNodes(rawData);
    } else if (rawData && typeof rawData === 'object') {
      // { data: [...] } 혹은 { displayCategoryCode: ..., children: [...] } 형태 대응
      const obj = rawData as Record<string, unknown>;
      if (Array.isArray(obj['data'])) {
        roots = normalizeCategoryNodes(obj['data'] as unknown[]);
      } else if (Array.isArray(obj['children'])) {
        roots = normalizeCategoryNodes(obj['children'] as unknown[]);
      } else if (Array.isArray(obj['child'])) {
        roots = normalizeCategoryNodes(obj['child'] as unknown[]);
      } else {
        roots = normalizeCategoryNodes([rawData]);
      }
    } else {
      roots = [];
    }

    // 전체 flatten (fullPath 포함)
    const all = flattenCategories(roots, '');

    // keyword 필터링 (대소문자 무시)
    const lower = keyword.toLowerCase();
    const matched = all.filter((c) => c.fullPath.toLowerCase().includes(lower));

    // 리프 노드 우선 정렬 후 최대 8개
    const leaves = matched.filter((c) => c.isLeaf);
    const nonLeaves = matched.filter((c) => !c.isLeaf);
    const sorted = [...leaves, ...nonLeaves];

    return sorted.slice(0, 8).map(({ displayCategoryCode, displayCategoryName, fullPath }) => ({
      displayCategoryCode,
      displayCategoryName,
      fullPath,
    }));
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

  // ─── 상품 삭제 ────────────────────────────────────────────

  async deleteProduct(sellerProductId: number): Promise<void> {
    await this.request('DELETE', `/v2/providers/seller_api/apis/api/v4/products/${sellerProductId}`);
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

  /**
   * 출고지 코드 반환.
   * 쿠팡 v4 GET 목록 API 폐기(410), v5에 GET 없음.
   * → 환경변수 COUPANG_OUTBOUND_CODE에서 조회. 미설정 시 에러.
   */
  getOutboundShippingPlaceCode(): string {
    const code = process.env.COUPANG_OUTBOUND_CODE ?? '';
    if (!code) {
      throw new Error(
        '[쿠팡] COUPANG_OUTBOUND_CODE 환경변수를 설정해주세요. ' +
        '쿠팡 Wing > 배송/반품 관리 > 출고지 관리에서 확인 가능합니다.',
      );
    }
    return code;
  }

  /**
   * 반품지 코드 반환.
   * → 환경변수 COUPANG_RETURN_CENTER_CODE에서 조회.
   */
  getReturnCenterCode(): string {
    const code = process.env.COUPANG_RETURN_CENTER_CODE ?? '';
    if (!code) {
      throw new Error(
        '[쿠팡] COUPANG_RETURN_CENTER_CODE 환경변수를 설정해주세요. ' +
        '쿠팡 Wing > 배송/반품 관리 > 반품지 관리에서 확인 가능합니다.',
      );
    }
    return code;
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
// 카테고리 트리 캐시 & 헬퍼
// ─────────────────────────────────────────────────────────────

/** 모듈 스코프 캐시 (5분 TTL) */
let categoryTreeCache: { data: unknown; ts: number } | null = null;

/** flatten 결과 내부 타입 */
interface FlatCategory {
  displayCategoryCode: number;
  displayCategoryName: string;
  fullPath: string;
  isLeaf: boolean;
}

/**
 * unknown[] 배열을 CoupangCategory[]로 방어적 변환합니다.
 * 필드가 없거나 타입이 맞지 않으면 해당 노드는 건너뜁니다.
 */
function normalizeCategoryNodes(nodes: unknown[]): CoupangCategory[] {
  const result: CoupangCategory[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    // API는 displayItemCategoryCode/name/child, 내부 표현은 displayCategoryCode/displayCategoryName/children
    const rawCode = obj['displayCategoryCode'] ?? obj['displayItemCategoryCode'];
    const code = typeof rawCode === 'number' ? rawCode : Number(rawCode);
    const name = (typeof obj['displayCategoryName'] === 'string' ? obj['displayCategoryName']
      : typeof obj['name'] === 'string' ? obj['name']
      : String(obj['displayCategoryName'] ?? obj['name'] ?? ''));
    if (!isFinite(code) || !name || name === 'ROOT') continue;
    const rawChildren = Array.isArray(obj['children']) ? obj['children']
      : Array.isArray(obj['child']) ? obj['child']
      : undefined;
    const children = rawChildren ? normalizeCategoryNodes(rawChildren as unknown[]) : undefined;
    result.push({ displayCategoryCode: code, displayCategoryName: name, children });
  }
  return result;
}

/**
 * 카테고리 트리를 재귀적으로 순회하여 모든 노드를 flat 배열로 반환합니다.
 * @param nodes - 현재 레벨의 카테고리 배열
 * @param parentPath - 상위 노드들의 이름을 "/" 로 이어붙인 경로
 */
function flattenCategories(nodes: CoupangCategory[], parentPath: string): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const node of nodes) {
    const currentPath = parentPath
      ? `${parentPath}/${node.displayCategoryName}`
      : node.displayCategoryName;
    const isLeaf = !node.children || node.children.length === 0;
    result.push({
      displayCategoryCode: node.displayCategoryCode,
      displayCategoryName: node.displayCategoryName,
      fullPath: currentPath,
      isLeaf,
    });
    if (!isLeaf) {
      result.push(...flattenCategories(node.children!, currentPath));
    }
  }
  return result;
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
