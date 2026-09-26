import { describe, it, expect } from 'vitest';
import {
  computeKpis, defaultCost, editDiff, filterGroups, filterRows, filtersActive, groupRows, localInputToIso, summarizeStaged, toAdjustItems, toExportCsv,
  type RgRecon, type StagedEdit, type StockRow,
} from '@/components/erp/stock/stock-view';

const row = (o: Partial<StockRow> = {}): StockRow => ({
  skuId: 1, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 3, rgInbound: 0, rg: 2, value: 5000,
  hasLedger: true, hasSelfLedger: true, lotCost: 1000, legacyCost: null, costNeedsInput: false, selfValue: 0, lastCountedAt: null, ...o,
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
  it('실사 모드 요약: 늘림·줄임·차이 없음(센 기록만)·평가액 영향(추정)', () => {
    const byId = new Map([[1, row()], [2, row({ skuId: 2, lotCost: 500 })], [3, row({ skuId: 3 })]]);
    expect(summarizeStaged([edit({ unitCost: 1200 }), edit({ skuId: 2, value: 1, expected: 3 }), edit({ skuId: 3, value: 3, expected: 3 })], byId))
      .toEqual({ count: 3, plus: 2, minus: 2, same: 1, valueDelta: 2 * 1200 - 2 * 500 });
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

describe('상품 단위 묶기', () => {
  const rows = [
    row({ skuId: 1, key: 'k1', name: '왜건', option: '블랙', self: 3, rgInbound: 1, rg: 2, value: 6000 }),
    row({ skuId: 2, key: 'k2', name: '왜건', option: '베이지', self: 0, rgInbound: 0, rg: 0, value: 0 }),
    row({ skuId: 3, key: 'k3', name: '매트', option: '', self: 4, rgInbound: 0, rg: 1, value: 2500 }),
  ];

  it('상품명으로 묶어 집·입고중·RG(원장)·평가액을 더하고 옵션 수를 센다(나온 순서 유지)', () => {
    const g = groupRows(rows, null);
    expect(g.map((x) => [x.name, x.options.length, x.self, x.rgInbound, x.rg, x.value, x.rgActual, x.rgMismatch])).toEqual([
      ['왜건', 2, 3, 1, 2, 6000, null, null],
      ['매트', 1, 4, 0, 1, 2500, null, null],
    ]);
  });

  it('대조 뒤에는 RG 실재고를 더하고 불일치를 옵션 단위로 센다(합이 상쇄돼도 가려지지 않는다)', () => {
    // 블랙 2→1(−1) · 베이지 0→1(+1) — 상품 합은 2 = 2지만 옵션 둘 다 틀렸다
    const r2: RgRecon = { ...recon, actual: new Map([[1, 1], [2, 1]]) };
    const [wagon] = groupRows(rows, r2);
    expect([wagon.rgActual, wagon.rgMismatch]).toEqual([2, 2]);
  });

  it('조회조건은 옵션에 건다 — 맞는 옵션이 있는 묶음만 남기고 그 옵션만 보인다(합계는 전체 옵션)', () => {
    const g = groupRows(rows, null);
    expect(filterGroups(g, { q: '', onlyStocked: true, onlyRgMismatch: false }, null).map((v) => [v.group.name, v.shown.map((r) => r.skuId), v.group.self]))
      .toEqual([['왜건', [1], 3], ['매트', [3], 4]]);
    expect(filterGroups(g, { q: '베이지', onlyStocked: false, onlyRgMismatch: false }, null).map((v) => v.shown.map((r) => r.skuId))).toEqual([[2]]);
    // 상품명으로 찾으면 그 상품의 옵션이 모두 보인다
    expect(filterGroups(g, { q: '왜건', onlyStocked: false, onlyRgMismatch: false }, null).map((v) => v.shown.length)).toEqual([2]);
  });

  it('조회조건이 하나라도 걸리면 filtersActive(공백만 있는 검색어는 아니다)', () => {
    expect(filtersActive({ q: ' ', onlyStocked: false, onlyRgMismatch: false })).toBe(false);
    expect(filtersActive({ q: '왜건', onlyStocked: false, onlyRgMismatch: false })).toBe(true);
    expect(filtersActive({ q: '', onlyStocked: true, onlyRgMismatch: false })).toBe(true);
    expect(filtersActive({ q: '', onlyStocked: false, onlyRgMismatch: true })).toBe(true);
  });
});
