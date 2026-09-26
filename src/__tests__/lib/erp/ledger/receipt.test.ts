import { describe, it, expect } from 'vitest';
import {
  LEARNED_LABEL_SUFFIX, ReceiptSplitError, buildLineOptions, expectedPacks, parseSkuSplits, postReceiptLots, resolveReceiptSplit,
} from '@/lib/erp/ledger/receipt';
import type { Db } from '@/lib/erp/ledger/store';

describe('resolveReceiptSplit', () => {
  it('후보가 하나면 입고 수량 전부', () => {
    expect(resolveReceiptSplit(4, [7])).toEqual([{ skuId: 7, qty: 4 }]);
  });
  it('후보가 없거나 여럿인데 분배가 없으면 거부', () => {
    expect(() => resolveReceiptSplit(4, [])).toThrow(/SKU를 골라 주세요/);
    expect(() => resolveReceiptSplit(4, [7, 8])).toThrow(/옵션별 수량을 나눠 주세요/);
  });
  it('🔴 나누기·고르기가 필요한 줄의 실패 사유는 휴대폰 영수증 화면을 가리킨다(PC 모달에는 나누기 화면이 없다)', () => {
    expect(() => resolveReceiptSplit(4, [])).toThrow('휴대폰 영수증 화면(/m/receipt)에서 SKU를 골라 주세요');
    expect(() => resolveReceiptSplit(4, [7, 8])).toThrow('휴대폰 영수증 화면(/m/receipt)에서 옵션별 수량을 나눠 주세요');
  });
  it('분배 합은 입고 수량과 같아야 하고, 결과는 SKU 오름차순', () => {
    expect(resolveReceiptSplit(4, [7, 8], [{ skuId: 8, qty: 1 }, { skuId: 7, qty: 3 }])).toEqual([{ skuId: 7, qty: 3 }, { skuId: 8, qty: 1 }]);
    expect(() => resolveReceiptSplit(4, [7, 8], [{ skuId: 7, qty: 3 }])).toThrow(/합 3개가 입고 수량 4개와 다릅니다/);
  });
  it('0개로 나눈 옵션은 빼고 기록한다', () => {
    expect(resolveReceiptSplit(2, [7, 8], [{ skuId: 7, qty: 2 }, { skuId: 8, qty: 0 }])).toEqual([{ skuId: 7, qty: 2 }]);
  });
  it('고른 SKU 하나에 수량이 없으면 입고 수량 전부', () => {
    expect(resolveReceiptSplit(5, [], [{ skuId: 9, qty: null }])).toEqual([{ skuId: 9, qty: 5 }]);
  });
  it('소수 입고 수량·같은 SKU 두 번은 거부 — 메시지에 SKU id 대신 이름을 쓴다', () => {
    expect(() => resolveReceiptSplit(1.5, [7])).toThrow(ReceiptSplitError);
    const labelOf = (id: number) => (id === 9 ? '라운드티 · 블랙' : '고른 SKU');
    expect(() => resolveReceiptSplit(2, [], [{ skuId: 9, qty: 1 }, { skuId: 9, qty: 1 }], { labelOf })).toThrow('「라운드티 · 블랙」이 두 번 들어 있습니다.');
  });
  it('🔴 후보가 있으면 후보 밖 SKU는 「다른 SKU로 바꾸기」(manual)로 온 것만 받는다', () => {
    const labelOf = (id: number) => (id === 99 ? '머그컵' : '고른 SKU');
    expect(() => resolveReceiptSplit(4, [7], [{ skuId: 99, qty: null }], { labelOf })).toThrow(/「머그컵」은 이 품목의 옵션 후보가 아닙니다/);
    expect(resolveReceiptSplit(4, [7], [{ skuId: 99, qty: null, manual: true }])).toEqual([{ skuId: 99, qty: 4 }]);
    // 후보가 없으면(사람이 검색해 고른 것) 제한 없다
    expect(resolveReceiptSplit(4, [], [{ skuId: 99, qty: null }])).toEqual([{ skuId: 99, qty: 4 }]);
  });
  it('사용자 메시지는 ~습니다 체이고 SKU id를 드러내지 않는다', () => {
    const msgs: string[] = [];
    const tryIt = (f: () => unknown) => { try { f(); } catch (e) { msgs.push((e as Error).message); } };
    tryIt(() => resolveReceiptSplit(4, []));
    tryIt(() => resolveReceiptSplit(4, [7, 8]));
    tryIt(() => resolveReceiptSplit(4, [7, 8], [{ skuId: 7, qty: 3 }]));
    tryIt(() => resolveReceiptSplit(4, [7, 8], [{ skuId: 7, qty: -1 }, { skuId: 8, qty: 5 }]));
    tryIt(() => resolveReceiptSplit(4, [7], [{ skuId: 0, qty: 4 }]));
    tryIt(() => resolveReceiptSplit(4, [7], [{ skuId: 55, qty: 4 }]));
    expect(msgs).toHaveLength(6);
    for (const m of msgs) {
      expect(m).toMatch(/(니다|세요)\.?$/);
      expect(m).not.toMatch(/SKU \d|\b55\b/);
    }
  });
});

