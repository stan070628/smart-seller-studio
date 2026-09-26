import { describe, it, expect } from 'vitest';
import {
  rgQtyBySku, groupSkus, buildCountSheet, openingUnitCost, toCsv, parseCountCsv, reconcileRg,
  type OpeningSku, type LegacyFacts, type CountRow,
} from '@/lib/erp/ledger/opening';

const skus: OpeningSku[] = [
  { id: 1, key: 'cp:100:', name: '다슈', optionLabel: '', legacyProductCostIds: ['pc-a'] },
  { id: 2, key: 'cp:200:블랙', name: '왜건', optionLabel: '블랙', legacyProductCostIds: ['pc-b'] },
  { id: 3, key: 'cp:200:레드', name: '왜건', optionLabel: '레드', legacyProductCostIds: ['pc-b'] },
  { id: 4, key: 'cp:300:', name: '새 상품, "특가"', optionLabel: '', legacyProductCostIds: [] },
];

describe('rgQtyBySku', () => {
  const links = [
    { vid: '21', skuId: 1, multiplier: 2 },
    { vid: '31', skuId: 2, multiplier: 1 },
    { vid: '41', skuId: 2, multiplier: 1 },
    { vid: '41', skuId: 3, multiplier: 1 },
  ];
  it('판매 단위 × 배수로 SKU 수량을 더하고, 못 가르는 것은 이슈로', () => {
    const r = rgQtyBySku(links, [{ vid: '21', qty: 3 }, { vid: '31', qty: 4 }, { vid: '41', qty: 1 }, { vid: '99', qty: 2 }, { vid: '98', qty: 0 }], new Set());
    expect([...r.bySku]).toEqual([[1, 6], [2, 4]]);
    expect(r.issues.map((i) => [i.kind, i.ref])).toEqual([['rg_listing_multi_sku', '41'], ['rg_vid_unmapped', '99']]);
  });
  it('무시 목록의 vid는 건너뛴다', () => {
    expect(rgQtyBySku(links, [{ vid: '99', qty: 2 }], new Set(['99'])).issues).toEqual([]);
  });
});

describe('groupSkus', () => {
  it('옛 원가 행을 공유하는 SKU끼리 묶고, 옛 행이 없는 SKU는 혼자다', () => {
    expect(groupSkus(skus).map((g) => [g.skuIds, g.productCostIds])).toEqual([
      [[1], ['pc-a']],
      [[2, 3], ['pc-b']],
      [[4], []],
    ]);
  });
  it('SKU가 옛 행 두 개를 가지면 두 행의 SKU가 한 그룹이 된다', () => {
    const g = groupSkus([
      { id: 1, key: 'a', name: 'a', optionLabel: '', legacyProductCostIds: ['p1'] },
      { id: 2, key: 'b', name: 'b', optionLabel: '', legacyProductCostIds: ['p1', 'p2'] },
      { id: 3, key: 'c', name: 'c', optionLabel: '', legacyProductCostIds: ['p2'] },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].skuIds).toEqual([1, 2, 3]);
  });
});

describe('openingUnitCost', () => {
  const entries = [
    { receivedAt: '2026-08-01', quantity: 10, unitCost: 1000 },
    { receivedAt: '2026-09-01', quantity: 4, unitCost: 1300 },
  ];
  it('최근 입고부터 거슬러 가중평균(반올림)', () => {
    expect(openingUnitCost(entries, 6)).toEqual({ unitCost: Math.round((4 * 1300 + 2 * 1000) / 6), partial: false });
  });
  it('입고 합계보다 많으면 모자란 만큼 최근 단가로 채우고 partial', () => {
    expect(openingUnitCost(entries, 16)).toEqual({ unitCost: Math.round((4 * 1300 + 10 * 1000 + 2 * 1300) / 16), partial: true });
  });
  it('입고 기록이 없으면 null', () => {
    expect(openingUnitCost([], 3)).toEqual({ unitCost: null, partial: false });
  });
  it('보유 0이면 null(lot을 만들지 않는다)', () => {
    expect(openingUnitCost(entries, 0)).toEqual({ unitCost: null, partial: false });
  });
});

