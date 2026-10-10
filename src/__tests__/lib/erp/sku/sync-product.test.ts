// src/__tests__/lib/erp/sku/sync-product.test.ts
import { describe, it, expect } from 'vitest';
import { syncSellerProduct } from '@/lib/erp/sku/sync-product';
import { PC, SP, fake } from './sync-fake';

describe('syncSellerProduct', () => {
  it('새 상품 — 잠금 뒤 옵션별 SKU·Wing/RG 리스팅·연결을 만들고, 원가 연결은 같은 상품번호의 원가 행', async () => {
    const f = fake();
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'created', skus: 2 });
    const lockAt = f.calls.findIndex((c) => c.sql.includes('pg_advisory_xact_lock'));
    expect(f.calls[lockAt].params).toEqual([7103]);
    const w = f.writes();
    expect(lockAt).toBeLessThan(f.calls.indexOf(w[0]));
    const skus = w.filter((c) => c.sql.includes('insert into erp.skus'));
    expect(skus.map((c) => c.params.slice(0, 3))).toEqual([
      [`cp:${SP}:화이트쇼어`, '펜들턴 셔파 담요', '화이트쇼어'],
      [`cp:${SP}:사바나`, '펜들턴 셔파 담요', '사바나'],
    ]);
    expect(skus.map((c) => c.params[5])).toEqual([[PC], [PC]]);
    const listings = w.filter((c) => c.sql.includes('insert into erp.channel_listings'));
    expect(listings.map((c) => [c.params[0], c.params[1], c.params[3], c.params[4]])).toEqual([
      ['coupang_wing', '11', String(SP), '펜들턴 셔파 담요 · 화이트쇼어'],
      ['coupang_rg', '21', String(SP), '펜들턴 셔파 담요 · 화이트쇼어'],
      ['coupang_wing', '12', String(SP), '펜들턴 셔파 담요 · 사바나'],
    ]);
    expect(w.filter((c) => c.sql.includes('insert into erp.listing_skus'))).toHaveLength(3);
    // 보관·비활성화·연결 삭제(정리)는 하지 않는다
    expect(w.some((c) => /^\s*(update|delete)/i.test(c.sql))).toBe(false);
    expect(f.txCount()).toBe(1);
  });

  it('리스팅·SKU가 이미 있으면 exists — 쿠팡을 부르지 않고 쓰지 않는다', async () => {
    const f = fake({ hit: [true] });
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'exists', skus: 0 });
    expect(f.calls[0].params).toEqual([String(SP), `cp:${SP}:%`]);
    expect(f.calls[0].sql).toContain('alt_product_id = $1');
    expect(f.coupang.getProductDetail).not.toHaveBeenCalled();
    expect(f.writes()).toHaveLength(0);
  });

  it('잠금을 잡은 뒤 다시 보면 이미 있다(겹친 요청) → exists, 쓰지 않는다', async () => {
    const f = fake({ hit: [false, true] });
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'exists', skus: 0 });
    expect(f.writes()).toHaveLength(0);
  });

  it('쿠팡 조회 실패 → failed, 트랜잭션을 열지 않는다', async () => {
    const f = fake();
    f.coupang.getProductDetail.mockRejectedValueOnce(new Error('[쿠팡] 상품 조회 실패: 없음'));
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'failed', skus: 0, error: '[쿠팡] 상품 조회 실패: 없음' });
    expect(f.txCount()).toBe(0);
  });

  it('쿠팡 옵션에 vid가 하나도 없으면 failed', async () => {
    const f = fake();
    f.coupang.getProductDetail.mockResolvedValueOnce({ sellerProductId: SP, sellerProductName: 'x', items: [{ itemName: '블랙' }] });
    const r = await syncSellerProduct(f.deps, SP);
    expect(r).toMatchObject({ status: 'failed', skus: 0 });
    expect(r.error).toContain('vid');
  });

  it('상품번호가 0 이하·정수가 아니면 skipped — 아무것도 부르지 않는다', async () => {
    const f = fake();
    for (const bad of [0, -5, 1.5, Number.NaN]) expect(await syncSellerProduct(f.deps, bad)).toEqual({ status: 'skipped', skus: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('원가 연결은 DB ∪ 초안 — SKU upsert가 합집합 SQL을 쓴다', async () => {
    const f = fake();
    await syncSellerProduct(f.deps, SP);
    const sku = f.writes().find((c) => c.sql.includes('insert into erp.skus'))!;
    expect(sku.sql).toContain('unnest(erp.skus.legacy_product_cost_ids || excluded.legacy_product_cost_ids)');
    expect(sku.sql).toContain("where erp.skus.origin = 'draft'");
  });

  it('조회를 그 상품번호·vid로 좁히고, 그 상품 SKU만 쓴다', async () => {
    const f = fake({ pcc: [{ product_cost_id: PC, channel_type: 'coupang_wing', external_id: '11', unit_multiplier: 1 }] });
    await syncSellerProduct(f.deps, SP);
    const keys = f.writes().filter((c) => c.sql.includes('insert into erp.skus')).map((c) => String(c.params[0]));
    expect(keys.every((k) => k.startsWith(`cp:${SP}:`))).toBe(true);
    const pcs = f.calls.find((c) => c.sql.includes('from product_costs'))!;
    expect(pcs.params).toEqual([SP, [11, 21, 12]]);
    const scoped = f.calls.filter((c) => (c.sql.includes('from product_cost_channels') && !c.sql.includes('from product_costs')) || c.sql.includes('from stock_sync_links'));
    expect(scoped.map((c) => c.params)).toEqual([[[11, 21, 12]], [[11, 21, 12]]]);
    expect(f.calls.some((c) => c.sql.includes('sale_records'))).toBe(false);
  });

  it('네이버 리스팅 — 새 것은 만들고, 이미 있는 것(다른 상품과 묶인 것)은 건드리지 않는다', async () => {
    const f = fake({
      ssl: [
        { coupang_vendor_item_id: '11', channel: 'naver', product_id: '900', option_key: '5001', label: '담요 · 화이트' },
        { coupang_vendor_item_id: '12', channel: 'naver', product_id: '901', option_key: '', label: '담요 묶음' },
      ],
      existingListings: ['naver|901|'],
    });
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'created', skus: 2 });
    const ask = f.calls.find((c) => c.sql.includes('as k from erp.channel_listings'))!;
    expect(ask.params).toEqual([['naver|900|5001', 'naver|901|']]);
    const listings = f.writes()
      .filter((c) => c.sql.includes('insert into erp.channel_listings'))
      .map((c) => `${c.params[0]}|${c.params[1]}|${c.params[2]}`);
    expect(listings).toContain('naver|900|5001');
    expect(listings).not.toContain('naver|901|');
    expect(f.writes().filter((c) => c.sql.includes('insert into erp.listing_skus'))).toHaveLength(4);
  });

  it('manual SKU와 겹치면 failed', async () => {
    const r = await syncSellerProduct(fake({ skuConflict: true }).deps, SP);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('manual SKU와 겹친다');
  });

  it('planOnly — 존재 확인·잠금·쓰기 없이 그 상품 행을 돌려준다(이미 있어도)', async () => {
    const f = fake({ hit: [true] });
    const r = await syncSellerProduct(f.deps, SP, { planOnly: true });
    if (r.status !== 'planned') throw new Error(`planned 아님: ${r.status}`);
    expect(r.skus).toBe(2);
    expect(r.plan.skus.map((s) => s.key)).toEqual([`cp:${SP}:화이트쇼어`, `cp:${SP}:사바나`]);
    expect(r.plan.links.map((l) => `${l.listingKey}→${l.skuKey}×${l.multiplier}`)).toEqual([
      `coupang_wing|11|→cp:${SP}:화이트쇼어×1`,
      `coupang_rg|21|→cp:${SP}:화이트쇼어×1`,
      `coupang_wing|12|→cp:${SP}:사바나×1`,
    ]);
    expect(f.calls.some((c) => c.sql.includes('as hit') || c.sql.includes('pg_advisory'))).toBe(false);
    expect(f.writes()).toHaveLength(0);
    expect(f.txCount()).toBe(0);
  });
});