describe('buildLineOptions', () => {
  const learned = [{ supplierCode: '111', skuId: 11, key: 'k11', name: 'A', option: '블랙' }];
  const byProduct = [
    { skuId: 21, key: 'k21', name: 'B', option: '', legacy: ['pc-2'] },
    { skuId: 11, key: 'k11', name: 'A', option: '블랙', legacy: ['pc-2'] },
  ];
  it('🔴 기억한 품번 연결과 상품 연결을 합친다 — 기억한 것이 먼저, 중복은 한 번', () => {
    expect(buildLineOptions('111', 'pc-2', learned, byProduct)).toEqual({ source: 'learned', candidates: [
      { skuId: 11, key: 'k11', name: 'A', option: '블랙' },
      { skuId: 21, key: 'k21', name: 'B', option: '' },
    ] });
  });
  it('기억한 연결이 없으면 상품(product_cost) 연결', () => {
    expect(buildLineOptions('999', 'pc-2', learned, byProduct)).toEqual({ source: 'product', candidates: [
      { skuId: 21, key: 'k21', name: 'B', option: '' },
      { skuId: 11, key: 'k11', name: 'A', option: '블랙' },
    ] });
  });
  it('상품 연결이 없으면 기억한 것만', () => {
    expect(buildLineOptions('111', 'pc-x', learned, byProduct)).toEqual({ source: 'learned', candidates: [{ skuId: 11, key: 'k11', name: 'A', option: '블랙' }] });
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
    expect(parseSkuSplits({ 3: [{ sku_id: 9, qty: null, manual: true }] })).toEqual({ 3: [{ skuId: 9, qty: null, manual: true }] });
  });
  it('형태가 틀리면 ReceiptSplitError', () => {
    expect(() => parseSkuSplits([1, 2])).toThrow(ReceiptSplitError);
    expect(() => parseSkuSplits({ x: [] })).toThrow(ReceiptSplitError);
  });
});

