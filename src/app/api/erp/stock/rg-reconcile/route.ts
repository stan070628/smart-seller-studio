// GET  /api/erp/stock/rg-reconcile — 쿠팡 RG 판매 가능 재고 ↔ 원장 RG(SKU별). 원장은 쓰지 않는다.
// POST /api/erp/stock/rg-reconcile — 사람이 확인한 행만 원장 RG를 실재고로 맞춘다(지금 개수 조정 · 사유 rg_reconcile).
//      body { items: [{ skuId, expected(화면의 원장 RG), actual(화면의 실재고), requestId, unitCost? }] }
// 1-C1에서는 자동 반영하지 않는다 — 판매 차감이 없어 RG 판매가 차이로 보인다(자동 입고 완료·7일 경보는 1-C2).
// 웹에서는 RG 매핑 이슈를 경고로만 보인다(docs/erp/opening-overrides.json의 ignoreRgVids는 스크립트 전용).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { rgOutsideActive, rgQtyBySku } from '@/lib/erp/ledger/opening';
import { fetchRgStock, readRgLinks } from '@/lib/erp/ledger/opening-db';
import { applyAdjustments } from '@/lib/erp/ledger/adjust-store';
import { AdjustInputError, AdjustItemError, validateAdjustInput } from '@/lib/erp/ledger/adjust';
import { activeSkuIds, rgLedgerBySku, type RgReconResponse } from '@/lib/erp/stock/queries';
import { badRequest, erpError, parseAdjustItem, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const MAX_ITEMS = 300;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    const pool = getSourcingPool();
    const [ledger, links, active] = await Promise.all([rgLedgerBySku(pool), readRgLinks(pool), activeSkuIds(pool)]);
    const rg = rgQtyBySku(links, await fetchRgStock(), new Set());
    const ids = [...new Set([...ledger.keys(), ...rg.bySku.keys()])].filter((id) => active.has(id)).sort((a, b) => a - b);
    const data: RgReconResponse = {
      fetchedAt: new Date().toISOString(),
      rows: ids.map((skuId) => ({ skuId, ledger: ledger.get(skuId) ?? 0, actual: rg.bySku.get(skuId) ?? 0 })),
      issues: rg.issues,
      inactive: rgOutsideActive(rg.bySku, active),
    };
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return erpError(e);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const raw: unknown = body?.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return badRequest(`items는 1~${MAX_ITEMS}건 배열이다`);
  const at = new Date().toISOString();
  try {
    const inputs = raw.map((b, i) => {
      const o = (b ?? {}) as Record<string, unknown>;
      const p = parseAdjustItem({ ...o, value: o.actual }, at, { location: 'rg', mode: 'count', reason: 'rg_reconcile', note: 'RG 실재고 대조' });
      try {
        validateAdjustInput(p);
      } catch (e) {
        throw new AdjustItemError(i, p.skuId, p.location, e);
      }
      return p;
    });
    // 활성 SKU 확인은 같은 트랜잭션 안에서 한다 — 조회와 기록 사이에 SKU가 비활성화되는 것을 막는다
    const results = await withTx(async (c) => {
      const active = await activeSkuIds(c);
      inputs.forEach((p, i) => {
        if (!active.has(p.skuId)) throw new AdjustItemError(i, p.skuId, p.location, new AdjustInputError(`활성 SKU가 아니다: ${p.skuId}`));
      });
      return applyAdjustments(c, inputs);
    });
    return NextResponse.json({ success: true, data: results });
  } catch (e) {
    return erpError(e);
  }
}
