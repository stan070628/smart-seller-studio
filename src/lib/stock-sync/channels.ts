/**
 * 네이버·토스 옵션 재고 읽기/쓰기. 판정은 plan.ts가 하고 여기는 API만 다룬다.
 */
import { proxyFetch } from '@/lib/proxy-fetch';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

// ─── 네이버 ────────────────────────────────────────────────
// 재고 전용 API가 없다 — 원상품 전체를 GET해 stockQuantity만 고쳐 전체 PUT한다.
// 요청에 빠진 필드는 삭제로 처리되므로 GET 본문을 그대로 돌려보낸다.

export interface NaverProduct {
  originProductNo: number;
  body: any;
  /** 스마트스토어에서 판매 중(SALE)인가. 판매중지 상품은 건드리지 않는다 */
  onSale: boolean;
  /** optionCombination id → 재고. 단일상품은 '' 키 하나 */
  stocks: Map<string, number>;
}

export async function loadNaverProduct(originProductNo: number): Promise<NaverProduct> {
  const nv = getNaverCommerceClient();
  let body: any;
  // 상세 조회는 연속 호출 시 429(GW.RATE_LIMIT)가 난다 (2026-09-13 실측) — 늘려가며 재시도
  for (let attempt = 0; ; attempt++) {
    try { body = await nv.getProductDetail(originProductNo); break; }
    catch (e: any) {
      if (attempt < 4 && String(e?.message).includes('429')) { await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); continue; }
      throw e;
    }
  }
  const op = body.originProduct;
  const combos: any[] = op.detailAttribute?.optionInfo?.optionCombinations ?? [];
  const stocks = new Map<string, number>();
  if (combos.length === 0) stocks.set('', op.stockQuantity ?? 0);
  for (const c of combos) stocks.set(String(c.id), c.stockQuantity ?? 0);
  return { originProductNo, body, onSale: op.statusType === 'SALE', stocks };
}

export async function saveNaverStocks(p: NaverProduct, updates: Map<string, number>): Promise<void> {
  const op = p.body.originProduct;
  const combos: any[] = op.detailAttribute?.optionInfo?.optionCombinations ?? [];
  if (combos.length === 0) {
    op.stockQuantity = updates.get('') ?? op.stockQuantity;
  } else {
    for (const c of combos) {
      const q = updates.get(String(c.id));
      if (q !== undefined) c.stockQuantity = q;
    }
    // 네이버 제약: 추가금 0원 옵션 중 재고가 남은 옵션이 하나는 있어야 저장된다 (_zz_nv_stock0.mjs)
    const baseInStock = combos.filter((c) => (c.price ?? 0) === 0 && (c.stockQuantity ?? 0) > 0).length;
    if (baseInStock === 0) {
      throw new Error('추가금 0원 옵션이 전부 품절이 돼 네이버가 저장을 거부한다 — 스마트스토어에서 판매중지 필요');
    }
  }
  await getNaverCommerceClient().updateProduct(p.originProductNo, p.body);
}

// ─── 토스 ──────────────────────────────────────────────────
// 옵션 재고 전용 API가 있다: 0이면 품절, 품절 상태에서 1 이상이면 품절 취소 (공식 문서 「상품 옵션 정상 재고 수량 변경」).

const TOSS_HOST = 'https://shopping-fep.toss.im';

export async function getTossToken(): Promise<string> {
  const res = await proxyFetch('https://oauth2.cert.toss.im/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.TOSS_SHOPPING_ACCESS_KEY ?? '',
      client_secret: process.env.TOSS_SHOPPING_SECRET_KEY ?? '',
      scope: 'toss-shopping-fep:write',
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`토스 토큰 발급 실패 (${res.status})`);
  return j.access_token;
}

export interface TossProduct {
  productId: number;
  /** 검수 통과·노출 중인가. 반려·숨김 상품은 건드리지 않는다 */
  onSale: boolean;
  /** 옵션 valueName ' / ' 결합 → { 재고, 옵션 ID } */
  stocks: Map<string, { stock: number; itemId: number }>;
}

export const tossOptionKey = (options: { valueName: string }[]) => options.map((o) => o.valueName).join(' / ');

export async function loadTossProduct(token: string, productId: number): Promise<TossProduct> {
  const res = await proxyFetch(`${TOSS_HOST}/api/v3/shopping-fep/products/${productId}/v2`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const j: any = await res.json();
  if (j.resultType !== 'SUCCESS') throw new Error(`토스 상품 조회 실패 ${productId}: ${j.error?.reason ?? res.status}`);
  const stocks = new Map<string, { stock: number; itemId: number }>();
  for (const s of j.success.stocks ?? []) {
    // 경로의 productItemId는 stocks[].itemId다. stocks[].id를 넣으면 NOT_FOUND 「존재하지 않는 옵션입니다」 (2026-09-14 실측)
    stocks.set(tossOptionKey(s.options ?? []), { stock: s.isSoldOut ? 0 : (s.remainingCount ?? 0), itemId: s.itemId });
  }
  return { productId, onSale: j.success.inspectionStatus === 'COMPLETE' && !j.success.isHide, stocks };
}

export async function setTossStock(token: string, productId: number, itemId: number, remainingCount: number): Promise<void> {
  const res = await proxyFetch(
    `${TOSS_HOST}/api/v3/shopping-fep/product-items/${itemId}/stocks/normal-stock/remaining-count`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, remainingCount, partnerName: 'smart-seller-studio' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const j: any = await res.json().catch(() => ({}));
  // 모든 응답이 200이다 — resultType으로 성공을 판단한다
  if (j.resultType !== 'SUCCESS') throw new Error(`토스 재고 변경 실패 ${productId}/${itemId}: ${j.error?.reason ?? res.status}`);
}
