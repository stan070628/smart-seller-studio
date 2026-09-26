import { describe, it, expect } from 'vitest';
import { commitOpeningImport, ImportConflictError, planOpeningImport } from '@/lib/erp/ledger/opening-import';
import type { CountRow, LegacyFacts, OpeningIssue, OpeningSku } from '@/lib/erp/ledger/opening';
import type { Db } from '@/lib/erp/ledger/store';

const skus: OpeningSku[] = [
  { id: 7, key: 'k7', name: '왜건', optionLabel: '블랙', legacyProductCostIds: ['pc-7'] },
  { id: 8, key: 'k8', name: '매트', optionLabel: '', legacyProductCostIds: ['pc-8'] },
  { id: 9, key: 'k9', name: '타월', optionLabel: '', legacyProductCostIds: [] },
];
const legacy: LegacyFacts[] = [
  { productCostId: 'pc-7', entries: [{ receivedAt: '2026-09-01', quantity: 10, unitCost: 1000 }], soldQty: 0, voidedQty: 0 },
  { productCostId: 'pc-8', entries: [{ receivedAt: '2026-09-02', quantity: 5, unitCost: 3000 }], soldQty: 0, voidedQty: 0 },
];
const row = (o: Partial<CountRow>): CountRow => ({
  skuId: 7, skuKey: 'k7', name: '', option: '', group: 'g1', rgActual: 0, selfEstimate: null, selfCount: 0, rgInbound: 0, unitCost: null, note: '', ...o,
});
const base = {
  skus, legacy,
  rgBySku: new Map<number, number>(),
  rgIssues: [] as OpeningIssue[],
  stockedSkuIds: new Set<number>(),
  overrides: {} as Record<string, number>,
  countedAt: '2026-09-27T09:30:00+09:00',
  now: new Date('2026-09-27T01:00:00Z'),
};

describe('planOpeningImport', () => {
  it('집·입고중·지금 RG를 기초 전표로 계획한다(단가 = 옛 입고 이력)', () => {
    const p = planOpeningImport({ ...base, rows: [row({ selfCount: 3, rgInbound: 1 })], rgBySku: new Map([[7, 2]]) });
    expect(p.errors).toEqual([]);
    expect(p.plan).toEqual([
      { skuId: 7, key: 'k7', location: 'self', qty: 3, unitCost: 1000 },
      { skuId: 7, key: 'k7', location: 'rg_inbound', qty: 1, unitCost: 1000 },
      { skuId: 7, key: 'k7', location: 'rg', qty: 2, unitCost: 1000 },
    ]);
    expect(p.totals).toEqual({ self: 3, rgInbound: 1, rg: 2, value: 6000, entries: 3 });
  });

  it('원장에 전표가 있는 SKU는 빼고 조정으로 안내한다', () => {
    const p = planOpeningImport({ ...base, rows: [row({ selfCount: 3 })], stockedSkuIds: new Set([7]) });
    expect(p.plan).toEqual([]);
    expect(p.excluded).toEqual([{ skuKey: 'k7', reason: expect.stringContaining('조정') }]);
  });

  it('self_count 빈칸은 불러오지 않는다(경고 아님 · 제외 목록)', () => {
    const p = planOpeningImport({ ...base, rows: [row({ selfCount: null })] });
    expect(p.plan).toEqual([]);
    expect(p.excluded[0].reason).toContain('빈칸');
    expect(p.errors).toEqual([]);
  });

  it('SKU 키가 다르면 오류', () => {
    const p = planOpeningImport({ ...base, rows: [row({ skuKey: 'k8', selfCount: 1 })] });
    expect(p.errors.join('\n')).toContain('키가 다르다');
  });

  it('단가를 모르면 오류, 화면 입력(overrides)으로 채운다', () => {
    const rows = [row({ skuId: 9, skuKey: 'k9', selfCount: 2 })];
    expect(planOpeningImport({ ...base, rows }).errors.join('\n')).toContain('단가를 모른다: k9');
    const p = planOpeningImport({ ...base, rows, overrides: { k9: 500 } });
    expect(p.errors).toEqual([]);
    expect(p.plan).toEqual([{ skuId: 9, key: 'k9', location: 'self', qty: 2, unitCost: 500 }]);
  });

  it('RG 매핑 이슈와 불러올 행에 없는 RG 재고는 경고로만 남기고 싣지 않는다', () => {
    const p = planOpeningImport({
      ...base,
      rows: [row({ selfCount: 1 })],
      rgBySku: new Map([[8, 4]]),
      rgIssues: [{ kind: 'rg_vid_unmapped', ref: '333', detail: 'RG 재고 2개인 vendorItemId가 어느 RG 리스팅에도 없다' }],
    });
    expect(p.errors).toEqual([]);
    expect(p.warnings).toHaveLength(2);
    expect(p.plan.some((x) => x.skuId === 8)).toBe(false);
  });

  it('실사 시각이 24시간 넘게 지났으면 오류', () => {
    const p = planOpeningImport({ ...base, rows: [row({ selfCount: 1 })], countedAt: '2026-09-25T09:00:00+09:00' });
    expect(p.errors.join('\n')).toContain('24시간');
  });
});

function fakeDb(counts: Record<number, number> = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select count(*)::int as n from erp.stock_ledger')) return { rows: [{ n: counts[Number(params[0])] ?? 0 }], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      if (sql.startsWith('insert into erp.sync_cursors')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('commitOpeningImport', () => {
  const AT = '2026-09-27T01:00:00.000Z';
  const plan = [
    { skuId: 9, key: 'k9', location: 'self' as const, qty: 2, unitCost: 500 },
    { skuId: 7, key: 'k7', location: 'self' as const, qty: 3, unitCost: 1000 },
    { skuId: 7, key: 'k7', location: 'rg' as const, qty: 2, unitCost: 1000 },
  ];

  it('전역 잠금 → SKU 오름차순 잠금·빈 원장 재확인 → 기초 전표 → 커서', async () => {
    const f = fakeDb();
    expect(await commitOpeningImport(f.db, plan, { fileName: 'count.csv', cutoverAt: AT })).toBe(3);
    expect(f.calls[0].params).toEqual([7102]);
    const locks = f.calls.filter((c) => c.sql.startsWith('select pg_advisory_xact_lock($1::int')).map((c) => c.params[1]);
    expect(locks.slice(0, 2)).toEqual([7, 9]);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => [c.params[10], c.params[3], c.params[12], c.params[7], c.params[8]])).toEqual([
      ['opening:7:self', 'opening', 'opening', 'opening', 'count.csv'],
      ['opening:7:rg', 'opening', 'opening', 'opening', 'count.csv'],
      ['opening:9:self', 'opening', 'opening', 'opening', 'count.csv'],
    ]);
    expect(f.calls.find((c) => c.sql.startsWith('insert into erp.sync_cursors'))!.params).toEqual([AT]);
  });

  it('미리보기 뒤 그 사이 전표가 생긴 SKU가 있으면 ImportConflictError(아무것도 쓰지 않는다)', async () => {
    const f = fakeDb({ 9: 1 });
    await expect(commitOpeningImport(f.db, plan, { fileName: 'count.csv', cutoverAt: AT })).rejects.toBeInstanceOf(ImportConflictError);
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });
});
