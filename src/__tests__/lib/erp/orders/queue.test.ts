// src/__tests__/lib/erp/orders/queue.test.ts
import { describe, it, expect } from 'vitest';
import { recentLinks, unattributedGroups } from '@/lib/erp/orders/queue';

const db = (route: (sql: string) => unknown[]) => ({ async query(sql: string) { const rows = route(sql); return { rows, rowCount: rows.length }; } });

describe('unattributedGroups', () => {
  it('(채널, 상품번호, 옵션 키)로 묶은 행을 화면 모양으로 — 취소·미결제는 SQL이 뺀다', async () => {
    let seen = '';
    const d = db((sql) => {
      seen = sql;
      return [{ channel: 'coupang_rg', product_id: '95820950723', option_key: '', label: '극세사 타월 · 10개 블루', reasons: ['no_listing'],
        lines: 3, qty: '3', first_paid: new Date('2026-09-11T13:55:45Z'), last_paid: new Date('2026-09-23T14:56:14Z'), line_ids: ['5', '9', '12'] }];
    });
    expect(await unattributedGroups(d)).toEqual([{
      channel: 'coupang_rg', productId: '95820950723', optionKey: '', label: '극세사 타월 · 10개 블루', reasons: ['no_listing'],
      lines: 3, qty: 3, firstPaidAt: '2026-09-11T13:55:45.000Z', lastPaidAt: '2026-09-23T14:56:14.000Z', lineIds: [5, 9, 12],
    }]);
    expect(seen).toContain("attribution = 'unattributed'");
    expect(seen).toContain("status not in ('canceled', 'unpaid')");
    // (리뷰 A5~A7 #7) 대기열이 무한정 커지지 않게 묶음 수를 제한한다
    expect(seen).toContain('limit 200');
  });
});

describe('recentLinks', () => {
  it('이 화면에서 만든 것(수동 리스팅·manual_sku_id 줄)만 최근순으로', async () => {
    const d = db((sql) => (sql.includes('from erp.channel_listings')
      ? [{ id: '1790', channel: 'coupang_rg', external_product_id: '95721383852', external_option_key: '', label: 'x', sku_id: '73', sku_label: '타월 옐로우', multiplier: 1, created_at: new Date('2026-09-27T05:00:00Z') }]
      : [{ id: '55', channel: 'toss', external_line_id: '318224910', product_label: 'y', manual_sku_id: '73', sku_label: '타월 옐로우', updated_at: new Date('2026-09-27T06:00:00Z') }]));
    expect(await recentLinks(d, 20)).toEqual({
      listings: [{ listingId: 1790, channel: 'coupang_rg', productId: '95721383852', optionKey: '', label: 'x', skuId: 73, skuLabel: '타월 옐로우', multiplier: 1, createdAt: '2026-09-27T05:00:00.000Z' }],
      lines: [{ lineId: 55, channel: 'toss', externalLineId: '318224910', label: 'y', skuId: 73, skuLabel: '타월 옐로우', updatedAt: '2026-09-27T06:00:00.000Z' }],
    });
  });
});
