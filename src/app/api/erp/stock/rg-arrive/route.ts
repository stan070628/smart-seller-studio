// POST /api/erp/stock/rg-arrive — RG 입고 완료: 원장 rg_inbound → rg 이동(SKU별).
//      body { items: [{ skuId, qty, requestId }] } · 응답 data = [{ skuId, qty, requestId, outcome: 'posted' | 'duplicate' }]
// 재고 화면 RG 대조에서 RG 실재고 > 원장 RG이고 입고중이 남은 행의 「입고 완료 m개 옮기기」가 부른다.
// 한 트랜잭션 · SKU 오름차순 잠금 · 멱등키 rgdone:<uuid>(되돌리기 가능) · 입고중 부족 → 409(전부 되돌림).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { AdjustInputError, AdjustItemError } from '@/lib/erp/ledger/adjust';
import { postRgArrivals, validateRgArriveItems } from '@/lib/erp/ledger/rg-arrive';
import { activeSkuIds } from '@/lib/erp/stock/queries';
import { erpError, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  try {
    const items = validateRgArriveItems(body?.items);
    const at = new Date().toISOString();
    // 활성 SKU 확인은 같은 트랜잭션 안에서 한다 — 조회와 기록 사이에 SKU가 비활성화되는 것을 막는다
    const data = await withTx(async (c) => {
      const active = await activeSkuIds(c);
      items.forEach((it, i) => {
        if (!active.has(it.skuId)) throw new AdjustItemError(i, it.skuId, 'rg_inbound', new AdjustInputError(`활성 SKU가 아니다: ${it.skuId}`));
      });
      return postRgArrivals(c, items, at);
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return erpError(e);
  }
}
