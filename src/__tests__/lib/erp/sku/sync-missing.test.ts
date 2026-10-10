// src/__tests__/lib/erp/sku/sync-missing.test.ts
import { describe, it, expect } from 'vitest';
import { syncMissing, SYNC_MISSING_CAP } from '@/lib/erp/sku/sync-product';
import { detail, fake } from './sync-fake';

describe('syncMissing', () => {
  it('리스팅 없는 상품을 최신순으로 받아 상한까지 돌리고, 넘으면 more', async () => {
    const f = fake({ missing: [{ id: '300', name: 'C' }, { id: '200', name: 'B' }, { id: '100', name: 'A' }] });
    f.coupang.getProductDetail.mockImplementation(async (sid: number) => {
      if (sid === 200) throw new Error('[쿠팡] 상품 조회 실패: 없음');
      return detail(sid);
    });
    const r = await syncMissing(f.deps, 2);
    const ask = f.calls.find((c) => c.sql.includes('order by at desc'))!;
    expect(ask.params).toEqual([3]);
    expect(ask.sql).toContain('pc.seller_product_id > 0');
    expect(ask.sql).toContain('not exists (select 1 from erp.channel_listings l where l.alt_product_id = pc.seller_product_id::text)');
    expect(ask.sql).toContain("not exists (select 1 from erp.skus s where s.key like 'cp:' || pc.seller_product_id || ':%')");
    expect(r.results.map((x) => [x.sellerProductId, x.productName, x.status])).toEqual([[300, 'C', 'created'], [200, 'B', 'failed']]);
    expect(r.results[1].error).toBe('[쿠팡] 상품 조회 실패: 없음');
    expect(r).toMatchObject({ created: 1, exists: 0, failed: 1, skus: 2, more: true });
    expect(f.coupang.getProductDetail).not.toHaveBeenCalledWith(100);
  });

  it('기본 상한은 20', async () => {
    expect(SYNC_MISSING_CAP).toBe(20);
    const f = fake();
    await syncMissing(f.deps);
    expect(f.calls[0].params).toEqual([21]);
  });

  it('빠진 상품이 없으면 빈 결과', async () => {
    expect(await syncMissing(fake().deps)).toEqual({ results: [], created: 0, exists: 0, failed: 0, skus: 0, more: false });
  });
});
