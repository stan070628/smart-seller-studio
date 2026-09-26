import { describe, it, expect } from 'vitest';
import { SUSPECT_CODES, planPurchaseUnits, type ItemMapRow, type SkuLink } from '@/lib/erp/ledger/purchase-units';

const maps: ItemMapRow[] = [
  { itemCode: '500', itemLabel: '왜건', productCostId: 'pc-w', defaultDecision: 'ingest' },
  { itemCode: '693742', itemLabel: '프로틴커피쉐이크', productCostId: 'pc-p', defaultDecision: 'ingest' },
  { itemCode: '888450', itemLabel: 'PUMA주니어팬티5P', productCostId: 'pc-t', defaultDecision: 'ask' },
  { itemCode: '700', itemLabel: '개인 간식', productCostId: 'pc-x', defaultDecision: 'skip' },
  { itemCode: '800', itemLabel: '연결 없음', productCostId: 'pc-none', defaultDecision: 'ingest' },
];
const skus: SkuLink[] = [
  { id: 2, key: 'cp:w:레드', legacyProductCostIds: ['pc-w'] },
  { id: 1, key: 'cp:w:블랙', legacyProductCostIds: ['pc-w'] },
  { id: 3, key: 'cp:p', legacyProductCostIds: ['pc-p'] },
  { id: 4, key: 'cp:t', legacyProductCostIds: ['pc-t'] },
];

describe('planPurchaseUnits', () => {
  it('의심 품번 두 건을 기본으로 보류한다', () => {
    expect([...SUSPECT_CODES]).toEqual(['693742', '888450']);
  });

  it('품번 : SKU = 1 : N 행, 의심은 보류, skip은 제외, SKU 없음은 따로', () => {
    const p = planPurchaseUnits(maps, skus, new Set());
    expect(p.rows).toEqual([
      { supplierCode: '500', label: '왜건', skuId: 1, skuKey: 'cp:w:블랙' },
      { supplierCode: '500', label: '왜건', skuId: 2, skuKey: 'cp:w:레드' },
    ]);
    expect(p.held.map((m) => m.itemCode)).toEqual(['693742', '888450']);
    expect(p.skipped.map((m) => m.itemCode)).toEqual(['700']);
    expect(p.unlinked.map((m) => m.itemCode)).toEqual(['800']);
  });

  it('사용자가 확인한 의심 품번만 --include로 넣는다', () => {
    const p = planPurchaseUnits(maps, skus, new Set(['693742']));
    expect(p.rows.map((r) => r.supplierCode)).toEqual(['500', '500', '693742']);
    expect(p.held.map((m) => m.itemCode)).toEqual(['888450']);
  });
});
