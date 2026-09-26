import { describe, it, expect } from 'vitest';
import {
  ReceiptSplitError, buildLineOptions, expectedPacks, parseSkuSplits, postReceiptLots, resolveReceiptSplit,
} from '@/lib/erp/ledger/receipt';
import type { Db } from '@/lib/erp/ledger/store';

describe('resolveReceiptSplit', () => {
  it('후보가 하나면 입고 수량 전부', () => {
    expect(resolveReceiptSplit(4, [7])).toEqual([{ skuId: 7, qty: 4 }]);
  });
  it('후보가 없거나 여럿인데 분배가 없으면 거부', () => {
    expect(() => resolveReceiptSplit(4, [])).toThrow(/SKU를 고른다/);
    expect(() => resolveReceiptSplit(4, [7, 8])).toThrow(/옵션별 수량/);
  });
  it('분배 합은 입고 수량과 같아야 하고, 결과는 SKU 오름차순', () => {
    expect(resolveReceiptSplit(4, [7, 8], [{ skuId: 8, qty: 1 }, { skuId: 7, qty: 3 }])).toEqual([{ skuId: 7, qty: 3 }, { skuId: 8, qty: 1 }]);
    expect(() => resolveReceiptSplit(4, [7, 8], [{ skuId: 7, qty: 3 }])).toThrow(/합 3개가 입고 수량 4개와 다르다/);
  });
  it('0개로 나눈 옵션은 빼고 기록한다', () => {
    expect(resolveReceiptSplit(2, [7, 8], [{ skuId: 7, qty: 2 }, { skuId: 8, qty: 0 }])).toEqual([{ skuId: 7, qty: 2 }]);
  });
  it('고른 SKU 하나에 수량이 없으면 입고 수량 전부', () => {
    expect(resolveReceiptSplit(5, [], [{ skuId: 9, qty: null }])).toEqual([{ skuId: 9, qty: 5 }]);
  });
  it('소수 입고 수량·같은 SKU 두 번은 거부', () => {
    expect(() => resolveReceiptSplit(1.5, [7])).toThrow(ReceiptSplitError);
    expect(() => resolveReceiptSplit(2, [], [{ skuId: 9, qty: 1 }, { skuId: 9, qty: 1 }])).toThrow(/두 번/);
  });
});

describe('buildLineOptions', () => {
  const learned = [{ supplierCode: '111', skuId: 11, key: 'k11', name: 'A', option: '블랙' }];
  const byProduct = [{ skuId: 21, key: 'k21', name: 'B', option: '', legacy: ['pc-2'] }];
  it('기억한 품번 연결(purchase_units)이 먼저', () => {
    expect(buildLineOptions('111', 'pc-2', learned, byProduct)).toEqual({ source: 'learned', candidates: [{ skuId: 11, key: 'k11', name: 'A', option: '블랙' }] });
  });
  it('없으면 상품(product_cost) 연결', () => {
    expect(buildLineOptions('999', 'pc-2', learned, byProduct)).toEqual({ source: 'product', candidates: [{ skuId: 21, key: 'k21', name: 'B', option: '' }] });
  });
  it('둘 다 없으면 none', () => {
    expect(buildLineOptions(null, null, learned, byProduct)).toEqual({ source: 'none', candidates: [] });
  });
});

describe('expectedPacks', () => {
  it('일반은 수량 그대로, 소분은 추정(이월 모름)', () => {
    expect(expectedPacks({ entry_type: 'normal', quantity: 3, items_per_box: null, subdivision_unit: null })).toEqual({ qty: 3, approx: false });
    expect(expectedPacks({ entry_type: 'subdivision', quantity: 1, items_per_box: 12, subdivision_unit: 6 })).toEqual({ qty: 2, approx: true });
    expect(expectedPacks({ entry_type: 'normal', quantity: 1.5, items_per_box: null, subdivision_unit: null })).toBeNull();
  });
});

describe('parseSkuSplits', () => {
  it('{ 줄번호: [{ sku_id, qty }] }', () => {
    expect(parseSkuSplits(undefined)).toEqual({});
    expect(parseSkuSplits({ 2: [{ sku_id: 7, qty: 3 }, { sku_id: 8, qty: null }] })).toEqual({ 2: [{ skuId: 7, qty: 3 }, { skuId: 8, qty: null }] });
  });
  it('형태가 틀리면 ReceiptSplitError', () => {
    expect(() => parseSkuSplits([1, 2])).toThrow(ReceiptSplitError);
    expect(() => parseSkuSplits({ x: [] })).toThrow(ReceiptSplitError);
  });
});

function fakeDb(o: { productRows?: Record<string, unknown>[]; active?: number[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select p.supplier_code')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('select s.id, s.key')) return { rows: o.productRows ?? [], rowCount: 0 };
      if (sql.startsWith('select id from erp.skus where id = any')) return { rows: (o.active ?? []).map((id) => ({ id })), rowCount: 0 };
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      if (sql.startsWith('insert into erp.purchase_units')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('postReceiptLots', () => {
  const base = {
    lineId: 'line-1', lineNo: 1, itemCode: '111', itemLabel: '라운드티', productCostId: 'pc-2', packs: 4, unitCost: 2500, receivedAt: '2026-09-20',
  };
  const productRows = [
    { id: '21', key: 'k21', name: '라운드티', option_label: '블랙', legacy: ['pc-2'] },
    { id: '22', key: 'k22', name: '라운드티', option_label: '레드', legacy: ['pc-2'] },
  ];

  it('SKU 오름차순으로 receipt lot(구매일 KST 자정)을 만들고 품번 연결을 기억한다', async () => {
    const f = fakeDb({ productRows, active: [21, 22] });
    const split = await postReceiptLots(f.db, { ...base, requested: [{ skuId: 22, qty: 1 }, { skuId: 21, qty: 3 }] });
    expect(split).toEqual([{ skuId: 21, qty: 3 }, { skuId: 22, qty: 1 }]);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => [c.params[0], c.params[1], c.params[2], c.params[3], c.params[5], c.params[6], c.params[7], c.params[8], c.params[10]])).toEqual([
      [21, 'self', 3, 'receipt', 2500, '2026-09-20T00:00:00+09:00', 'receipt_line', 'line-1', 'receipt:line-1:21'],
      [22, 'self', 1, 'receipt', 2500, '2026-09-20T00:00:00+09:00', 'receipt_line', 'line-1', 'receipt:line-1:22'],
    ]);
    expect(f.calls.filter((c) => c.sql.startsWith('insert into erp.purchase_units')).map((c) => c.params)).toEqual([
      ['111', '라운드티', 21],
      ['111', '라운드티', 22],
    ]);
  });

  it('고른 SKU가 활성이 아니면 거부(아무것도 쓰지 않는다)', async () => {
    const f = fakeDb({ productRows, active: [] });
    await expect(postReceiptLots(f.db, { ...base, requested: [{ skuId: 21, qty: 4 }] })).rejects.toThrow(/활성 SKU가 아니다/);
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });

  it('품번이 없으면 학습하지 않는다', async () => {
    const f = fakeDb({ productRows: [productRows[0]], active: [21] });
    await postReceiptLots(f.db, { ...base, itemCode: null });
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.purchase_units'))).toBe(false);
  });
});
