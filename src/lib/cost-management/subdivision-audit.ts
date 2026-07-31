/**
 * 소분 상품 입고 데이터 감사 — 단위 혼입을 검출한다.
 *
 * 왜 필요한가:
 *   소분 상품은 **매입 단위(낱개)와 판매 단위(봉지)가 다르다.** 원가를 낱개
 *   기준으로 넣으면 내부적으로는 모순이 없어 보이지만, 판매 단위 기준 원가와
 *   섞이는 순간 FIFO 가중평균이 무너진다.
 *
 *   랩노쉬 슬림쉐이크가 실제로 이 함정에 빠졌다. 42건이 낱개 단가(1,999원)로,
 *   104건이 봉지 단가(13,995원)로 들어가 평균이 10,544원으로 계산됐고,
 *   **마진율이 실제 12.7%의 2.3배인 29.6%로 표시됐다.** 저마진 품목이
 *   우량 품목으로 보인 채 두 달간 광고비가 집행됐다.
 *
 * 검출 원리:
 *   단일 입고 건만 봐서는 알 수 없다. 각 건은 그 자체로 일관되기 때문이다.
 *   **같은 상품의 다른 입고 건과 비교**해야 단위가 섞인 것이 드러난다.
 */

/** 단가 편차 임계 배수. 이 이상 벌어지면 단위 혼입으로 본다. */
export const UNIT_COST_OUTLIER_RATIO = 2.0;

/**
 * 날짜별 수량 검증식의 허용 오차 (봉지).
 * 같은 매입분을 여러 날에 걸쳐 나눠 입고하는 경우가 있어 완전 일치를 요구하지 않는다.
 */
export const QUANTITY_MISMATCH_TOLERANCE = 1.0;

export interface EntryForAudit {
  id: string;
  receivedAt: string;
  quantity: number;
  unitCost: number;
  purchaseQuantity: number | null;
  subdivisionUnit: number | null;
}

export interface ProductForAudit {
  productCostId: string;
  productName: string;
  /** `product_costs.subdivision_unit` — 상품 레벨 기준 소분 단위 */
  productSubdivisionUnit: number | null;
  entries: EntryForAudit[];
}

export type AuditSeverity = 'critical' | 'warning' | 'info';

export type AuditCode =
  /** 같은 상품 안에서 단가가 배수로 벌어진다 — 단위 혼입 강력 의심 */
  | 'unit_cost_outlier'
  /** 입고 건마다 소분 단위가 다르다 */
  | 'mixed_subdivision_unit'
  /** 날짜별 집계가 `매입수량 ÷ 소분단위 = 봉지수`를 벗어난다 */
  | 'quantity_mismatch'
  /** 소분 이력이 있는데 상품 레벨 기준값이 비어 있다 */
  | 'missing_product_subdivision_unit';

export interface AuditFinding {
  productCostId: string;
  productName: string;
  severity: AuditSeverity;
  code: AuditCode;
  message: string;
  detail: Record<string, unknown>;
}

/**
 * 한 상품의 입고 이력을 감사한다.
 *
 * 소분 이력이 전혀 없는 상품은 검사 대상이 아니므로 빈 배열을 반환한다.
 */
