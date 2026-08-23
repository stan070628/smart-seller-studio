/**
 * 토스쇼핑 Open API 클라이언트
 *
 * 인증: Bearer JWT (TOSS_SHOPPING_ACCESS_TOKEN)
 * 문서: https://shopping-docs.toss.im/dev/api-2/order
 */
import { proxyFetch } from '@/lib/proxy-fetch';

const API_HOST = 'https://shopping-fep.toss.im';
const MAX_PAGES = 20; // 무한 루프 방지 상한

export interface TossOrder {
  orderId: number;
  orderProductId: number;
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

export class TossShoppingClient {
  private readonly accessToken: string;

  constructor() {
    this.accessToken = process.env.TOSS_SHOPPING_ACCESS_TOKEN ?? '';
    if (!this.accessToken) {
      throw new Error('[토스쇼핑] TOSS_SHOPPING_ACCESS_TOKEN 환경변수가 필요합니다.');
    }
  }

  private async request<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<TossApiResponse<T>> {
    const url = new URL(`${API_HOST}${path}`);
    Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

    const res = await proxyFetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    console.log(`[toss-shopping] GET ${path} → HTTP ${res.status} | ${text.slice(0, 300)}`);

    if (!res.ok) {
      throw new Error(`토스쇼핑 API 오류 (${res.status}): ${text.slice(0, 200)}`);
    }

    return JSON.parse(text) as TossApiResponse<T>;
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
      const queryParams: Record<string, string> = {
        startDate: params.startDate,
        endDate: params.endDate,
        limit: '50',
      };
      if (params.status) queryParams.status = params.status;
      if (cursor) queryParams.nextCursor = cursor;

      const res = await this.request<TossOrderListSuccess>(
        '/api/v3/shopping-fep/orders/v2',
        queryParams,
      );

      if (res.resultType === 'FAIL' || !res.success) {
        const code = res.error?.errorCode ?? 'UNKNOWN';
        const reason = res.error?.reason ?? '알 수 없는 오류';
        throw new Error(`토스쇼핑 주문 조회 실패 (${code}): ${reason}`);
      }

      allOrders.push(...(res.success.results ?? []));
      cursor = res.success.nextCursor;
      pages++;
    } while (cursor && pages < MAX_PAGES);

    return allOrders;
  }
}

export function getTossShoppingClient(): TossShoppingClient {
  return new TossShoppingClient();
}
