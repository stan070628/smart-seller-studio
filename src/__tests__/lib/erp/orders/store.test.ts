import { describe, it, expect } from 'vitest';
import {
  advanceCursor, ensureCursorRow, loadManualSkus, markAbsentCanceled, readCutover, reevaluateUnknownLines, releaseLease, takeLease, upsertOrderLines,
  type ResolvedLine,
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
    expect(r).toEqual({ ids: [100, 101, 102], changedIds: [100, 101, 102], inserted: 1, updated: 2, unchanged: 0 });

    const orders = f.calls.filter((c) => c.sql.startsWith('insert into erp.orders'));
    expect(orders.map((c) => [c.params[1], c.params[4]])).toEqual([['31000000001', 'paid'], ['31000000002', 'canceled']]);
    const lines = f.calls.filter((c) => c.sql.startsWith('insert into erp.order_lines'));
    expect(lines[0].sql).toContain("case when excluded.status = 'unknown' then erp.order_lines.status else excluded.status end");
    // [0]order_id [3]listing_id [4]sku_id [5]alloc [6]attribution [8]order_qty [9]sku_qty [12]status [20]legacy_key [21]legacy_pc [22]legacy_qty
    expect([lines[0].params[0], lines[0].params[3], lines[0].params[4], lines[0].params[5], lines[0].params[6], lines[0].params[9], lines[0].params[21], lines[0].params[22]])
      .toEqual([10, 5, 7, '[{"skuId":7,"qty":2}]', 'mapped', 2, PC, 2]);
    expect([lines[1].params[4], lines[1].params[9], lines[1].params[21]]).toEqual([null, 3, null]);
    expect(lines[2].params[0]).toBe(11);
    // (I3) status_unmapped = 이번 채널 상태가 매핑표에 없었는가 · (I1) 다시 보이면 absent_since를 지운다
    expect(lines[0].params[23]).toBe(false);
    expect(lines[0].sql).toContain('status_unmapped = excluded.status_unmapped');
    expect(lines[0].sql).toContain('absent_since = null');
    // (M3) 안 바뀐 라인은 쓰지 않는다
    expect(lines[0].sql).toMatch(/where \(erp\.order_lines\.[\s\S]*\) is distinct from \(/);
    // 구매자 칸은 SQL에도 파라미터에도 없다
    expect(JSON.stringify(f.calls)).not.toMatch(/orderer|receiver|address|phone|tel/i);
  });

  it('빈 목록이면 아무것도 쓰지 않는다', async () => {
    const f = fakeDb(() => undefined);
    expect(await upsertOrderLines(f.db, [])).toEqual({ ids: [], changedIds: [], inserted: 0, updated: 0, unchanged: 0 });
  });

  it('(M3) 안 바뀐 라인은 returning이 비고 — id만 다시 읽고 updated·changedIds에서 뺀다', async () => {
    const f = fakeDb((sql) => {
      if (sql.startsWith('insert into erp.orders')) return { rows: [{ id: 10 }] };
      if (sql.startsWith('insert into erp.order_lines')) return { rows: [] };
      if (sql.startsWith('select id from erp.order_lines where channel = $1 and external_line_id = $2')) return { rows: [{ id: 55 }] };
      return undefined;
    });
    const r = await upsertOrderLines(f.db, [line({})]);
    expect(r).toEqual({ ids: [55], changedIds: [], inserted: 0, updated: 0, unchanged: 1 });
  });

  it('(I3) 매핑표에 없는 상태는 status_unmapped = true', async () => {
    const f = fakeDb((sql) => {
      if (sql.startsWith('insert into erp.orders')) return { rows: [{ id: 10 }] };
      if (sql.startsWith('insert into erp.order_lines')) return { rows: [{ id: 1, inserted: false }] };
      return undefined;
    });
    await upsertOrderLines(f.db, [line({ status: 'unknown', rawStatus: 'NEW_THING' })]);
    const ins = f.calls.find((c) => c.sql.startsWith('insert into erp.order_lines'));
    expect(ins?.params[23]).toBe(true);
  });
});

