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

export interface NaverAddressBook {
  addressBookNo: number;
  name: string;
  /** RELEASE=출고지, REFUND_OR_EXCHANGE=반품교환지 */
  addressType: 'RELEASE' | 'REFUND_OR_EXCHANGE' | string;
  address: string;
  phoneNumber1?: string;
}

// product-orders/query API 실제 응답 구조 (data 배열의 각 원소)
// 🔴 order.ordererName·ordererTel·productOrder.shippingAddress는 구매자 개인정보다 — 주문 수집(erp/orders/adapters/naver.ts)은 버린다
export interface NaverOrderRawItem {
  order: {
    orderId: string;
    orderDate: string;
    ordererName?: string;
    ordererTel?: string;
    paymentDate?: string;
  };
  productOrder: {
    productOrderId: string;
    productName: string;
    productId?: string;
    /** 원상품번호(originProductNo) — ERP 리스팅의 external_product_id */
    originalProductId?: string;
    /**
     * 옵션 조합 id — ERP 리스팅의 external_option_key(= optionCombinations[].id).
     * 🔴 칸 이름은 itemNo다. optionCode라는 칸은 응답에 없다(2026-09-27 운영 실측 — 설계 때 추정한 이름이라 9월 8건이 전부 미귀속됐다)
     */
    itemNo?: string;
    claimType?: string;
    claimStatus?: string;
    quantity: number;
    /** 처음 주문 수량(부분 취소 전) */
    initialQuantity?: number;
    /** 부분 취소·반품 뒤 남은 수량 — 0이면 전부 취소 */
    remainQuantity?: number;
    totalPaymentAmount: number;
    productOrderStatus: string;
    deliveryFeeAmount?: number;
    unitPrice?: number;
    productOption?: string;
    shippingAddress?: {
      name: string;
      tel1?: string;
      baseAddress: string;
      detailedAddress?: string;
      zipCode: string;
    } | null;
  };
  delivery?: {
    deliveryCompany?: string;
    trackingNumber?: string;
    deliveryStatus?: string;
  };
  claim?: {
    claimStatus?: string;
  } | null;
}

// 내부 정규화 타입 (route.ts에서 사용)
export interface NaverOrder {
  productOrderId: string;
  orderId: string;
  orderDate: string;
  productOrderStatus: string;
  claimStatus: string | null;
  productName: string;
  channelProductNo: number | null;
  /** 원상품번호 — 2026-09-26까지 버려지던 칸(ERP 1-C2a에서 살림) */
  originalProductId?: string | null;
  /** 옵션 조합 id(상품주문의 itemNo) */
  itemNo?: string | null;
  quantity: number;
  totalPaymentAmount: number;
  deliveryFeeAmount: number;
  productOption: string | null;
  shippingAddress: {
    name: string;
    tel1: string | null;
    baseAddress: string;
    detailedAddress: string;
    zipCode: string;
  } | null;
  deliveryCompany: string | null;
  trackingNumber: string | null;
}

