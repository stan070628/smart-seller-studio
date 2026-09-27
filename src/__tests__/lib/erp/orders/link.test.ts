// src/__tests__/lib/erp/orders/link.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ relinkLines: vi.fn() }));
vi.mock('@/lib/erp/orders/relink', () => ({ relinkLines: m.relinkLines }));

import { LinkError, linkLines, linkListing, unlinkLine, unlinkListing } from '@/lib/erp/orders/link';

type Route = (sql: string, params: unknown[]) => unknown[] | undefined;
let calls: { sql: string; params: unknown[] }[];
const db = (route: Route) => {
  calls = [];
  return {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      const rows = route(sql, params);
      if (!rows) throw new Error(`예상 못 한 SQL: ${sql.slice(0, 70)}`);
      return { rows, rowCount: rows.length };
    },
  };
};
const AT = '2026-09-27T09:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  m.relinkLines.mockResolvedValue({ checked: 3, changed: [5, 9, 12], legacy: null, deduct: null });
});

describe('linkListing', () => {
  it('수동 리스팅 + SKU 연결을 만들고 그 상품의 미귀속 줄을 재판정한다(채널 잠금 먼저)', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      if (sql.startsWith('select id from erp.channel_listings')) return [];
      if (sql.startsWith('insert into erp.channel_listings')) return [{ id: '1801' }];
      if (sql.startsWith('insert into erp.listing_skus')) return [];
      if (sql.startsWith('select id from erp.order_lines')) return [{ id: '5' }, { id: '9' }, { id: '12' }];
      return undefined;
    });
    const r = await linkListing(d, { channel: 'coupang_rg', productId: '95820950723', optionKey: '', skuId: 72, multiplier: 1, label: '타월 블루' }, AT);
    // SKU 확인 → 채널 잠금(7102, RG=2) → 리스팅 확인 순서
    const lockAt = calls.findIndex((c) => c.sql.startsWith('select pg_advisory_xact_lock'));
    expect(calls[lockAt].params).toEqual([7102, 2]);
    expect(lockAt).toBeLessThan(calls.findIndex((c) => c.sql.startsWith('select id from erp.channel_listings')));
    const ins = calls.find((c) => c.sql.startsWith('insert into erp.channel_listings'));
    expect(ins?.params).toEqual(['coupang_rg', '95820950723', '', '타월 블루']);
    expect(ins?.sql).toContain("'manual'");
    expect(m.relinkLines).toHaveBeenCalledWith(d, 'coupang_rg', [5, 9, 12], AT);
    expect(r).toMatchObject({ listingId: 1801, relinked: { changed: [5, 9, 12] } });
  });

  it('이미 같은 리스팅이 있으면 만들지 않고 LinkError(exists)', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      if (sql.startsWith('select id from erp.channel_listings')) return [{ id: '86' }];
      return undefined;
    });
    await expect(linkListing(d, { channel: 'coupang_rg', productId: '95401822934', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT))
      .rejects.toMatchObject({ code: 'exists' });
  });

  it('입력 검사 — 채널·배수·SKU 상태', async () => {
    const d = db((sql) => (sql.startsWith('select id, status from erp.skus') ? [{ id: '72', status: 'archived' }] : undefined));
    await expect(linkListing(d, { channel: 'karrot' as never, productId: '1', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT)).rejects.toBeInstanceOf(LinkError);
    await expect(linkListing(d, { channel: 'toss', productId: '1', optionKey: '', skuId: 72, multiplier: 0, label: 'x' }, AT)).rejects.toBeInstanceOf(LinkError);
    await expect(linkListing(d, { channel: 'toss', productId: '1', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT)).rejects.toMatchObject({ code: 'sku' });
  });
});

describe('linkLines · unlinkLine · unlinkListing', () => {
  it('이 주문만 연결 — 같은 채널 줄에 manual_sku_id를 적고 재판정', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '73', status: 'active' }];
      if (sql.startsWith('select distinct channel from erp.order_lines')) return [{ channel: 'toss' }];
      if (sql.startsWith('select count(*)::int as n from erp.order_lines')) return [{ n: 0 }];
      if (sql.startsWith('update erp.order_lines set manual_sku_id')) return [];
      return undefined;
    });
    await linkLines(d, { lineIds: [55], skuId: 73 }, AT);
    expect(calls.find((c) => c.sql.startsWith('update erp.order_lines set manual_sku_id'))?.params).toEqual([[55], 73]);
    expect(m.relinkLines).toHaveBeenCalledWith(d, 'toss', [55], AT);
  });

  it('(리뷰 A2~A4 #2) 묶음(구성 SKU 2개 이상) 줄은 「이 주문만 연결」로 바꾸지 않는다 — 구성품이 조용히 빠진다', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '73', status: 'active' }];
      if (sql.startsWith('select distinct channel from erp.order_lines')) return [{ channel: 'toss' }];
      if (sql.startsWith('select count(*)::int as n from erp.order_lines')) return [{ n: 1 }];
      return undefined;
    });
    await expect(linkLines(d, { lineIds: [55], skuId: 73 }, AT)).rejects.toMatchObject({ code: 'invalid' });
    expect(m.relinkLines).not.toHaveBeenCalled();
  });

  it('여러 채널 줄을 한 번에 연결하려 하면 LinkError', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '73', status: 'active' }];
      if (sql.startsWith('select distinct channel from erp.order_lines')) return [{ channel: 'toss' }, { channel: 'naver' }];
      return undefined;
    });
    await expect(linkLines(d, { lineIds: [1, 2], skuId: 73 }, AT)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('줄 해제 — manual_sku_id를 비우고 재판정', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select channel from erp.order_lines')) return [{ channel: 'toss' }];
      if (sql.startsWith('update erp.order_lines set manual_sku_id = null')) return [];
      return undefined;
    });
    await unlinkLine(d, 55, AT);
    expect(m.relinkLines).toHaveBeenCalledWith(d, 'toss', [55], AT);
  });

  it('리스팅 해제 — manual 리스팅만 끄고 그 리스팅 줄을 재판정 · draft는 거부', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, channel, origin from erp.channel_listings')) return [{ id: '1801', channel: 'coupang_rg', origin: 'manual' }];
      if (sql.startsWith('update erp.channel_listings set active = false')) return [];
      if (sql.startsWith('select id from erp.order_lines where listing_id')) return [{ id: '5' }];
      return undefined;
    });
    await unlinkListing(d, 1801, AT);
    expect(m.relinkLines).toHaveBeenCalledWith(d, 'coupang_rg', [5], AT);
    const d2 = db((sql) => (sql.startsWith('select id, channel, origin from erp.channel_listings') ? [{ id: '86', channel: 'coupang_rg', origin: 'draft' }] : undefined));
    await expect(unlinkListing(d2, 86, AT)).rejects.toMatchObject({ code: 'invalid' });
  });
});
