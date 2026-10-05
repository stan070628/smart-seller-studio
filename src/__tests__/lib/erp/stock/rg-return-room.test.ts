// src/__tests__/lib/erp/stock/rg-return-room.test.ts
import { describe, it, expect, vi } from 'vitest';
import { returnRoomBySku, RETURN_WINDOW_DAYS } from '@/lib/erp/stock/rg-return-room';

describe('returnRoomBySku — 최근 30일 RG 판매 − 최근 30일 rg_return', () => {
  it('SKU별 한도를 돌려주고, 판매 기준 시각·SKU 필터를 넘긴다', async () => {
    const query = vi.fn(async (_t: string, _p?: unknown[]) => ({ rows: [{ sku_id: '72', room: 37 }, { sku_id: '80', room: 0 }], rowCount: 2 }));
    const m = await returnRoomBySku({ query }, '2026-10-05T00:37:00.000Z', [72, 80]);
    expect([...m]).toEqual([[72, 37], [80, 0]]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(['2026-10-05T00:37:00.000Z', [72, 80], RETURN_WINDOW_DAYS]);
    expect(RETURN_WINDOW_DAYS).toBe(30);
    // 판매는 RG 채널·상태 무관(취소 표시가 없다) · 복귀는 rg_return 원 줄만(역전표·되돌린 원 줄 제외)
    expect(sql).toContain("channel = 'coupang_rg'");
    expect(sql).toContain("reason = 'rg_return'");
    expect(sql).toContain('reverses_id is null');
    expect(sql).toContain('not exists (select 1 from erp.stock_ledger x where x.reverses_id = l.id)');
    expect(sql).not.toContain('status');
    // 묶음 상품은 alloc(구성 SKU별 수량)로 펼쳐 센다 · 복귀도 기준 시각 이후 것은 뺀다
    expect(sql).toContain('jsonb_array_elements(l.alloc)');
    expect(sql).toContain("(a->>'skuId')::bigint");
    expect(sql).toContain('l.occurred_at <= $1::timestamptz');
    expect(sql).not.toContain('sku_qty');
  });

  it('SKU 필터를 생략하면 null을 넘긴다(전 SKU)', async () => {
    const query = vi.fn(async (_t: string, _p?: unknown[]) => ({ rows: [], rowCount: 0 }));
    expect((await returnRoomBySku({ query }, '2026-10-05T00:37:00.000Z')).size).toBe(0);
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1][1]).toBeNull();
  });
});