export function auditSubdivision(product: ProductForAudit): AuditFinding[] {
  const { productCostId, productName, productSubdivisionUnit, entries } = product;
  const findings: AuditFinding[] = [];

  if (entries.length === 0) return findings;

  const base = { productCostId, productName };
  const subdivided = entries.filter((e) => e.subdivisionUnit !== null);

  // 소분 이력이 없으면 이 감사의 대상이 아니다.
  if (subdivided.length === 0) return findings;

  // ── 1. 단가 편차 — 가장 확실한 단위 혼입 신호
  const costs = entries.map((e) => e.unitCost).filter((c) => c > 0);
  if (costs.length >= 2) {
    const min = Math.min(...costs);
    const max = Math.max(...costs);
    const ratio = max / min;
    if (ratio >= UNIT_COST_OUTLIER_RATIO) {
      findings.push({
        ...base,
        severity: 'critical',
        code: 'unit_cost_outlier',
        message:
          `단가가 ${ratio.toFixed(1)}배 차이난다 (${min.toLocaleString()}원 ~ ${max.toLocaleString()}원). ` +
          `매입 단위와 판매 단위가 섞였을 수 있으며, 이 경우 FIFO 평균 원가와 마진율이 왜곡된다.`,
        detail: { minUnitCost: min, maxUnitCost: max, ratio: Number(ratio.toFixed(2)) },
      });
    }
  }

  // ── 2. 소분 단위 혼입
  const units = [...new Set(subdivided.map((e) => e.subdivisionUnit as number))];
  if (units.length > 1) {
    findings.push({
      ...base,
      severity: 'warning',
      code: 'mixed_subdivision_unit',
      message: `입고 건마다 소분 단위가 다르다 (${units.sort((a, b) => a - b).join(', ')}). 어느 단위가 판매 단위인지 확인이 필요하다.`,
      detail: { units },
    });
  }

  // ── 3. 날짜별 수량 검증식
  //    같은 매입을 채널별(rg/wing)로 나눠 기록하므로 행 단위로 보면 정상 건도 위반으로 잡힌다.
  //    날짜로 묶어 봉지 수를 합산한 뒤 비교한다.
  const byDate = new Map<string, EntryForAudit[]>();
  for (const e of subdivided) {
    const list = byDate.get(e.receivedAt);
    if (list) list.push(e);
    else byDate.set(e.receivedAt, [e]);
  }

  for (const [date, group] of byDate) {
    const purchase = Math.max(...group.map((e) => e.purchaseQuantity ?? 0));
    const unit = Math.max(...group.map((e) => e.subdivisionUnit ?? 0));
    if (purchase <= 0 || unit <= 0) continue;

    const expected = purchase / unit;
    const actual = group.reduce((sum, e) => sum + e.quantity, 0);
    const gap = Math.abs(expected - actual);
    if (gap <= QUANTITY_MISMATCH_TOLERANCE) continue;

    // 입고량이 매입량보다 많으면 설명이 안 된다. 적은 쪽은 분할 입고로 볼 여지가 있다.
    const overReceived = actual > expected;
    findings.push({
      ...base,
      severity: overReceived ? 'warning' : 'info',
      code: 'quantity_mismatch',
      message:
        `${date} 입고가 계산과 어긋난다. 매입 ${purchase}개 ÷ 소분 ${unit}개 = ${expected.toFixed(1)}봉지인데 ${actual}봉지가 기록됐다. ` +
        (overReceived
          ? '입고량이 매입량보다 많아 설명되지 않는다.'
          : '같은 매입분을 나눠 입고했다면 정상일 수 있다.'),
      detail: { date, purchaseQuantity: purchase, subdivisionUnit: unit, expected, actual },
    });
  }

  // ── 4. 상품 레벨 기준값 부재
  //    비어 있으면 입고할 때마다 소분 단위를 수동으로 넣어야 하고, 빠뜨리면 일반 모드로 들어간다.
  if (productSubdivisionUnit === null || productSubdivisionUnit <= 0) {
    findings.push({
      ...base,
      severity: 'info',
      code: 'missing_product_subdivision_unit',
      message:
        '소분 이력이 있으나 상품에 소분 단위가 설정되어 있지 않다. ' +
        '기준값이 없으면 입고 시 단위를 빠뜨려도 걸러지지 않는다.',
      detail: { entrySubdivisionUnits: units },
    });
  }

  return findings;
}

/** 여러 상품을 감사하고 심각도 순으로 정렬한다. */
export function auditAllSubdivisions(products: ProductForAudit[]): AuditFinding[] {
  const order: Record<AuditSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return products
    .flatMap(auditSubdivision)
    .sort((a, b) => order[a.severity] - order[b.severity]);
}