function fakeDb(o: { productRows?: Record<string, unknown>[]; extraSkus?: Record<string, unknown>[]; active?: number[]; openedAfter?: number[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select p.supplier_code')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('select s.id, s.key')) return { rows: o.productRows ?? [], rowCount: 0 };
      if (sql.startsWith('select id, name, option_label, status from erp.skus where id = any')) {
        const all = [...(o.productRows ?? []), ...(o.extraSkus ?? [])];
        return {
          rows: (params[0] as number[]).map((id) => all.find((r) => Number(r.id) === id)).filter(Boolean)
            .map((r) => ({ id: r!.id, name: r!.name, option_label: r!.option_label, status: (o.active ?? []).includes(Number(r!.id)) ? 'active' : 'inactive' })),
          rowCount: 0,
        };
      }
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('select distinct o.sku_id from erp.stock_ledger o')) {
        const ids = (params[0] as number[]).filter((id) => (o.openedAfter ?? []).includes(id));
        return { rows: ids.map((id) => ({ sku_id: String(id) })), rowCount: ids.length };
      }
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

  it('SKU 오름차순으로 receipt lot(구매일 KST 자정)을 만들고, 사람이 나눈 SKU를 표시해 기억한다', async () => {
    const f = fakeDb({ productRows, active: [21, 22] });
    const r = await postReceiptLots(f.db, { ...base, requested: [{ skuId: 22, qty: 1 }, { skuId: 21, qty: 3 }] });
    expect(r).toEqual({ split: [{ skuId: 21, qty: 3 }, { skuId: 22, qty: 1 }], skippedPreOpening: [] });
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => [c.params[0], c.params[1], c.params[2], c.params[3], c.params[5], c.params[6], c.params[7], c.params[8], c.params[10]])).toEqual([
      [21, 'self', 3, 'receipt', 2500, '2026-09-20T00:00:00+09:00', 'receipt_line', 'line-1', 'receipt:line-1:21'],
      [22, 'self', 1, 'receipt', 2500, '2026-09-20T00:00:00+09:00', 'receipt_line', 'line-1', 'receipt:line-1:22'],
    ]);
    expect(f.calls.filter((c) => c.sql.startsWith('insert into erp.purchase_units')).map((c) => c.params)).toEqual([
      ['111', `라운드티 ${LEARNED_LABEL_SUFFIX}`, 21],
      ['111', `라운드티 ${LEARNED_LABEL_SUFFIX}`, 22],
    ]);
  });

  it('🔴 후보 하나 자동 입고는 학습하지 않는다(사람이 고른 것이 없다)', async () => {
    const f = fakeDb({ productRows: [productRows[0]], active: [21] });
    expect((await postReceiptLots(f.db, base)).split).toEqual([{ skuId: 21, qty: 4 }]);
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.purchase_units'))).toBe(false);
  });

  it('「다른 SKU로 바꾸기」로 고른 후보 밖 SKU는 받고 기억한다', async () => {
    const f = fakeDb({ productRows: [productRows[0]], extraSkus: [{ id: '99', name: '머그컵', option_label: null }], active: [21, 99] });
    expect((await postReceiptLots(f.db, { ...base, requested: [{ skuId: 99, qty: null, manual: true }] })).split).toEqual([{ skuId: 99, qty: 4 }]);
    expect(f.calls.filter((c) => c.sql.startsWith('insert into erp.purchase_units')).map((c) => c.params)).toEqual([['111', `라운드티 ${LEARNED_LABEL_SUFFIX}`, 99]]);
  });

  it('고른 SKU가 활성이 아니면 이름으로 거부(아무것도 쓰지 않는다)', async () => {
    const f = fakeDb({ productRows, active: [] });
    await expect(postReceiptLots(f.db, { ...base, requested: [{ skuId: 21, qty: 4 }] })).rejects.toThrow('「라운드티 · 블랙」은 판매 중인 SKU가 아닙니다 — 다시 골라 주세요.');
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });

  it('품번이 없으면 학습하지 않는다', async () => {
    const f = fakeDb({ productRows, active: [21, 22] });
    await postReceiptLots(f.db, { ...base, itemCode: null, requested: [{ skuId: 21, qty: 4 }] });
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.purchase_units'))).toBe(false);
  });

  it('🔴 실사 이전 구매(기초 전표 시각 ≥ 구매일 KST 자정)인 SKU는 원장 입고를 건너뛰고 알린다 — 기초재고에 이미 세었다', async () => {
    const f = fakeDb({ productRows, active: [21, 22], openedAfter: [22] });
    const r = await postReceiptLots(f.db, { ...base, requested: [{ skuId: 22, qty: 1 }, { skuId: 21, qty: 3 }] });
    expect(r.split).toEqual([{ skuId: 21, qty: 3 }, { skuId: 22, qty: 1 }]);
    expect(r.skippedPreOpening).toEqual([{ skuId: 22, qty: 1, label: '라운드티 · 레드' }]);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => c.params[0])).toEqual([21]);
    // 기초 조회는 두 SKU를 모두 잠근 뒤, 구매일 KST 자정을 기준으로 self·opening·되돌리지 않은 전표만 본다
    const q = f.calls.findIndex((c) => c.sql.startsWith('select distinct o.sku_id'));
    const locks = f.calls.map((c, i) => [c, i] as const).filter(([c]) => c.sql.startsWith('select pg_advisory_xact_lock')).map(([, i]) => i);
    expect(locks.slice(0, 2).every((i) => i < q)).toBe(true);
    expect(f.calls[q].params).toEqual([[21, 22], '2026-09-20T00:00:00+09:00']);
    expect(f.calls[q].sql).toMatch(/location = 'self'/);
    expect(f.calls[q].sql).toMatch(/kind = 'opening'/);
    expect(f.calls[q].sql).toMatch(/occurred_at >= \$2::timestamptz/);
    expect(f.calls[q].sql).toMatch(/reverses_id = o\.id/);
    // 품번 학습은 그대로(사람이 나눴다)
    expect(f.calls.filter((c) => c.sql.startsWith('insert into erp.purchase_units'))).toHaveLength(2);
  });

  it('모든 SKU가 실사 이전 구매면 원장에 아무것도 쓰지 않는다', async () => {
    const f = fakeDb({ productRows: [productRows[0]], active: [21], openedAfter: [21] });
    const r = await postReceiptLots(f.db, base);
    expect(r).toEqual({ split: [{ skuId: 21, qty: 4 }], skippedPreOpening: [{ skuId: 21, qty: 4, label: '라운드티 · 블랙' }] });
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.stock_ledger'))).toBe(false);
  });
});