describe('markAbsentCanceled', () => {
  const cover = { field: 'paid_at' as const, from: '2026-09-25T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' };
  const STARTED = '2026-09-27T03:00:00.000Z';
  const IN = '2026-09-26T01:00:00.000Z';
  const seenLine = (id: string, at = IN) => ({ externalLineId: id, orderedAt: at, paidAt: at });
  type Row = { id: number; legacy_key: string | null; absent_since: string | null; external_line_id: string };
  const coverRows = (absent: Row[], seenCount: number): Row[] => [
    ...absent,
    ...Array.from({ length: seenCount }, (_, i) => ({ id: 1000 + i, legacy_key: null, absent_since: null, external_line_id: `s${i}` })),
  ];
  const db = (rows: Row[]) => fakeDb((sql) => {
    if (sql.startsWith('select id, legacy_key, absent_since, external_line_id from erp.order_lines')) return { rows };
    if (sql.startsWith('update erp.order_lines set absent_since')) return { rows: [] };
    if (sql.startsWith("update erp.order_lines set status = 'canceled'")) return { rows: [{ order_id: 3 }] };
    if (sql.startsWith('update erp.orders')) return { rows: [] };
    return undefined;
  });
  const seenAll = (n: number) => Array.from({ length: n }, (_, i) => seenLine(`s${i}`));

  it('cover 구간·이번 수집 전에 처음 본 라인만 본다(first_seen_at < 수집 시작)', async () => {
    const f = db(coverRows([], 3));
    await markAbsentCanceled(f.db, 'coupang_rg', cover, seenAll(3), STARTED);
    expect(f.calls[0].sql).toContain('paid_at >= $2 and paid_at < $3');
    expect(f.calls[0].sql).toContain('first_seen_at < $4');
    expect(f.calls[0].sql).toContain("status <> 'canceled'");
    expect(f.calls[0].params).toEqual(['coupang_rg', cover.from, cover.to, STARTED]);
  });

  it('(I1) 처음 사라지면 absent_since만 적고 상태는 그대로', async () => {
    const f = db(coverRows([{ id: 5, legacy_key: 'rg-1-80', absent_since: null, external_line_id: 'gone' }], 9));
    const r = await markAbsentCanceled(f.db, 'coupang_rg', cover, seenAll(9), STARTED);
    expect(r).toMatchObject({ ids: [], legacyKeys: [], marked: 1, absent: 1, refused: null });
    const upd = f.calls.filter((c) => c.sql.startsWith('update'));
    expect(upd).toHaveLength(1);
    expect(upd[0].sql).toContain('absent_since = now()');
    expect(upd[0].params).toEqual([[5]]);
  });

  it('(I1) 이전 수집에서 이미 사라졌던(absent_since 있음) 라인만 취소하고 주문 상태를 맞춘다', async () => {
    const f = db(coverRows([
      { id: 5, legacy_key: 'rg-1-80', absent_since: '2026-09-27T02:45:00.000Z', external_line_id: 'gone1' },
      { id: 6, legacy_key: 'rg-2-80', absent_since: null, external_line_id: 'gone2' },
    ], 18));
    const r = await markAbsentCanceled(f.db, 'coupang_rg', cover, seenAll(18), STARTED);
    expect(r).toMatchObject({ ids: [5], legacyKeys: ['rg-1-80'], marked: 1, absent: 2, refused: null });
    const cancel = f.calls.find((c) => c.sql.startsWith("update erp.order_lines set status = 'canceled'"));
    expect(cancel?.sql).toContain("raw_status = 'ABSENT'");
    expect(cancel?.params).toEqual([[5]]);
    expect(f.calls.find((c) => c.sql.startsWith('update erp.order_lines set absent_since'))?.params).toEqual([[6]]);
    expect(f.calls.some((c) => c.sql.startsWith('update erp.orders'))).toBe(true);
  });

  it('(I1) cover 안에서 받은 라인이 0건인데 사라진 라인이 있으면 아무것도 바꾸지 않고 의심으로 보고한다', async () => {
    const f = db(coverRows([{ id: 5, legacy_key: null, absent_since: '2026-09-27T02:45:00.000Z', external_line_id: 'gone' }], 0));
    // cover 밖(첫날) 라인만 받았다
    const r = await markAbsentCanceled(f.db, 'coupang_rg', cover, [seenLine('x', '2026-09-25T10:00:00.000Z')], STARTED);
    expect(r).toMatchObject({ ids: [], marked: 0, absent: 1, refused: { reason: 'empty_fetch', absent: 1, seenInCover: 0 } });
    expect(f.calls.some((c) => c.sql.startsWith('update'))).toBe(false);
  });

  it('사라진 라인이 5건 이상이고 받은 라인보다 많으면 바꾸지 않고 보고한다(기존 문턱)', async () => {
    const gone = [1, 2, 3, 4, 5, 6].map((id) => ({ id, legacy_key: `rg-${id}`, absent_since: null, external_line_id: `g${id}` }));
    const f = db(coverRows(gone, 1));
    const r = await markAbsentCanceled(f.db, 'coupang_rg', cover, seenAll(1), STARTED);
    expect(r.refused).toMatchObject({ reason: 'more_absent_than_seen', absent: 6, seenInCover: 1 });
    expect(f.calls.some((c) => c.sql.startsWith('update'))).toBe(false);
  });

  it('(I1) 사라진 라인이 cover 행의 20%를 넘으면(2건 이상) 바꾸지 않고 보고한다', async () => {
    const gone = [1, 2, 3].map((id) => ({ id, legacy_key: null, absent_since: '2026-09-27T02:45:00.000Z', external_line_id: `g${id}` }));
    const f = db(coverRows(gone, 9)); // 3 / 12 = 25%
    const r = await markAbsentCanceled(f.db, 'coupang_rg', cover, seenAll(9), STARTED);
    expect(r.refused).toMatchObject({ reason: 'over_20pct', absent: 3, coverRows: 12 });
    expect(f.calls.some((c) => c.sql.startsWith('update'))).toBe(false);
  });

  it('(I1) 20% 문턱은 사라진 라인 1건에는 걸지 않는다(한가한 주의 진짜 취소 1건이 영영 막히지 않게)', async () => {
    const f = db(coverRows([{ id: 5, legacy_key: null, absent_since: '2026-09-27T02:45:00.000Z', external_line_id: 'g' }], 2)); // 1/3
    const r = await markAbsentCanceled(f.db, 'coupang_rg', cover, seenAll(2), STARTED);
    expect(r).toMatchObject({ ids: [5], refused: null });
  });

  it('사라진 라인이 없으면 쓰지 않는다', async () => {
    const f = db(coverRows([], 4));
    expect(await markAbsentCanceled(f.db, 'coupang_rg', cover, seenAll(4), STARTED)).toEqual({ ids: [], legacyKeys: [], marked: 0, absent: 0, refused: null });
    expect(f.calls.some((c) => c.sql.startsWith('update'))).toBe(false);
  });
});

