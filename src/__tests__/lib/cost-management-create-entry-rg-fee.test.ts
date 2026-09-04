// @vitest-environment node
/**
 * createCostEntry() — RG 물류비 기본값
 *
 * 🔴 2026-08-31 발견: 극세사 옐로우 입고 137개의 unit_rg_shipping_fee가 0이었다.
 *    일반 입고 폼(CostEntryDrawer.save)과 영수증 확정 경로가 이 필드를 아예
 *    보내지 않는데, createCostEntry가 `?? 0`으로 받아 개당 3,080원이 원가에서
 *    통째로 빠졌다. 1회성 스크립트(_fix_rg_fee.ts)로 채운 뒤 생긴 입고가 전부
 *    같은 구멍에 빠졌다 — 스크립트는 실행 시점의 배치만 고칠 수 있다.
 *
 * 값을 받지 못했으면 product_costs.rg_size_type의 요율을 기본값으로 쓴다.
 * 명시적으로 받은 값은 0이라도 그대로 존중한다 — RG로 보내지 않는 재고가 있다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCostEntry } from '@/lib/cost-management/create-entry';

const query = vi.fn();
const client = { query } as never;

/**
 * 상품 1건 + 직전 배치 조회를 돌려주는 스텁.
 *
 * @param rgSizeType     product_costs.rg_size_type
 * @param lastNonZeroFee 직전 비영 배치의 unit_rg_shipping_fee. null이면 그런 배치가 없다.
 */
function stubProduct(rgSizeType: string | null, lastNonZeroFee: number | null = null) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM product_costs')) {
      return {
        rows: [{
          id: 'prod-1',
          subdivision_unit: null,
          subdivision_carryover: 0,
          subdivision_carryover_unit_cost: 0,
          rg_size_type: rgSizeType,
        }],
      };
    }
    if (sql.includes('FROM cost_entries')) {
      return { rows: lastNonZeroFee === null ? [] : [{ unit_rg_shipping_fee: lastNonZeroFee }] };
    }
    if (sql.includes('INSERT INTO cost_entries')) return { rows: [{ id: 'entry-1' }] };
    return { rows: [] };
  });
}

/** INSERT에 실제로 실린 unit_rg_shipping_fee ($7 → 인덱스 6) */
function insertedRgFee(): number {
  const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO cost_entries'));
  if (!insert) throw new Error('INSERT INTO cost_entries가 호출되지 않았다');
  return (insert[1] as unknown[])[6] as number;
}

const base = {
  client,
  userId: 'u1',
  productCostId: 'prod-1',
  receivedAt: '2026-08-29',
  unitCost: 6386,
  quantity: 54,
};

// 블록으로 감싼다 — 화살표가 mockReset()의 반환값(query 자신)을 돌려주면
// Vitest가 그것을 teardown 함수로 보고 인자 없이 호출한다.
beforeEach(() => { query.mockReset(); });

describe('createCostEntry — RG 물류비 기본값', () => {
  it('물류비를 받지 못하면 극소형 요율(VAT 포함 3,080원)을 채운다', async () => {
    stubProduct('extra_small');

    await createCostEntry(base);

    expect(insertedRgFee()).toBe(3080);
  });

  it('물류비를 받지 못하면 소형 요율(VAT 포함 3,988원)을 채운다', async () => {
    stubProduct('small');

    await createCostEntry(base);

    expect(insertedRgFee()).toBe(3988);
  });

  it('사이즈가 없는 상품은 0으로 둔다 — RG 상품이 아니다', async () => {
    stubProduct(null);

    await createCostEntry(base);

    expect(insertedRgFee()).toBe(0);
  });

  it('명시적으로 받은 0은 기본값이 덮지 않는다', async () => {
    stubProduct('extra_small');

    await createCostEntry({ ...base, unitRgShippingFee: 0 });

    expect(insertedRgFee()).toBe(0);
  });

  it('명시적으로 받은 실측값이 사이즈 요율보다 우선한다', async () => {
    stubProduct('extra_small');

    await createCostEntry({ ...base, unitRgShippingFee: 3410 });

    expect(insertedRgFee()).toBe(3410);
  });

  it('사이즈가 없으면 직전 비영 배치를 승계한다 — 실측이 사이즈 요율보다 정확하다', async () => {
    // 라비오라 팩 3,575원은 예상정산액 역산 실측값이라 어떤 사이즈 요율과도 다르다.
    stubProduct(null, 3575);

    await createCostEntry(base);

    expect(insertedRgFee()).toBe(3575);
  });

  it('사이즈가 있으면 직전 배치보다 사이즈 요율이 우선한다', async () => {
    // 사이즈는 사람이 명시한 현재 상태다. 과거 실적이 그것을 덮으면
    // 2026-08-21 옐로우 정정 같은 변경이 반영되지 않는다.
    stubProduct('extra_small', 3988);

    await createCostEntry(base);

    expect(insertedRgFee()).toBe(3080);
  });

  it('사이즈도 직전 비영 배치도 없으면 0이다 — 추정하지 않는다', async () => {
    stubProduct(null, null);

    await createCostEntry(base);

    expect(insertedRgFee()).toBe(0);
  });

  it('소분 입고도 같은 기본값을 쓴다', async () => {
    stubProduct('extra_small');

    await createCostEntry({
      client,
      userId: 'u1',
      productCostId: 'prod-1',
      receivedAt: '2026-08-29',
      unitCost: 36000,
      purchaseQuantity: 72,
      subdivisionUnit: 10,
    });

    expect(insertedRgFee()).toBe(3080);
  });
});
