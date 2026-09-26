import { describe, it, expect } from 'vitest';
import {
  advanceCursor, markAbsentCanceled, readCutover, reevaluateUnknownLines, upsertOrderLines, type ResolvedLine,
} from '@/lib/erp/orders/store';
import { syncLegacySales } from '@/lib/erp/orders/legacy-store';
import type { Db } from '@/lib/erp/ledger/store';

type Call = { sql: string; params: unknown[] };
function fakeDb(route: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number } | undefined) {
  const calls: Call[] = [];
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const r = route(sql, params);
      if (!r) throw new Error(`예상 못 한 SQL: ${sql.slice(0, 70)}`);
      return { rows: r.rows as any[], rowCount: r.rowCount ?? r.rows.length };
    },
  };
  return { db, calls };
}

const PC = '00000000-0000-4000-8000-00000000000a';
const line = (o: Partial<ResolvedLine>): ResolvedLine => ({
  channel: 'coupang_wing', externalOrderId: '31000000001', externalLineId: '6200000001:70000000001',
  orderedAt: '2026-09-27T01:15:00.000Z', paidAt: '2026-09-27T01:15:30.000Z', rawStatus: 'ACCEPT', status: 'paid',
  productId: '70000000001', optionKey: '', altProductId: '16000000001', productLabel: '접이식 왜건 · 블랙', qty: 2, unitPrice: 15900, amount: 31800,
  resolution: { listingId: 5, attribution: 'mapped', reason: null, alloc: [{ skuId: 7, qty: 2 }], listingSkus: [{ skuId: 7, multiplier: 1 }] },
  legacyKey: 'wing-31000000001-70000000001', legacy: { productCostId: PC, qty: 2 }, ...o,
});

describe('upsertOrderLines', () => {
  it('주문별로 orders를 upsert하고 라인은 (channel, external_line_id)로 upsert — unknown 상태는 기존 상태를 지킨다', async () => {
    let nextOrder = 10;
    let nextLine = 100;
    const f = fakeDb((sql) => {
      if (sql.startsWith('insert into erp.orders')) return { rows: [{ id: nextOrder++ }] };
      if (sql.startsWith('insert into erp.order_lines')) return { rows: [{ id: nextLine++, inserted: nextLine === 101 }] };
      return undefined;
    });
    const bundle = line({
      externalLineId: '6200000001:70000000009', productId: '70000000009', legacyKey: 'wing-31000000001-70000000009', legacy: null,
      resolution: { listingId: 6, attribution: 'mapped', reason: null, alloc: [{ skuId: 4, qty: 1 }, { skuId: 9, qty: 2 }], listingSkus: [] },
    });
    const other = line({ externalOrderId: '31000000002', externalLineId: '6200000002:70000000001', status: 'canceled', rawStatus: 'ACCEPT/CANCELED' });
    const r = await upsertOrderLines(f.db, [line({}), bundle, other]);
    expect(r).toEqual({ ids: [100, 101, 102], inserted: 1, updated: 2 });

    const orders = f.calls.filter((c) => c.sql.startsWith('insert into erp.orders'));
    expect(orders.map((c) => [c.params[1], c.params[4]])).toEqual([['31000000001', 'paid'], ['31000000002', 'canceled']]);
    const lines = f.calls.filter((c) => c.sql.startsWith('insert into erp.order_lines'));
    expect(lines[0].sql).toContain("case when excluded.status = 'unknown' then erp.order_lines.status else excluded.status end");
    // [0]order_id [3]listing_id [4]sku_id [5]alloc [6]attribution [8]order_qty [9]sku_qty [12]status [20]legacy_key [21]legacy_pc [22]legacy_qty
    expect([lines[0].params[0], lines[0].params[3], lines[0].params[4], lines[0].params[5], lines[0].params[6], lines[0].params[9], lines[0].params[21], lines[0].params[22]])
      .toEqual([10, 5, 7, '[{"skuId":7,"qty":2}]', 'mapped', 2, PC, 2]);
    expect([lines[1].params[4], lines[1].params[9], lines[1].params[21]]).toEqual([null, 3, null]);
    expect(lines[2].params[0]).toBe(11);
    // 구매자 칸은 SQL에도 파라미터에도 없다
    expect(JSON.stringify(f.calls)).not.toMatch(/orderer|receiver|address|phone|tel/i);
  });

  it('빈 목록이면 아무것도 쓰지 않는다', async () => {
    const f = fakeDb(() => undefined);
    expect(await upsertOrderLines(f.db, [])).toEqual({ ids: [], inserted: 0, updated: 0 });
  });
});

