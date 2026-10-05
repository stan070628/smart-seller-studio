// src/app/api/erp/stock/rg-auto/route.ts
// GET — 마지막 RG 자동 대조 결과(옮김·옮길 예정·알림이 있는 줄만)
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { erpError } from '@/lib/erp/stock/http';
import { stripAlertKeys, type RgAutoLast } from '@/lib/erp/stock/rg-auto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    const { rows } = await getSourcingPool().query(
      `with last as (select run_id, run_at from erp.rg_recon_snapshots order by run_at desc limit 1)
       select s.run_at, s.sku_id, s.vid, coalesce(k.name || case when coalesce(k.option_label, '') <> '' then ' · ' || k.option_label else '' end, 'RG 번호 ' || s.vid) as label,
              s.ledger, s.actual, s.inbound, s.planned_move, s.moved, s.planned_return, s.returned, s.alert
         from erp.rg_recon_snapshots s join last on last.run_id = s.run_id left join erp.skus k on k.id = s.sku_id
        where s.planned_move > 0 or s.moved > 0 or s.planned_return > 0 or s.returned > 0 or s.alert is not null
        order by s.sku_id nulls last, s.vid`,
    );
    const data: RgAutoLast = {
      runAt: rows[0] ? new Date(rows[0].run_at).toISOString() : null,
      rows: rows.map((r) => ({
        skuId: r.sku_id === null ? null : Number(r.sku_id), vid: r.vid ?? null, label: String(r.label), ledger: Number(r.ledger), actual: Number(r.actual),
        inbound: Number(r.inbound), planned: Number(r.planned_move), moved: Number(r.moved),
        plannedReturn: Number(r.planned_return), returned: Number(r.returned), alert: stripAlertKeys(r.alert ?? null),
      })),
    };
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return erpError(e);
  }
}
