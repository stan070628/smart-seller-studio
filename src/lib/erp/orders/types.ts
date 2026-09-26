// src/lib/erp/orders/types.ts
// 주문 수집의 공용 타입. 채널 어댑터는 응답을 OrderLine으로 옮기면서 구매자 칸을 버린다 — 이 타입에 개인정보 칸은 없다.
import type { Location } from '@/lib/erp/ledger/fifo';

export const ORDER_CHANNELS = ['coupang_wing', 'coupang_rg', 'naver', 'toss'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const CHANNEL_LABEL: Record<OrderChannel, string> = {
  coupang_wing: '쿠팡 판매자배송',
  coupang_rg: '쿠팡 RG',
  naver: '네이버',
  toss: '토스',
};

export const isOrderChannel = (v: unknown): v is OrderChannel =>
  typeof v === 'string' && (ORDER_CHANNELS as readonly string[]).includes(v);

export const STD_STATUSES = [
  'unpaid', 'paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'canceled',
  'return_requested', 'returned', 'exchange', 'unknown',
] as const;
export type StdStatus = (typeof STD_STATUSES)[number];

/** 팔림 — 결제됐고 취소·반품이 끝나지 않았다. 이 상태의 라인만 원장에서 뺀다(요청 중은 물건이 아직 안 돌아왔다) */
export const SOLD: ReadonlySet<StdStatus> = new Set<StdStatus>([
  'paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'return_requested', 'exchange',
]);
/** 무효 — 뺀 것이 있으면 역전표로 되돌린다. unknown은 어느 쪽도 아니다(지금 상태 유지) */
export const VOID: ReadonlySet<StdStatus> = new Set<StdStatus>(['unpaid', 'canceled', 'returned']);

/** 판매를 빼는 원장 위치: RG 주문은 RG, 나머지는 집 */
export const locationOf = (ch: OrderChannel): Location => (ch === 'coupang_rg' ? 'rg' : 'self');

export interface OrderLine {
  channel: OrderChannel;
  externalOrderId: string;
  /** 채널 안에서 유일한 라인 키 — 쿠팡 판매자배송 shipmentBoxId:vendorItemId · RG orderId:vendorItemId · 네이버 productOrderId · 토스 orderProductId */
  externalLineId: string;
  /** UTC ISO */
  orderedAt: string;
  /** UTC ISO. 결제 전이면 null */
  paidAt: string | null;
  rawStatus: string;
  status: StdStatus;
  /** 리스팅을 찾는 상품 키 — 쿠팡 vendorItemId · 네이버 원상품번호 · 토스 상품 ID */
  productId: string;
  /** 네이버 optionCode('' = 없음) · 토스 옵션명 · 쿠팡 '' */
  optionKey: string;
  /** 쿠팡 sellerProductId · 네이버 채널상품번호 · 토스 stockId — 옛 장부 연결·진단용 */
  altProductId: string | null;
  /** 상품명 · 옵션명(개인정보 아님) */
  productLabel: string;
  /** 채널 판매 단위 수량(> 0) */
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface FetchWindow {
  from: Date;
  to: Date;
}

export interface FetchResult {
  lines: OrderLine[];
  /** API가 실제로 거른 구간과 기준 칸([from, to), UTC ISO). 사라진 라인 판정에만 쓴다 */
  cover: { field: 'ordered_at' | 'paid_at'; from: string; to: string } | null;
  /** 응답에서 사라진 라인 = 취소(쿠팡 판매자배송·RG). 어댑터는 한 페이지라도 실패하면 던진다 — 여기 오면 끝까지 받은 것이다 */
  absenceMeansCancel: boolean;
}

export interface OrderAdapter {
  channel: OrderChannel;
  /** 커서와 별개로 매번 다시 읽는 최소 일수 — 주문일·결제일로 거르는 API는 늦은 취소를 48시간 겹침으로 못 잡는다 */
  tailDays: number;
  fetch(w: FetchWindow): Promise<FetchResult>;
}
