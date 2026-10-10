// src/__tests__/lib/erp/sku/sync-fake.ts
// syncSellerProduct · syncMissing 테스트용 가짜 DB·쿠팡·트랜잭션. 운영 DB에 닿지 않는다.
import { vi } from 'vitest';
import type { SyncDeps } from '@/lib/erp/sku/sync-product';

export const PC = '7cab2ba8-cb4e-4c3a-8d3f-273455c1513a';
export const SP = 16404126884;

export const detail = (id = SP) => ({
  sellerProductId: id,
  sellerProductName: '펜들턴 셔파 담요',
  items: [
    { itemName: '화이트쇼어', vendorItemId: 11, rocketGrowthItemData: { vendorItemId: 21 } },
    { itemName: '사바나', marketplaceItemData: { vendorItemId: 12 } },
  ],
});

export interface FakeOpts {
  /** 존재 확인 응답(차례로). 다 쓰면 false */
  hit?: boolean[];
  pcs?: Record<string, unknown>[];
  pcc?: Record<string, unknown>[];
  ssl?: Record<string, unknown>[];
  existingListings?: string[];
  missing?: Record<string, unknown>[];
  /** 같은 네이버·토스 옵션을 가리키는 stock_sync_links 전체(as lk 조회) */
  outsideLinks?: Record<string, unknown>[];
  /** 시계(ms) — 호출할 때마다 차례로 */
  clock?: number[];
  /** erp.skus upsert가 manual과 겹쳐 0행 */
  skuConflict?: boolean;
}

export function fake(o: FakeOpts = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const hits = [...(o.hit ?? [])];
  let id = 100;
  let txCount = 0;
  const res = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('order by at desc')) return res(o.missing ?? []);
    if (sql.includes('as hit')) return res([{ hit: hits.shift() ?? false }]);
    if (sql.includes('pg_advisory_xact_lock')) return res([{}]);
    if (sql.includes('from product_costs')) return res(o.pcs ?? [{ id: PC, product_name: '펜들턴', seller_product_id: String(SP), vendor_item_id: null }]);
    if (sql.includes('from product_cost_channels')) return res(o.pcc ?? []);
    if (sql.includes('as lk')) return res(o.outsideLinks ?? []);
    if (sql.includes('from stock_sync_links')) return res(o.ssl ?? []);
    if (sql.includes('as k from erp.channel_listings')) return res((o.existingListings ?? []).map((k) => ({ k })));
    if (sql.includes('insert into erp.skus') && o.skuConflict) return res([]);
    if (sql.includes('insert into erp.listing_skus')) return res([{ ok: 1 }]);
    if (sql.includes('insert into erp.')) return res([{ id: ++id }]);
    return res([]);
  });
  const db = { query };
  const coupang = { getProductDetail: vi.fn(async (sid: number): Promise<unknown> => detail(sid)) };
  const tx: SyncDeps['tx'] = async (fn) => {
    txCount++;
    return fn(db);
  };
  const ticks = [...(o.clock ?? [])];
  const deps: SyncDeps = { db, tx, coupang, ...(o.clock ? { now: () => ticks.shift() ?? Number.MAX_SAFE_INTEGER } : {}) };
  const writes = () => calls.filter((c) => /^\s*(insert|update|delete)/i.test(c.sql));
  return { deps, calls, coupang, writes, txCount: () => txCount };
}
