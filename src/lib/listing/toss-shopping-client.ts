/**
 * 토스쇼핑 Open API 클라이언트
 *
 * 인증: OAuth2 client_credentials — TOSS_SHOPPING_ACCESS_KEY·SECRET_KEY로 토큰(1시간 만료)을 받아 Bearer로 쓴다
 * 문서: https://shopping-docs.toss.im/dev/api-2/order
 */
import { proxyFetch } from '@/lib/proxy-fetch';
import { maskPII } from '@/lib/jobs/mask';

const API_HOST = 'https://shopping-fep.toss.im';
const MAX_PAGES = 20; // 무한 루프 방지 상한

// 🔴 ordererName·ordererPhone·receiverName·receiverPhone·address·detailAddress·zipCode·shippingNote는
// 구매자 개인정보다 — 주문 수집(erp/orders/adapters/toss.ts)은 버린다
export interface TossOrder {
  orderId: number;
  orderProductId: number;
  /** 상품 ID — ERP 리스팅의 external_product_id(공식 문서 GetOrderHistoriesCursorResponse, 필수 칸) */
  productId: number;
  /** 재고 ID(옵션) */
  stockId: number;
  orderedAt: string;
  ordererName: string;
  ordererPhone: string;
  productName: string;
  optionName: string;
  quantity: number;
  price: number;
  receiverName: string;
  receiverPhone: string;
  address: string;
  detailAddress: string;
  zipCode: string;
  deliveryCompanyCode: string;
  shippingTrackingNumber: string;
  deliveryFee: number;
  orderProductStatus: string;
  canceledAt: string | null;
  confirmedAt: string | null;
}

interface TossApiResponse<T> {
  resultType: 'SUCCESS' | 'FAIL';
  success?: T;
  error?: { errorCode: string; reason: string };
}

interface TossOrderListSuccess {
  /** 주문 배열. 응답 키는 `orders`가 아니라 `results`다 (2026-08-11 실측) */
  results: TossOrder[];
  nextCursor?: string;
}

/**
 * 토큰 발급. 🔴 옛 클라이언트는 존재하지 않는 TOSS_SHOPPING_ACCESS_TOKEN을 읽어 운영에서 한 번도 돌지 못했다
 * (2026-09-27 주문 수집 시험 실행에서 발견). 키는 IP 화이트리스트와 묶여 있어 발급도 프록시로 부른다.
 */
export async function getTossToken(): Promise<string> {
  const clientId = process.env.TOSS_SHOPPING_ACCESS_KEY ?? '';
  const clientSecret = process.env.TOSS_SHOPPING_SECRET_KEY ?? '';
  if (!clientId || !clientSecret) {
    throw new Error('[토스쇼핑] TOSS_SHOPPING_ACCESS_KEY·TOSS_SHOPPING_SECRET_KEY 환경변수가 필요합니다.');
  }
  const res = await proxyFetch('https://oauth2.cert.toss.im/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'toss-shopping-fep:write',
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!j.access_token) throw new Error(`토스 토큰 발급 실패 (${res.status})`);
  return j.access_token;
}

export class TossShoppingClient {
  /** 인스턴스는 수집 한 번 동안만 쓰이므로(1시간 만료보다 짧다) 첫 요청에서 한 번 받는다 */
  private accessToken: Promise<string> | null = null;

  private async request<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<TossApiResponse<T>> {
    const url = new URL(`${API_HOST}${path}`);
    Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

    this.accessToken ??= getTossToken();
    const token = await this.accessToken.catch((e) => { this.accessToken = null; throw e; });
    const res = await proxyFetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    console.log(`[toss-shopping] GET ${path} → HTTP ${res.status}`);

    if (!res.ok) {
      throw new Error(`토스쇼핑 API 오류 (${res.status}): ${maskPII(text.slice(0, 200))}`);
    }

    return JSON.parse(text) as TossApiResponse<T>;
  }

  /** 주문 내역 한 페이지. nextCursor가 null이면 마지막 페이지 */
  async getOrdersPage(params: {
    startDate: string; // yyyy-MM-dd
    endDate: string;   // yyyy-MM-dd (startDate로부터 최대 31일)
    status?: string;
    nextCursor?: string;
  }): Promise<{ results: TossOrder[]; nextCursor: string | null }> {
    const queryParams: Record<string, string> = {
      startDate: params.startDate,
      endDate: params.endDate,
      limit: '50',
    };
    if (params.status) queryParams.status = params.status;
    if (params.nextCursor) queryParams.nextCursor = params.nextCursor;

    const res = await this.request<TossOrderListSuccess>('/api/v3/shopping-fep/orders/v2', queryParams);
    if (res.resultType === 'FAIL' || !res.success) {
      const code = res.error?.errorCode ?? 'UNKNOWN';
      const reason = res.error?.reason ?? '알 수 없는 오류';
      throw new Error(`토스쇼핑 주문 조회 실패 (${code}): ${reason}`);
    }
    return { results: res.success.results ?? [], nextCursor: res.success.nextCursor ?? null };
  }

  async getOrders(params: {
    startDate: string; // yyyy-MM-dd
    endDate: string;   // yyyy-MM-dd (startDate로부터 최대 31일)
    /**
     * 대부분의 값이 400(INVALID_REQUEST)이다. 2026-08-11 실측에서 통과한 것은
     * `DELIVERED`뿐이고 PAYMENT_COMPLETED/PREPARING/SHIPPING/CONFIRMED/CANCELED/ALL은
     * 모두 거부됐다. 생략하고 orderProductStatus로 거르는 편이 안전하다.
     */
    status?: string;
  }): Promise<TossOrder[]> {
    const allOrders: TossOrder[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await this.getOrdersPage({ ...params, nextCursor: cursor });
      allOrders.push(...page.results);
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < MAX_PAGES);
    return allOrders;
  }
}

export function getTossShoppingClient(): TossShoppingClient {
  return new TossShoppingClient();
}
