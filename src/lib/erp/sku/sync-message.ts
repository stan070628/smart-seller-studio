// src/lib/erp/sku/sync-message.ts
// SKU 자동 추가 결과 → 화면 문구(원가관리 추가 토스트 · 재고현황 「SKU 다시 맞추기」 결과 줄). 화면에서 import한다 — 타입만 가져온다.
import type { SkuSync, SyncMissingResult } from './sync-product';

export const SKU_SYNC_RETRY_HINT = '재고현황의 「SKU 다시 맞추기」로 다시 시도';

/** 원가관리 저장 응답의 skuSync(한 개 또는 bulk 여러 개) → 토스트 하나. 말할 것이 없으면 null(이미 있음·상품번호 없음) */
export function summarizeSkuSync(list: (SkuSync | null | undefined)[]): { kind: 'success' | 'error'; message: string } | null {
  const xs = list.filter((x): x is SkuSync => !!x);
  const skus = xs.filter((x) => x.status === 'created').reduce((s, x) => s + x.skus, 0);
  const failed = xs.filter((x) => x.status === 'failed').length;
  if (failed > 0) {
    return {
      kind: 'error',
      message: `${skus > 0 ? `SKU ${skus}개 추가 · ` : ''}SKU 자동 추가 실패${failed > 1 ? ` ${failed}건` : ''} — ${SKU_SYNC_RETRY_HINT}`,
    };
  }
  if (skus > 0) return { kind: 'success', message: `SKU ${skus}개 자동 추가` };
  return null;
}

/** 「SKU 다시 맞추기」 결과 한 줄 — 「SKU N개 추가 · 이미 있음 N · 실패 N(상품번호…)」 */
export function formatSyncMissing(r: SyncMissingResult): string {
  if (r.results.length === 0) return '빠진 상품 없음 — 원가관리의 쿠팡 상품이 모두 SKU에 있다';
  const failedIds = r.results.filter((x) => x.status === 'failed').map((x) => x.sellerProductId);
  return `SKU ${r.skus}개 추가 · 이미 있음 ${r.exists} · 실패 ${r.failed}${failedIds.length ? `(${failedIds.join(', ')})` : ''}${r.more ? ' · 남은 상품이 있다 — 한 번 더 누른다' : ''}`;
}
