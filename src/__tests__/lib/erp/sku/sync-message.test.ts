// src/__tests__/lib/erp/sku/sync-message.test.ts
import { describe, it, expect } from 'vitest';
import { formatSyncMissing, summarizeSkuSync } from '@/lib/erp/sku/sync-message';

describe('summarizeSkuSync', () => {
  it('하나 실패 — 설계의 문구 그대로', () => {
    expect(summarizeSkuSync([{ status: 'failed', skus: 0, error: 'x' }])).toEqual({
      kind: 'error', message: 'SKU 자동 추가 실패 — 재고현황의 「SKU 다시 맞추기」로 다시 시도',
    });
  });
  it('여럿 — 추가 수와 실패 건수', () => {
    expect(summarizeSkuSync([
      { status: 'created', skus: 2 }, { status: 'created', skus: 1 },
      { status: 'failed', skus: 0 }, { status: 'failed', skus: 0 }, { status: 'exists', skus: 0 },
    ])).toEqual({ kind: 'error', message: 'SKU 3개 추가 · SKU 자동 추가 실패 2건 — 재고현황의 「SKU 다시 맞추기」로 다시 시도' });
  });
  it('추가만 — 성공', () => {
    expect(summarizeSkuSync([{ status: 'created', skus: 2 }])).toEqual({ kind: 'success', message: 'SKU 2개 자동 추가' });
  });
  it('이미 있음·건너뜀·없음은 말하지 않는다', () => {
    expect(summarizeSkuSync([{ status: 'exists', skus: 0 }, { status: 'skipped', skus: 0 }, undefined, null])).toBeNull();
    expect(summarizeSkuSync([])).toBeNull();
  });
});

describe('formatSyncMissing', () => {
  const row = (sellerProductId: number, status: 'created' | 'exists' | 'failed', skus = 0) => ({ sellerProductId, productName: 'p', status, skus });
  it('추가 · 이미 있음 · 실패(상품번호)', () => {
    expect(formatSyncMissing({
      results: [row(300, 'created', 2), row(200, 'failed'), row(100, 'failed'), row(50, 'exists')],
      created: 1, exists: 1, failed: 2, skus: 2, more: false,
    })).toBe('SKU 2개 추가 · 이미 있음 1 · 실패 2(200, 100)');
  });
  it('남은 상품이 있으면 한 번 더', () => {
    expect(formatSyncMissing({ results: [row(1, 'created', 1)], created: 1, exists: 0, failed: 0, skus: 1, more: true }))
      .toBe('SKU 1개 추가 · 이미 있음 0 · 실패 0 · 남은 상품이 있다 — 한 번 더 누른다');
  });
  it('빠진 상품 없음', () => {
    expect(formatSyncMissing({ results: [], created: 0, exists: 0, failed: 0, skus: 0, more: false }))
      .toBe('빠진 상품 없음 — 원가관리의 쿠팡 상품이 모두 SKU에 있다');
  });
});
