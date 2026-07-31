/**
 * GET /api/cost-management/audit/subdivision
 *
 * 소분 상품의 입고 데이터를 감사해 단위 혼입을 검출한다.
 *
 * 소분 상품은 매입 단위(낱개)와 판매 단위(봉지)가 다르다. 둘이 섞이면 FIFO
 * 가중평균이 무너지고 마진율이 왜곡되는데, 개별 입고 건은 그 자체로 일관돼
 * 보이므로 입력 시점에는 걸러지지 않는다. 상품 단위로 모아서 비교해야 한다.
 *
 * 응답의 severity:
 *   critical — 단가가 배수로 벌어짐. 마진율이 이미 왜곡되어 있을 가능성이 높다
 *   warning  — 소분 단위 혼입, 설명되지 않는 입고량 초과
 *   info     — 상품 레벨 기준값 부재, 분할 입고로 설명 가능한 수량 차이
 */

import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import {
  auditAllSubdivisions,
  type ProductForAudit,
} from '@/lib/cost-management/subdivision-audit';

interface Row {
  product_cost_id: string;
  product_name: string;
  product_subdivision_unit: number | null;
  entry_id: string;
  received_at: string;
  quantity: string;
  unit_cost: number;
  purchase_quantity: number | null;
  subdivision_unit: number | null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  try {
    const { rows } = await pool.query<Row>(
      `SELECT pc.id                 AS product_cost_id,
              pc.product_name       AS product_name,
              pc.subdivision_unit   AS product_subdivision_unit,
              ce.id                 AS entry_id,
              -- date를 Date 객체로 받으면 toISOString()에서 KST가 UTC로 당겨져
              -- 하루 밀린다. SQL에서 문자열로 고정한다.
              to_char(ce.received_at, 'YYYY-MM-DD') AS received_at,
              ce.quantity           AS quantity,
              ce.unit_cost          AS unit_cost,
              ce.purchase_quantity  AS purchase_quantity,
              ce.subdivision_unit   AS subdivision_unit
         FROM product_costs pc
         JOIN cost_entries ce ON ce.product_cost_id = pc.id
        WHERE pc.user_id = $1
        ORDER BY pc.product_name, ce.received_at`,
      [user.userId],
    );

    // 상품별로 묶는다. 감사는 같은 상품의 입고 건을 서로 비교해야 성립한다.
    const byProduct = new Map<string, ProductForAudit>();
    for (const r of rows) {
      let p = byProduct.get(r.product_cost_id);
      if (!p) {
        p = {
          productCostId: r.product_cost_id,
          productName: r.product_name,
          productSubdivisionUnit:
            r.product_subdivision_unit === null ? null : Number(r.product_subdivision_unit),
          entries: [],
        };
        byProduct.set(r.product_cost_id, p);
      }
      p.entries.push({
        id: r.entry_id,
        receivedAt: r.received_at,
        quantity: Number(r.quantity),
        unitCost: Number(r.unit_cost),
        purchaseQuantity: r.purchase_quantity === null ? null : Number(r.purchase_quantity),
        subdivisionUnit: r.subdivision_unit === null ? null : Number(r.subdivision_unit),
      });
    }

    const findings = auditAllSubdivisions([...byProduct.values()]);

    return NextResponse.json({
      success: true,
      scannedProducts: byProduct.size,
      summary: {
        critical: findings.filter((f) => f.severity === 'critical').length,
        warning: findings.filter((f) => f.severity === 'warning').length,
        info: findings.filter((f) => f.severity === 'info').length,
      },
      findings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cost-management/audit/subdivision] 실패:', msg);
    return NextResponse.json({ success: false, error: '감사 실패' }, { status: 500 });
  }
}
