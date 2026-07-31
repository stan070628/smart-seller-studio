// @vitest-environment node
/**
 * subdivision-audit.test.ts
 * 소분 상품 입고 단위 혼입 검출 — 단위 테스트
 *
 * 실제 사고 사례(랩노쉬 슬림쉐이크)를 재현 케이스로 포함한다.
 * 이 감사가 6월에 있었다면 마진율 2.3배 과대계상을 즉시 잡았을 것이다.
 */

import { describe, it, expect } from 'vitest';
import {
  auditSubdivision,
  auditAllSubdivisions,
  type ProductForAudit,
  type EntryForAudit,
} from '../subdivision-audit';

function entry(over: Partial<EntryForAudit> = {}): EntryForAudit {
  return {
    id: 'e1',
    receivedAt: '2026-07-07',
    quantity: 20,
    unitCost: 13995,
    purchaseQuantity: 140,
    subdivisionUnit: 7,
    ...over,
  };
}

function product(over: Partial<ProductForAudit> = {}): ProductForAudit {
  return {
    productCostId: 'p1',
    productName: '테스트 상품',
    productSubdivisionUnit: 7,
    entries: [entry()],
    ...over,
  };
}

describe('auditSubdivision', () => {
  it('입고 이력이 없으면 아무것도 보고하지 않는다', () => {
    expect(auditSubdivision(product({ entries: [] }))).toEqual([]);
  });

  it('소분 이력이 없는 상품은 검사 대상이 아니다', () => {
    const findings = auditSubdivision(
      product({
        productSubdivisionUnit: null,
        entries: [
          entry({ id: 'a', subdivisionUnit: null, purchaseQuantity: null, unitCost: 1000 }),
          entry({ id: 'b', subdivisionUnit: null, purchaseQuantity: null, unitCost: 9000 }),
        ],
      }),
    );
    expect(findings).toEqual([]);
  });

  it('정상 데이터는 아무것도 보고하지 않는다', () => {
    const findings = auditSubdivision(
      product({
        entries: [
          entry({ id: 'a', receivedAt: '2026-07-07', quantity: 20, purchaseQuantity: 140 }),
          entry({ id: 'b', receivedAt: '2026-07-11', quantity: 20, purchaseQuantity: 140 }),
        ],
      }),
    );
    expect(findings).toEqual([]);
  });

  describe('단가 편차 (critical)', () => {
    it('2배 이상 벌어지면 검출한다', () => {
      const findings = auditSubdivision(
        product({
          entries: [
            entry({ id: 'a', unitCost: 1999 }),
            entry({ id: 'b', unitCost: 13995 }),
          ],
        }),
      );
      const f = findings.find((x) => x.code === 'unit_cost_outlier');
      expect(f).toBeDefined();
      expect(f?.severity).toBe('critical');
      expect(f?.detail.ratio).toBeCloseTo(7.0, 1);
    });

    it('2배 미만이면 검출하지 않는다 — 매입가 변동은 정상이다', () => {
      const findings = auditSubdivision(
        product({
          entries: [
            entry({ id: 'a', unitCost: 5222 }),
            entry({ id: 'b', unitCost: 6664 }),
          ],
        }),
      );
      expect(findings.find((x) => x.code === 'unit_cost_outlier')).toBeUndefined();
    });

    it('정확히 2배면 검출한다 (경계 포함)', () => {
      const findings = auditSubdivision(
        product({
          entries: [entry({ id: 'a', unitCost: 5000 }), entry({ id: 'b', unitCost: 10000 })],
        }),
      );
      expect(findings.find((x) => x.code === 'unit_cost_outlier')).toBeDefined();
    });
  });

  describe('소분 단위 혼입 (warning)', () => {
    it('단위가 섞이면 검출한다', () => {
      const findings = auditSubdivision(
        product({
          entries: [
            entry({ id: 'a', subdivisionUnit: 7, purchaseQuantity: 140, quantity: 20 }),
            entry({ id: 'b', subdivisionUnit: 1, purchaseQuantity: 16, quantity: 16 }),
          ],
        }),
      );
      const f = findings.find((x) => x.code === 'mixed_subdivision_unit');
      expect(f?.severity).toBe('warning');
      expect(f?.detail.units).toEqual([1, 7]);
    });
  });

  describe('수량 검증식 (quantity_mismatch)', () => {
    it('입고량이 매입량보다 많으면 warning이다', () => {
      const findings = auditSubdivision(
        product({
          productSubdivisionUnit: 1,
          entries: [
            entry({ id: 'a', subdivisionUnit: 1, purchaseQuantity: 30, quantity: 60 }),
          ],
        }),
      );
      const f = findings.find((x) => x.code === 'quantity_mismatch');
      expect(f?.severity).toBe('warning');
      expect(f?.message).toContain('설명되지 않는다');
    });

    it('입고량이 적으면 분할 입고 가능성이 있어 info다', () => {
      const findings = auditSubdivision(
        product({
          productSubdivisionUnit: 10,
          entries: [
            entry({ id: 'a', subdivisionUnit: 10, purchaseQuantity: 180, quantity: 13 }),
          ],
        }),
      );
      const f = findings.find((x) => x.code === 'quantity_mismatch');
      expect(f?.severity).toBe('info');
    });

    it('같은 날 채널 분할 입력은 합산해서 정상 판정한다', () => {
      // 180개를 10개씩 = 18봉지를 rg 13 + wing 3 + wing 2로 나눠 기록한 실제 사례
      const findings = auditSubdivision(
        product({
          productSubdivisionUnit: 10,
          entries: [
            entry({ id: 'a', receivedAt: '2026-05-22', subdivisionUnit: 10, purchaseQuantity: 180, quantity: 13 }),
            entry({ id: 'b', receivedAt: '2026-05-22', subdivisionUnit: 10, purchaseQuantity: null, quantity: 3 }),
            entry({ id: 'c', receivedAt: '2026-05-22', subdivisionUnit: 10, purchaseQuantity: null, quantity: 2 }),
          ],
        }),
      );
      expect(findings.find((x) => x.code === 'quantity_mismatch')).toBeUndefined();
    });

    it('오차 1봉지 이내는 허용한다', () => {
      const findings = auditSubdivision(
        product({
          productSubdivisionUnit: 10,
          entries: [
            entry({ id: 'a', subdivisionUnit: 10, purchaseQuantity: 108, quantity: 10 }),
          ],
        }),
      );
      expect(findings.find((x) => x.code === 'quantity_mismatch')).toBeUndefined();
    });
  });

  describe('상품 레벨 기준값 부재 (info)', () => {
    it('비어 있으면 검출한다', () => {
      const findings = auditSubdivision(product({ productSubdivisionUnit: null }));
      expect(findings.find((x) => x.code === 'missing_product_subdivision_unit')?.severity).toBe('info');
    });

    it('설정되어 있으면 검출하지 않는다', () => {
      const findings = auditSubdivision(product({ productSubdivisionUnit: 7 }));
      expect(findings.find((x) => x.code === 'missing_product_subdivision_unit')).toBeUndefined();
    });
  });

  describe('실제 사고 재현 — 랩노쉬 슬림쉐이크', () => {
    it('낱개 단가 42건과 봉지 단가 104건 혼입을 critical로 잡는다', () => {
      const findings = auditSubdivision({
        productCostId: 'labnosh',
        productName: 'LABNOSH 랩노쉬 슬림쉐이크',
        productSubdivisionUnit: null,
        entries: [
          // 🔴 낱개(45g 1개) 단가로 들어간 건
          entry({ id: '1', receivedAt: '2026-06-16', quantity: 14, unitCost: 1999, purchaseQuantity: null, subdivisionUnit: null }),
          entry({ id: '2', receivedAt: '2026-06-19', quantity: 28, unitCost: 1999, purchaseQuantity: null, subdivisionUnit: null }),
          // ✅ 7개 봉지 단가로 들어간 건
          entry({ id: '3', receivedAt: '2026-07-07', quantity: 20, unitCost: 13995, purchaseQuantity: 140, subdivisionUnit: 7 }),
          entry({ id: '4', receivedAt: '2026-07-11', quantity: 20, unitCost: 13995, purchaseQuantity: 140, subdivisionUnit: 7 }),
        ],
      });

      const critical = findings.find((f) => f.severity === 'critical');
      expect(critical?.code).toBe('unit_cost_outlier');
      expect(critical?.detail.minUnitCost).toBe(1999);
      expect(critical?.detail.maxUnitCost).toBe(13995);

      // 상품 레벨 기준값이 비어 있던 것도 함께 잡힌다
      expect(findings.find((f) => f.code === 'missing_product_subdivision_unit')).toBeDefined();
    });
  });
});

describe('auditAllSubdivisions', () => {
  it('심각도 순으로 정렬한다', () => {
    const findings = auditAllSubdivisions([
      product({ productCostId: 'p1', productSubdivisionUnit: null }), // info
      product({
        productCostId: 'p2',
        entries: [entry({ id: 'a', unitCost: 1000 }), entry({ id: 'b', unitCost: 9000 })],
      }), // critical
    ]);
    expect(findings[0].severity).toBe('critical');
    expect(findings[findings.length - 1].severity).toBe('info');
  });
});