describe('buildCountSheet', () => {
  const legacy: LegacyFacts[] = [
    { productCostId: 'pc-a', entries: [{ receivedAt: '2026-09-01', quantity: 20, unitCost: 5000 }], soldQty: 8, voidedQty: 0 },
    { productCostId: 'pc-b', entries: [{ receivedAt: '2026-09-01', quantity: 10, unitCost: 30000 }], soldQty: 3, voidedQty: 2 },
  ];
  const rg = new Map([[1, 6], [2, 1]]);
  const { rows, issues } = buildCountSheet(skus, groupSkus(skus), rg, legacy);
  const byId = new Map(rows.map((r) => [r.skuId, r]));

  it('SKU 하나짜리 그룹은 추정(입고 − 판매 − RG)을 실사값으로 미리 채운다', () => {
    expect(byId.get(1)).toMatchObject({ rgActual: 6, selfEstimate: 6, selfCount: 6, rgInbound: 0, unitCost: 5000 });
  });
  it('여러 SKU 그룹은 실사값을 비우고 그룹 추정을 보여준다', () => {
    expect(byId.get(2)).toMatchObject({ rgActual: 1, selfEstimate: 6, selfCount: null });
    expect(byId.get(3)).toMatchObject({ rgActual: 0, selfEstimate: 6, selfCount: null });
    expect(byId.get(2)!.note).toContain('옵션별로 나눠');
    expect(byId.get(2)!.note).toContain('무효 판매 2');
    expect(issues).toContainEqual(expect.objectContaining({ kind: 'group_spans_skus' }));
  });
  it('입고 기록이 없는 SKU는 추정 없음 · 실사 0 · 단가 빈칸', () => {
    expect(byId.get(4)).toMatchObject({ selfEstimate: null, selfCount: 0, unitCost: null });
  });
  it('추정이 음수면 실사 0으로 채우고 이슈', () => {
    const r = buildCountSheet(skus.slice(0, 1), groupSkus(skus.slice(0, 1)), new Map([[1, 30]]), legacy);
    expect(r.rows[0]).toMatchObject({ selfEstimate: -18, selfCount: 0 });
    expect(r.issues).toContainEqual(expect.objectContaining({ kind: 'self_estimate_negative', ref: 'cp:100:' }));
  });
  it('확인이 필요한 행(재고 있음·빈칸)이 앞에 온다', () => {
    expect(rows.map((r) => r.skuId)).toEqual([1, 2, 3, 4]);
  });
});

describe('CSV', () => {
  const rows: CountRow[] = [
    { skuId: 4, skuKey: 'cp:300:', name: '새 상품, "특가"', option: '', group: 'g3', rgActual: 0, selfEstimate: null, selfCount: 0, rgInbound: 0, unitCost: null, note: '' },
    { skuId: 2, skuKey: 'cp:200:블랙', name: '왜건', option: '블랙', group: 'g2', rgActual: 1, selfEstimate: 6, selfCount: null, rgInbound: 0, unitCost: 30000, note: 'a, b' },
  ];
  it('쉼표·따옴표가 든 값도 왕복한다(BOM 포함)', () => {
    const text = toCsv(rows);
    expect(text.startsWith('﻿')).toBe(true);
    expect(parseCountCsv(text)).toEqual(rows);
  });
  it('실사값을 사람이 고친 파일을 읽는다', () => {
    const edited = toCsv(rows).replace('cp:200:블랙,왜건,블랙,g2,1,6,,0', 'cp:200:블랙,왜건,블랙,g2,1,6,4,0');
    expect(parseCountCsv(edited)[1].selfCount).toBe(4);
  });
  it('정수가 아닌 값은 던진다', () => {
    const bad = toCsv(rows).replace('cp:200:블랙,왜건,블랙,g2,1,6,,0', 'cp:200:블랙,왜건,블랙,g2,1,6,두개,0');
    expect(() => parseCountCsv(bad)).toThrow(/self_count/);
  });
});

describe('reconcileRg', () => {
  it('원장과 실재고가 다른 SKU만 돌려준다', () => {
    expect(reconcileRg(new Map([[1, 6], [2, 1]]), new Map([[1, 6], [2, 3], [5, 2]]))).toEqual([
      { skuId: 2, ledger: 1, actual: 3, diff: 2 },
      { skuId: 5, ledger: 0, actual: 2, diff: 2 },
    ]);
  });
});
