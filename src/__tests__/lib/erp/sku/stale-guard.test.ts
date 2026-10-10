import { describe, it, expect, vi } from 'vitest';
import { findNewerThanDraft, staleDraftMessage } from '@/lib/erp/sku/stale-guard';

const draft = { skuKeys: new Set(['cp:1:블랙']), listingKeys: new Set(['coupang_wing|11|']) };

describe('findNewerThanDraft', () => {
  it('초안 수집 뒤에 생긴 draft 행 중 초안에 없는 것만 센다 — 전체 적재가 직접 만든 행은 아니다', async () => {
    const query = vi.fn(async (sql: string, _p?: unknown[]) =>
      sql.includes('erp.skus')
        ? { rows: [{ key: 'cp:1:블랙' }, { key: 'cp:2:레드' }], rowCount: 2 }
        : { rows: [{ key: 'coupang_wing|11|' }, { key: 'coupang_rg|22|' }, { key: 'naver|9|5' }], rowCount: 3 });
    const r = await findNewerThanDraft({ query }, new Date('2026-10-10T08:12:00Z'), draft);
    expect(r).toEqual({ skus: ['cp:2:레드'], listings: ['coupang_rg|22|', 'naver|9|5'], count: 3 });
    expect(query.mock.calls[0][1]).toEqual(['2026-10-10T08:12:00.000Z']);
    expect(query.mock.calls[0][0]).toContain("origin = 'draft' and created_at > $1");
  });
  it('없으면 count 0', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    expect((await findNewerThanDraft({ query }, new Date(), draft)).count).toBe(0);
  });
});

describe('staleDraftMessage', () => {
  it('문구', () => {
    expect(staleDraftMessage('sku-draft-2026-10-10.json', '2026-10-10T08:12:00.000Z', 3))
      .toBe('초안(sku-draft-2026-10-10.json, 2026-10-10T08:12:00.000Z)보다 새로 생긴 SKU/리스팅 3개가 있다 — sku-collect를 먼저 다시 돌린다');
  });
});
