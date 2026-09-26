// POST /api/erp/stock/import — 실사표(CSV) 불러오기 = 기초재고.
// body { csv, fileName, countedAt(오프셋 있는 ISO), unitCostOverrides?: { [skuKey]: 원 }, commit }
// commit=false: 미리보기(합계·오류·경고·제외·단가). commit=true: 오류가 없을 때만 한 트랜잭션으로 kind='opening' 적재.
// 요청마다 CSV·DB·쿠팡 RG 재고를 새로 읽는다(서버에 상태를 두지 않는다) — RG 칸은 이 요청 시점의 API 값이다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { parseCountCsv, rgQtyBySku, type CountRow } from '@/lib/erp/ledger/opening';
import { fetchRgStock, readDb } from '@/lib/erp/ledger/opening-db';
import { commitOpeningImport, planOpeningImport, type ImportSummary } from '@/lib/erp/ledger/opening-import';
import { stockedSkuIds } from '@/lib/erp/stock/queries';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const csv: unknown = body?.csv;
  if (typeof csv !== 'string' || csv.trim() === '') return badRequest('csv(실사표 내용)가 없다');
  if (csv.length > 2_000_000) return badRequest('실사표가 너무 크다(2MB 초과)');
  if (typeof body?.countedAt !== 'string') return badRequest('countedAt(실사를 마친 시각)이 없다');
  const countedAt: string = body.countedAt;
  const fileName = (typeof body?.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'opening.csv').slice(0, 120);
  const overrides: Record<string, number> = {};
  const badOverrideKeys: string[] = [];
  if (body?.unitCostOverrides && typeof body.unitCostOverrides === 'object') {
    for (const [k, v] of Object.entries(body.unitCostOverrides as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0) overrides[k] = v;
      else badOverrideKeys.push(k);
    }
  }
  if (badOverrideKeys.length > 0) return badRequest(`단가 입력이 0 이상 정수가 아니다: ${badOverrideKeys.join(', ')}`);
  let rows: CountRow[];
  try {
    rows = parseCountCsv(csv);
  } catch (e) {
    return badRequest((e as Error).message);
  }

  try {
    const pool = getSourcingPool();
    const db = await readDb(pool);
    const stocked = await stockedSkuIds(pool);
    // 기준 시각 = RG 재고를 읽기 직전(1-B opening-apply와 같다) — 1-C2 판매 소급의 시작점
    const cutoverAt = new Date().toISOString();
    const rg = rgQtyBySku(db.links, await fetchRgStock(), new Set());
    const p = planOpeningImport({
      rows, skus: db.skus, legacy: db.legacy, rgBySku: rg.bySku, rgIssues: rg.issues,
      stockedSkuIds: stocked, overrides, countedAt, now: new Date(cutoverAt), baseUnitMissing: db.baseUnitMissing,
    });
    const summary: ImportSummary = {
      committed: 0, cutoverAt, totals: p.totals, errors: p.errors, warnings: p.warnings, excluded: p.excluded, costs: p.costs,
    };
    if (body.commit !== true) return NextResponse.json({ success: true, data: summary });
    if (p.errors.length > 0) return NextResponse.json({ success: false, data: summary }, { status: 422 });
    const committed = await withTx((c) => commitOpeningImport(c, p.plan, { fileName, cutoverAt }));
    return NextResponse.json({ success: true, data: { ...summary, committed } });
  } catch (e) {
    return erpError(e);
  }
}
