// src/__tests__/lib/erp/sku/db-input.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readDraftDbInput } from '@/lib/erp/sku/db-input';

function fake(pccRows?: unknown[]) {
  const calls: { sql: string; params: unknown }[] = [];
  const res = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('from product_costs')) {
      return res([
        { id: 'pc-1', product_name: '담요', seller_product_id: '16404126884', vendor_item_id: null },
        { id: 'pc-2', product_name: '샴푸', seller_product_id: '-3', vendor_item_id: '96152866376' },
      ]);
    }
    if (sql.includes('from product_cost_channels')) return res(pccRows ?? [{ product_cost_id: 'pc-1', channel_type: 'coupang_wing', external_id: '11', unit_multiplier: 2 }]);
    if (sql.includes('from stock_sync_links')) return res([{ coupang_vendor_item_id: '11', channel: 'naver', product_id: '900', option_key: null, label: null }]);
    if (sql.includes('from sale_records')) {
      return res([
        { vid: '11', product_cost_id: 'pc-1', rows: 3 },
        { vid: null, product_cost_id: 'pc-1', rows: 1 },
        { vid: '12', product_cost_id: null, rows: 1 },
      ]);
    }
    return res([]);
  });
  return { db: { query }, calls };
}

describe('readDraftDbInput', () => {
  it('전체 — 네 조회를 범위 없이 돌리고 sku-collect와 같은 모양으로 바꾼다', async () => {
    const f = fake();
    const x = await readDraftDbInput(f.db);
    expect(x).toEqual({
      legacyProductCosts: [
        { id: 'pc-1', productName: '담요', sellerProductId: 16404126884, vendorItemId: null },
        { id: 'pc-2', productName: '샴푸', sellerProductId: -3, vendorItemId: 96152866376 },
      ],
      legacyChannels: [{ productCostId: 'pc-1', channelType: 'coupang_wing', externalId: 11, unitMultiplier: 2 }],
      syncLinks: [{ coupangVid: 11, channel: 'naver', productId: 900, optionKey: '', label: null }],
      saleAttributions: [{ vid: 11, productCostId: 'pc-1', rows: 3 }],
    });
    // 초안 JSON의 input 키 순서가 바뀌지 않게
    expect(Object.keys(x)).toEqual(['legacyProductCosts', 'legacyChannels', 'syncLinks', 'saleAttributions']);
    expect(f.calls).toHaveLength(4);
    expect(f.calls.every((c) => c.params === undefined)).toBe(true);
    expect(f.calls[0].sql).toBe('select id, product_name, seller_product_id, vendor_item_id from product_costs');
  });

  it('상품 하나 — 상품번호·vid로 좁히고 sale_records는 읽지 않는다', async () => {
    const f = fake();
    const x = await readDraftDbInput(f.db, { sellerProductId: 16404126884, vids: [11, 21] });
    expect(f.calls).toHaveLength(3);
    expect(f.calls.some((c) => c.sql.includes('sale_records'))).toBe(false);
    expect(f.calls[0].params).toEqual([16404126884, [11, 21]]);
    expect(f.calls[0].sql).toContain('where seller_product_id = $1 or vendor_item_id = any($2::bigint[])');
    expect(f.calls[1].params).toEqual([['pc-1']]);
    expect(f.calls[1].sql).toContain("channel_type <> 'naver' and product_cost_id = any($1::uuid[])");
    expect(f.calls[2].params).toEqual([[11, 21]]);
    expect(f.calls[2].sql).toContain('where coupang_vendor_item_id = any($1::bigint[])');
    expect(x.saleAttributions).toEqual([]);
    expect(x.legacyChannels).toHaveLength(1);
    // vendor_item_id가 범위 밖인 원가 행(pc-2)은 버린다 — draft P1 대체 연결이 이 상품 SKU 전부에 붙이지 않게
    expect(x.legacyProductCosts.map((r) => r.id)).toEqual(['pc-1']);
  });

  it('상품 하나 — 원가 연결이 범위 밖 vid를 가리키는 원가 행과 그 연결은 버린다', async () => {
    const f = fake([
      { product_cost_id: 'pc-1', channel_type: 'coupang_wing', external_id: '11', unit_multiplier: 1 },
      { product_cost_id: 'pc-1', channel_type: 'coupang_wing', external_id: '99', unit_multiplier: 1 },
    ]);
    const x = await readDraftDbInput(f.db, { sellerProductId: 16404126884, vids: [11, 21] });
    expect(x.legacyProductCosts).toEqual([]);
    expect(x.legacyChannels).toEqual([]);
  });
});