describe('markAbsentCanceled', () => {
  const cover = { field: 'paid_at' as const, from: '2026-09-25T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' };

  it('cover 구간에서 이번 응답에 없는 라인만 취소로 바꾸고 주문 상태를 맞춘다', async () => {
    const f = fakeDb((sql) => {
      if (sql.startsWith('select id, legacy_key from erp.order_lines')) return { rows: [{ id: 5, legacy_key: 'rg-1-80' }] };
      if (sql.startsWith('update erp.order_lines')) return { rows: [{ order_id: 3 }] };
      if (sql.startsWith('update erp.orders')) return { rows: [] };
      return undefined;
    });
    const r = await markAbsentCanceled(f.db, 'coupang_rg', cover, ['41000000001:80000000001']);
    expect(r).toEqual({ ids: [5], legacyKeys: ['rg-1-80'] });
    expect(f.calls[0].sql).toContain('paid_at >= $2 and paid_at < $3');
    expect(f.calls[0].params).toEqual(['coupang_rg', cover.from, cover.to, ['41000000001:80000000001']]);
    expect(f.calls[1].sql).toContain("status = 'canceled', raw_status = 'ABSENT'");
  });

  it('사라진 라인이 5건 이상이고 받은 라인보다 많으면 응답이 비었을 수 있어 멈춘다', async () => {
    const f = fakeDb((sql) => (sql.startsWith('select id, legacy_key') ? { rows: [1, 2, 3, 4, 5, 6].map((id) => ({ id, legacy_key: `rg-${id}` })) } : undefined));
    await expect(markAbsentCanceled(f.db, 'coupang_rg', cover, ['a'])).rejects.toThrow(/사라진 라인 6건/);
    expect(f.calls.some((c) => c.sql.startsWith('update'))).toBe(false);
  });
});

describe('커서·기초 시각', () => {
  it('기초 시각이 없으면 던진다(기초재고 전에는 수집하지 않는다)', async () => {
    await expect(readCutover(fakeDb(() => ({ rows: [] })).db)).rejects.toThrow(/ledger_cutover/);
  });

  it('커서는 더 늦은 쪽만 남긴다', async () => {
    const f = fakeDb(() => ({ rows: [] }));
    await advanceCursor(f.db, 'naver', '2026-09-27T00:00:00.000Z');
    expect(f.calls[0].sql).toContain('greatest(erp.sync_cursors.cursor_at, excluded.cursor_at)');
    expect(f.calls[0].params).toEqual(['orders:naver', '2026-09-27T00:00:00.000Z']);
  });
});

