// src/__tests__/lib/erp/sku/upsert.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SKU_MASTER_LOCK, insertLinks, lockSkuMaster, upsertListings, upsertSkus, validateDraft, type DraftRows } from '@/lib/erp/sku/upsert';

const PC = '7cab2ba8-cb4e-4c3a-8d3f-273455c1513a';
const rows = (): DraftRows => ({
  skus: [{ key: 'cp:1:블랙', name: '왜건', optionLabel: '블랙', baseUnitLabel: null, status: 'active', legacyProductCostIds: [PC] }],
  listings: [{ key: 'coupang_wing|11|', channel: 'coupang_wing', externalProductId: '11', externalOptionKey: '', altProductId: '1', label: '왜건 · 블랙', linkMode: 'single' }],
  links: [{ listingKey: 'coupang_wing|11|', skuKey: 'cp:1:블랙', multiplier: 1 }],
});

function fake(empty: string[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let id = 10;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (empty.some((frag) => sql.includes(frag))) return { rows: [], rowCount: 0 };
    return { rows: [{ id: ++id }], rowCount: 1 };
  });
  return { db: { query }, calls };
}

describe('validateDraft', () => {
  it('정상이면 던지지 않는다', () => expect(() => validateDraft(rows())).not.toThrow());
  it('비어 있으면 던진다', () => expect(() => validateDraft({ ...rows(), links: [] })).toThrow(/비어 있는 것/));
  it('uuid 아닌 원가 연결 · single인데 SKU 2개 · 배수 0을 잡는다', () => {
    const d = rows();
    d.skus[0].legacyProductCostIds = ['pc-1'];
    d.skus.push({ ...d.skus[0], key: 'cp:1:레드', legacyProductCostIds: [] });
    d.links.push({ listingKey: 'coupang_wing|11|', skuKey: 'cp:1:레드', multiplier: 0 });
    expect(() => validateDraft(d)).toThrow(/uuid 아님[\s\S]*배수가 양의 정수가 아니다[\s\S]*single인데 SKU 2개/);
  });
});

describe('upsert', () => {
  it('잠금은 bigint 7103', async () => {
    const f = fake();
    await lockSkuMaster(f.db);
    expect(SKU_MASTER_LOCK).toBe(7103);
    expect(f.calls[0]).toEqual({ sql: 'select pg_advisory_xact_lock($1::bigint)', params: [7103] });
  });

  it('SKU — 원가 연결은 DB ∪ 초안, draft 행만 덮는다 · 키→id 맵', async () => {
    const f = fake();
    const ids = await upsertSkus(f.db, rows().skus);
    expect([...ids]).toEqual([['cp:1:블랙', 11]]);
    expect(f.calls[0].sql).toContain('unnest(erp.skus.legacy_product_cost_ids || excluded.legacy_product_cost_ids)');
    expect(f.calls[0].sql).toContain("where erp.skus.origin = 'draft'");
    expect(f.calls[0].params).toEqual(['cp:1:블랙', '왜건', '블랙', null, 'active', [PC]]);
  });

  it('manual과 겹치면(0행) 던진다', async () => {
    await expect(upsertSkus(fake(['insert into erp.skus']).db, rows().skus)).rejects.toThrow('초안 키 cp:1:블랙가 manual SKU와 겹친다');
    await expect(upsertListings(fake(['insert into erp.channel_listings']).db, rows().listings)).rejects.toThrow('manual 리스팅과 겹친다');
  });

  it('리스팅 → 연결', async () => {
    const f = fake();
    const sku = await upsertSkus(f.db, rows().skus);
    const lst = await upsertListings(f.db, rows().listings);
    await insertLinks(f.db, rows().links, sku, lst);
    expect(f.calls[1].params).toEqual(['coupang_wing', '11', '', '1', '왜건 · 블랙', 'single']);
    expect(f.calls[2].sql).toContain('on conflict (listing_id, sku_id) do nothing');
    expect(f.calls[2].params).toEqual([12, 11, 1]);
  });

  it('연결 대상이 맵에 없으면 던진다', async () => {
    await expect(insertLinks(fake().db, rows().links, new Map(), new Map())).rejects.toThrow('연결 대상 누락');
  });
});