describe('수집 임대(lease)', () => {
  it('커서 행이 없으면 기초 시각으로 만든다(있으면 그대로)', async () => {
    const f = fakeDb(() => ({ rows: [] }));
    await ensureCursorRow(f.db, 'coupang_wing', '2026-09-26T11:07:04.989Z');
    expect(f.calls[0].sql).toContain('on conflict (name) do nothing');
    expect(f.calls[0].params).toEqual(['orders:coupang_wing', '2026-09-26T11:07:04.989Z']);
  });

  it('비었거나 만료된 임대만 잡는다 — 잡으면 DB 시각을 돌려준다', async () => {
    const f = fakeDb(() => ({ rows: [{ at: new Date('2026-09-27T03:00:00Z') }] }));
    expect(await takeLease(f.db, 'naver', 'run-1')).toEqual({ ok: true, at: '2026-09-27T03:00:00.000Z' });
    expect(f.calls[0].sql).toContain("lease_until = now() + interval '10 min'");
    expect(f.calls[0].sql).toContain('lease_until is null or lease_until < now()');
    expect(f.calls[0].params).toEqual(['orders:naver', 'run-1']);
    const g = fakeDb(() => ({ rows: [] }));
    expect(await takeLease(g.db, 'naver', 'run-2')).toEqual({ ok: false, at: null });
  });

  it('주인일 때만 푼다', async () => {
    const f = fakeDb(() => ({ rows: [] }));
    await releaseLease(f.db, 'toss', 'run-1');
    expect(f.calls[0].sql).toContain('lease_owner = $2');
    expect(f.calls[0].sql).toContain('lease_until = null');
    expect(f.calls[0].params).toEqual(['orders:toss', 'run-1']);
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
    // (I3) status가 아니라 status_unmapped로 고른다 — unknown 상태는 이전 값을 지키므로 status='unknown'으로는 못 찾는다
    expect(f.calls[0].sql).toContain('status_unmapped');
    expect(f.calls[0].sql).not.toContain("status = 'unknown'");
    expect(f.calls[0].params).toEqual(['coupang_wing']);
    const upd = f.calls.filter((c) => c.sql.startsWith('update erp.order_lines set status'));
    expect(upd).toHaveLength(1);
    expect(upd[0].sql).toContain('status_unmapped = false');
    expect(upd[0].params).toEqual([1, 'paid']);
    const cnt = f.calls.find((c) => c.sql.startsWith('select count(*)::int as n'));
    expect(cnt?.sql).toContain('status_unmapped');
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
      if (sql.startsWith('insert into sale_records')) return { rows: [{ id: `sr-${params[6]}`, inserted: true, still_voided: false }] };
      if (sql.startsWith('update erp.order_lines set legacy_sale_id')) return { rows: [] };
      if (sql.startsWith('update sale_records set voided_at') && Array.isArray(params[0])) return { rows: [{ key: 'naver-5' }], rowCount: 1 };
      if (sql.startsWith('update sale_records set voided_at')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('update erp.order_lines set legacy_voided_at')) return { rows: [] };
      return undefined;
    });
    const r = await syncLegacySales(f.db, ['wing-1-70', 'toss-9', 'naver-5']);
    expect(r).toEqual({ upserted: 2, inserted: 2, voided: 2, warnings: [] });
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into sale_records'));
    expect(ins[0].sql).toContain('from product_costs pc where pc.id = $1::uuid');
    expect(ins[0].sql).not.toMatch(/coupon_discount|shipping_fee = excluded|product_cost_id = excluded/);
    // (I6) 무효를 푸는 것은 수집기가 무효화한 행(같은 시각을 order_lines.legacy_voided_at에 남겼다)뿐이다
    expect(ins[0].sql).not.toMatch(/voided_at = null/);
    expect(ins[0].sql).toContain('x.legacy_voided_at = sale_records.voided_at');
    // 수집기가 무효화한 키는 라인에 그 시각을 남긴다
    const stamp = f.calls.find((c) => c.sql.startsWith('update erp.order_lines set legacy_voided_at'));
    expect(stamp?.params).toEqual([['naver-5']]);
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

  it('(I6) 다른 사람이 무효화한 행은 되살리지 않고 경고(voided_elsewhere)로 돌려준다', async () => {
    const f = fakeDb((sql) => {
      if (sql.startsWith('select legacy_key')) {
        return { rows: [
          { legacy_key: 'rg-1-80', channel: 'coupang_rg', status: 'paid', order_qty: 1, legacy_qty: 1, amount: 9900, paid_at: new Date('2026-09-27T01:00:00Z'), ordered_at: new Date('2026-09-27T01:00:00Z'), pc: PC },
        ] };
      }
      if (sql.startsWith('insert into sale_records')) return { rows: [{ id: 'sr-1', inserted: false, still_voided: true }] };
      if (sql.startsWith('update erp.order_lines set legacy_sale_id')) return { rows: [] };
      return undefined;
    });
    const r = await syncLegacySales(f.db, ['rg-1-80']);
    expect(r).toEqual({ upserted: 1, inserted: 0, voided: 0, warnings: [{ key: 'rg-1-80', reason: 'voided_elsewhere' }] });
    const link = f.calls.find((c) => c.sql.startsWith('update erp.order_lines set legacy_sale_id'));
    expect(link?.params).toEqual(['sr-1', 'rg-1-80', true]);
  });

  it('키가 없으면 아무것도 하지 않는다', async () => {
    expect(await syncLegacySales(fakeDb(() => undefined).db, [])).toEqual({ upserted: 0, inserted: 0, voided: 0, warnings: [] });
  });
});

describe('loadManualSkus', () => {
  it('그 채널의 manual_sku_id가 있는 줄만 external_line_id → sku', async () => {
    const f = fakeDb((sql, params) => {
      if (sql.includes('manual_sku_id is not null')) {
        expect(params).toEqual(['toss']);
        return { rows: [{ external_line_id: '318224910', manual_sku_id: '73' }] };
      }
      return undefined;
    });
    expect(await loadManualSkus(f.db, 'toss')).toEqual(new Map([['318224910', 73]]));
  });
});