describe('reevaluateUnknownLines', () => {
  it('raw_status로 다시 판정해 바뀐 라인만 갱신하고 옛 장부 키를 돌려준다 · 남은 unknown 수를 센다', async () => {
    const f = fakeDb((sql) => {
      if (sql.startsWith('select id, raw_status, legacy_key from erp.order_lines')) {
        return { rows: [
          { id: 1, raw_status: 'ACCEPT', legacy_key: 'wing-1-70' }, // wing ACCEPT → paid, 바뀜
          { id: 2, raw_status: 'SOMETHING_NEW', legacy_key: 'wing-2-71' }, // 여전히 unknown, 안 바뀜
        ] };
      }
      if (sql.startsWith('update erp.order_lines set status')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select count(*)::int as n')) return { rows: [{ n: 1 }] };
      return undefined;
    });
    const r = await reevaluateUnknownLines(f.db, 'coupang_wing');
    expect(r).toEqual({ ids: [1], legacyKeys: ['wing-1-70'], remaining: 1 });
    expect(f.calls[0].sql).toContain("status = 'unknown'");
    expect(f.calls[0].params).toEqual(['coupang_wing']);
    const upd = f.calls.filter((c) => c.sql.startsWith('update erp.order_lines set status'));
    expect(upd).toHaveLength(1);
    expect(upd[0].params).toEqual([1, 'paid']);
    const cnt = f.calls.find((c) => c.sql.startsWith('select count(*)::int as n'));
    expect(cnt?.params).toEqual(['coupang_wing']);
  });

  it('아무것도 안 바뀌면 쓰기 없이 남은 수만 센다', async () => {
    const f = fakeDb((sql) => {
      if (sql.startsWith('select id, raw_status, legacy_key from erp.order_lines')) return { rows: [{ id: 9, raw_status: 'NEW_ONE', legacy_key: null }] };
      if (sql.startsWith('select count(*)::int as n')) return { rows: [{ n: 1 }] };
      return undefined;
    });
    const r = await reevaluateUnknownLines(f.db, 'toss');
    expect(r).toEqual({ ids: [], legacyKeys: [], remaining: 1 });
    expect(f.calls.some((c) => c.sql.startsWith('update'))).toBe(false);
  });
});

describe('syncLegacySales', () => {
  it('키별 합산 행을 upsert(product_costs.user_id)하고 라인에 행 id를 적는다 · Wing 무접두 행 무효화 · 무효 키 · 경고를 그대로 돌려준다', async () => {
    const f = fakeDb((sql, params) => {
      if (sql.startsWith('select legacy_key')) {
        return { rows: [
          { legacy_key: 'wing-1-70', channel: 'coupang_wing', status: 'paid', order_qty: 2, legacy_qty: 2, amount: 31800, paid_at: new Date('2026-09-27T01:15:30Z'), ordered_at: new Date('2026-09-27T01:15:00Z'), pc: PC },
          { legacy_key: 'toss-9', channel: 'toss', status: 'paid', order_qty: 1, legacy_qty: 1, amount: 12900, paid_at: new Date('2026-09-27T01:00:00Z'), ordered_at: new Date('2026-09-27T01:00:00Z'), pc: PC },
          { legacy_key: 'naver-5', channel: 'naver', status: 'canceled', order_qty: 1, legacy_qty: 1, amount: 9900, paid_at: null, ordered_at: new Date('2026-09-27T01:00:00Z'), pc: PC },
        ] };
      }
      if (sql.startsWith('insert into sale_records')) return { rows: [{ id: `sr-${params[6]}`, inserted: true }] };
      if (sql.startsWith('update erp.order_lines set legacy_sale_id')) return { rows: [] };
      if (sql.startsWith('update sale_records set voided_at')) return { rows: [], rowCount: 1 };
      return undefined;
    });
    const r = await syncLegacySales(f.db, ['wing-1-70', 'toss-9', 'naver-5']);
    expect(r).toEqual({ upserted: 2, inserted: 2, voided: 2, warnings: [] });
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into sale_records'));
    expect(ins[0].sql).toContain('from product_costs pc where pc.id = $1::uuid');
    expect(ins[0].sql).not.toMatch(/coupon_discount|shipping_fee = excluded|product_cost_id = excluded/);
    // [0]pc [1]sold_at [2]qty [3]price [4]amount [5]channel [6]key [7]shipping_fee
    expect(ins.map((c) => [c.params[1], c.params[2], c.params[3], c.params[5], c.params[6], c.params[7]])).toEqual([
      ['2026-09-27', 2, 15900, 'coupang', 'wing-1-70', 3500],
      ['2026-09-27', 1, 12900, 'toss', 'toss-9', 3500],
    ]);
    const voids = f.calls.filter((c) => c.sql.startsWith('update sale_records set voided_at'));
    expect(voids.map((c) => c.params[0])).toEqual(['1-70', ['naver-5']]);
  });

  it('팔림인데 옛 상품을 못 고르면(product_cost_id null) 경고를 돌려주고 아무것도 쓰지 않는다', async () => {
    const f = fakeDb((sql) => {
      if (sql.startsWith('select legacy_key')) {
        return { rows: [
          { legacy_key: 'naver-7', channel: 'naver', status: 'paid', order_qty: 1, legacy_qty: null, amount: 9900, paid_at: new Date('2026-09-27T01:00:00Z'), ordered_at: new Date('2026-09-27T01:00:00Z'), pc: null },
        ] };
      }
      return undefined;
    });
    const r = await syncLegacySales(f.db, ['naver-7']);
    expect(r).toEqual({ upserted: 0, inserted: 0, voided: 0, warnings: [{ key: 'naver-7', reason: 'sold_without_product_cost' }] });
    expect(f.calls.some((c) => c.sql.startsWith('insert') || c.sql.startsWith('update'))).toBe(false);
  });

  it('키가 없으면 아무것도 하지 않는다', async () => {
    expect(await syncLegacySales(fakeDb(() => undefined).db, [])).toEqual({ upserted: 0, inserted: 0, voided: 0, warnings: [] });
  });
});