function normalizeNaverOrder(raw: NaverOrderRawItem): NaverOrder {
  const { order, productOrder, delivery, claim } = raw;
  return {
    productOrderId: productOrder.productOrderId,
    orderId: order.orderId,
    orderDate: order.orderDate,
    productOrderStatus: productOrder.productOrderStatus,
    claimStatus: claim?.claimStatus ?? null,
    productName: productOrder.productName,
    channelProductNo: productOrder.productId ? Number(productOrder.productId) || null : null,
    originalProductId: productOrder.originalProductId ?? null,
    itemNo: productOrder.itemNo ?? null,
    quantity: productOrder.quantity,
    totalPaymentAmount: productOrder.totalPaymentAmount,
    deliveryFeeAmount: productOrder.deliveryFeeAmount ?? 0,
    productOption: productOrder.productOption ?? null,
    shippingAddress: productOrder.shippingAddress
      ? {
          name: productOrder.shippingAddress.name,
          tel1: productOrder.shippingAddress.tel1 ?? null,
          baseAddress: productOrder.shippingAddress.baseAddress,
          detailedAddress: productOrder.shippingAddress.detailedAddress ?? '',
          zipCode: productOrder.shippingAddress.zipCode,
        }
      : null,
    deliveryCompany: delivery?.deliveryCompany ?? null,
    trackingNumber: delivery?.trackingNumber ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// 클라이언트
// ─────────────────────────────────────────────────────────────

/**
 * 네이버 오류 응답 요약 — 로그·오류 문구용. JSON이면 message(없으면 error)·code·invalidInputs(칸 이름: 설명)만,
 * JSON이 아니면 길이만 남긴다. 등록 재시도(registerProduct)가 invalidInputs 칸 이름으로 고르므로 그것은 남긴다.
 */
export function naverErrorSummary(text: string): string {
  try {
    const j = JSON.parse(text) as { code?: unknown; message?: unknown; error?: unknown; invalidInputs?: { name?: string; message?: string }[] };
    const msg = String(j.message ?? j.error ?? '').slice(0, 300);
    // M4 — 500자에서 자르면 registerProduct 재시도가 찾는 칸 이름이 뒤쪽 항목에서 잘려나갔다. 2000자로 올린다
    const details = Array.isArray(j.invalidInputs)
      ? j.invalidInputs.map((i) => `${String(i?.name ?? '')}: ${String(i?.message ?? '')}`).join(', ').slice(0, 2000)
      : '';
    return `${msg}${j.code !== undefined ? ` (code=${String(j.code)})` : ''}${details ? ` [${details}]` : ''}`;
  } catch {
    return `JSON 아닌 응답 ${Buffer.byteLength(text ?? '', 'utf8')}바이트 — 본문 생략`;
  }
}

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
      // 응답 본문은 싣지 않는다 — 주문 조회 응답에는 구매자 이름·전화·주소가 있다(M6). code·message·invalidInputs만
      const summary = naverErrorSummary(text);
      console.error(`[네이버 API] ${method} ${path} → HTTP ${res.status} | ${summary}`);
      throw new Error(`[네이버 API] ${res.status}: ${summary}`);
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

  // channelProductNo → originProductNo + 옵션 조회
  // 네이버 API: GET /external/v2/products/channel-products/{channelProductNo}
  async getChannelProductDetail(channelProductNo: number): Promise<unknown> {
    return this.request<unknown>(
      'GET',
      `/external/v2/products/channel-products/${channelProductNo}`,
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
    // 네이버 API가 허용하는 lastChangedType (상태 변경 이벤트 타입).
    // DELIVERING/DELIVERED는 400 반환 — 배송중·배송완료 주문은 DISPATCHED 이벤트로 잡힘.
    const VALID_STATUSES = ['PAYED', 'DISPATCHED', 'PURCHASE_DECIDED'];

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // 날짜 범위를 하루씩 순회 (24시간 단위 제한)
    const from = new Date(params.fromDate);
    const to   = new Date(params.toDate);
    const productOrderIds = new Set<string>();

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      for (const status of VALID_STATUSES) {
        await sleep(500); // rate limit 방지 (Naver API: 429 방어)
        try {
          const query = new URLSearchParams({
            lastChangedFrom: `${dateStr}T00:00:00.000+09:00`,
            lastChangedTo:   `${dateStr}T23:59:59.000+09:00`,
            lastChangedType: status,
          });
          // 실제 응답: { data: { lastChangeStatuses: [{ productOrderId, ... }], count } }
          const res = await this.request<{
            data?: { lastChangeStatuses?: { productOrderId: string }[] };
          }>(
            'GET',
            `/external/v1/pay-order/seller/product-orders/last-changed-statuses?${query.toString()}`,
          );
          const statuses = res.data?.lastChangeStatuses ?? [];
          statuses.forEach(({ productOrderId: id }) => productOrderIds.add(id));
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
    // 실제 응답: { data: [ { order:{}, productOrder:{}, delivery:{} }, ... ] }
    console.info(`[네이버 주문] 상세 조회: ${productOrderIds.size}건`);
    const detail = await this.request<{ data?: NaverOrderRawItem[] }>(
      'POST',
      '/external/v1/pay-order/seller/product-orders/query',
      { productOrderIds: Array.from(productOrderIds) },
    );

    const rawItems = detail.data ?? [];
    return { contents: rawItems.map(normalizeNaverOrder) };
  }

  /**
   * 변경 상품주문 한 페이지(ERP 주문 수집). lastChangedType을 생략해 모든 변경(결제·발송·취소·반품·교환)을 받는다.
   * from~to는 24시간 이하, +09:00 ISO. 응답 data.more가 있으면 more.moreFrom·moreSequence로 다음 페이지를 부른다.
   * getOrders와 달리 실패를 삼키지 않는다 — 수집기는 「끝까지 받았다」를 믿어야 한다.
   */
  async getLastChangedStatuses(p: { from: string; to: string; moreSequence?: string }): Promise<{
    statuses: { productOrderId: string }[];
    more: { moreFrom: string; moreSequence: string } | null;
  }> {
    const query = new URLSearchParams({ lastChangedFrom: p.from, lastChangedTo: p.to, limitCount: '300' });
    if (p.moreSequence) query.set('moreSequence', p.moreSequence);
    const res = await this.request<{
      data?: { lastChangeStatuses?: { productOrderId: string }[]; more?: { moreFrom: string; moreSequence: string } | null };
    }>('GET', `/external/v1/pay-order/seller/product-orders/last-changed-statuses?${query.toString()}`);
    return { statuses: res.data?.lastChangeStatuses ?? [], more: res.data?.more ?? null };
  }

  /** 상품주문 상세(최대 300건). 응답에는 구매자 정보가 있다 — 호출자가 버린다 */
  async queryProductOrders(productOrderIds: string[]): Promise<NaverOrderRawItem[]> {
    if (productOrderIds.length === 0) return [];
    if (productOrderIds.length > 300) throw new RangeError(`상품주문 상세는 한 번에 300건까지다: ${productOrderIds.length}`);
    const res = await this.request<{ data?: NaverOrderRawItem[] }>(
      'POST',
      '/external/v1/pay-order/seller/product-orders/query',
      { productOrderIds },
    );
    return res.data ?? [];
  }

  // ─── 정산 조회 ────────────────────────────────────────────

  /**
   * 네이버 커머스 settlements API — 지급 완료된 정산 내역.
   *
   * 주의: 정확한 엔드포인트 경로/파라미터/응답 필드는 네이버 커머스 API 문서 재확인 필요.
   * 현재 가정: GET /external/v1/settlements with paymentDateFrom/paymentDateTo.
   */
  async getSettlements(params: {
    fromDate: string;  // YYYY-MM-DD
    toDate: string;
  }): Promise<{ items: Array<{ productOrderId: string; settlementAmount: number; paymentDate: string }> }> {
    const PAGE_SIZE = 100;
    const MAX_PAGES = 50;
    const allItems: Array<{ productOrderId: string; settlementAmount: number; paymentDate: string }> = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const query = new URLSearchParams({
        paymentDateFrom: `${params.fromDate}T00:00:00.000+09:00`,
        paymentDateTo:   `${params.toDate}T23:59:59.000+09:00`,
        size: String(PAGE_SIZE),
        page: String(page),
      });
      const res = await this.request<{ data?: Array<Record<string, unknown>> }>(
        'GET',
        `/external/v1/pay-order/seller/settlements?${query.toString()}`,
      );
      const rawItems = res.data ?? [];
      allItems.push(...rawItems.map((r) => ({
        productOrderId: String(r.productOrderId ?? r.productOrderNo ?? ''),
        settlementAmount: Number(r.settlementAmount ?? r.amount ?? 0),
        paymentDate: String(r.paymentDate ?? r.payoutDate ?? ''),
      })));
      // 페이지가 가득 차지 않으면 마지막 페이지
      if (rawItems.length < PAGE_SIZE) break;
    }
    return { items: allItems };
  }

  // ─── 주소록 조회 ──────────────────────────────────────────

  /**
   * 판매자 주소록(출고지·반품교환지) 목록.
   * 상품 등록 시 claimDeliveryInfo.shippingAddressId / returnAddressId 에 필요하다.
   */
  async getAddressBooks(): Promise<NaverAddressBook[]> {
    const res = await this.request<{ addressBooks?: NaverAddressBook[] }>(
      'GET',
      '/external/v1/seller/addressbooks-for-page?page=1&size=100',
    );
    return res.addressBooks ?? [];
  }

  /**
   * 기본 출고지/반품교환지 주소록 번호를 찾는다.
   * 조회에 실패하면 빈 객체를 반환한다 — 주소록 없이도 등록은 되므로
   * 여기서 예외를 던져 등록 전체를 막지 않는다.
   */
  async getDefaultAddressIds(): Promise<{ shippingAddressId?: number; returnAddressId?: number }> {
    try {
      const books = await this.getAddressBooks();
      return {
        shippingAddressId: books.find((b) => b.addressType === 'RELEASE')?.addressBookNo,
        returnAddressId: books.find((b) => b.addressType === 'REFUND_OR_EXCHANGE')?.addressBookNo,
      };
    } catch (err) {
      console.warn('[네이버] 주소록 조회 실패 — 주소록 없이 등록을 진행합니다:', err);
      return {};
    }
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
