import { describe, it, expect } from 'vitest';
import {
  computeKpis, defaultCost, editDiff, filterRows, localInputToIso, summarizeStaged, toAdjustItems, toExportCsv,
  type RgRecon, type StagedEdit, type StockRow,
} from '@/components/erp/stock/stock-view';

const row = (o: Partial<StockRow> = {}): StockRow => ({
  skuId: 1, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 3, rgInbound: 0, rg: 2, value: 5000,
  hasLedger: true, lotCost: 1000, legacyCost: null, costNeedsInput: false, ...o,
});
const recon: RgRecon = { fetchedAt: '2026-09-27T01:00:00Z', actual: new Map([[1, 4]]), issues: [], inactive: [] };
const edit = (o: Partial<StagedEdit> = {}): StagedEdit => ({
  skuId: 1, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', note: '', unitCost: null, ...o,
});

describe('filterRows', () => {
  const rows = [row(), row({ skuId: 2, key: 'cp:2:레드', name: '매트', option: '레드', self: 0, rg: 0, value: 0 })];
  it('상품·옵션·키로 찾는다(대소문자 무시)', () => {
    expect(filterRows(rows, { q: '레드', onlyStocked: false, onlyRgMismatch: false }, null).map((r) => r.skuId)).toEqual([2]);
    expect(filterRows(rows, { q: 'CP:1', onlyStocked: false, onlyRgMismatch: false }, null).map((r) => r.skuId)).toEqual([1]);
  });
  it('재고 있는 것만 · RG 불일치만', () => {
    expect(filterRows(rows, { q: '', onlyStocked: true, onlyRgMismatch: false }, null).map((r) => r.skuId)).toEqual([1]);
    expect(filterRows(rows, { q: '', onlyStocked: false, onlyRgMismatch: true }, recon).map((r) => r.skuId)).toEqual([1]);
  });
});

describe('computeKpis', () => {
  it('위치별 합계·평가액, 대조 전에는 불일치 null', () => {
    expect(computeKpis([row(), row({ skuId: 2, self: 1, rgInbound: 2, rg: 0, value: 700 })], null))
      .toEqual({ total: 8, self: 4, rgInbound: 2, rg: 2, value: 5700, rgMismatch: null });
    expect(computeKpis([row()], recon).rgMismatch).toBe(1);
  });
});

describe('편집', () => {
  it('지금 개수는 화면 재고와의 차이, ±수량은 그대로', () => {
    expect(editDiff(edit())).toBe(2);
    expect(editDiff(edit({ mode: 'delta', value: -2 }))).toBe(-2);
  });
  it('단가 기본값은 최근 lot → 옛 입고', () => {
    expect(defaultCost(row())).toBe(1000);
    expect(defaultCost(row({ lotCost: null, legacyCost: 800 }))).toBe(800);
  });
  it('요청 본문: count만 expected를 싣고 요청마다 새 id', () => {
    let n = 0;
    const ids = () => `id-${n++}`;
    expect(toAdjustItems([edit({ note: '박스 파손', unitCost: 900 }), edit({ skuId: 2, mode: 'delta', value: -1, reason: 'damage' })], ids)).toEqual([
      { skuId: 1, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', note: '박스 파손', unitCost: 900, requestId: 'id-0' },
      { skuId: 2, location: 'self', mode: 'delta', value: -1, reason: 'damage', unitCost: null, requestId: 'id-1' },
    ]);
  });
  it('실사 모드 요약: 늘림·줄임·평가액 영향(추정)', () => {
    const byId = new Map([[1, row()], [2, row({ skuId: 2, lotCost: 500 })]]);
    expect(summarizeStaged([edit({ unitCost: 1200 }), edit({ skuId: 2, value: 1, expected: 3 })], byId))
      .toEqual({ count: 2, plus: 2, minus: 2, valueDelta: 2 * 1200 - 2 * 500 });
  });
});

describe('내보내기', () => {
  it('BOM + 머리글 + 대조값', () => {
    const csv = toExportCsv([row()], recon);
    expect(csv.startsWith('﻿sku_key,상품,옵션,집,RG입고중,RG(원장),RG실재고,차이,단가,평가액\n')).toBe(true);
    expect(csv).toContain('cp:1:블랙,왜건,블랙,3,0,2,4,2,1000,5000');
  });
  it('datetime-local 값은 KST 오프셋 ISO로', () => {
    expect(localInputToIso('2026-09-27T09:30')).toBe('2026-09-27T09:30:00+09:00');
  });
});
