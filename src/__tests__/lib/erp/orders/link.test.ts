// src/__tests__/lib/erp/orders/link.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ relinkLines: vi.fn() }));
vi.mock('@/lib/erp/orders/relink', () => ({ relinkLines: m.relinkLines }));

import { LinkError, linkLines, linkListing, toPosInt, unlinkLine, unlinkListing } from '@/lib/erp/orders/link';

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
// (리뷰 A5~A7 #2) 빈 옵션 리스팅은 옵션이 여럿인 상품을 삼킬 수 있어 매번 다른 옵션 리스팅·미귀속 줄이 없는지 본다 — 대부분의 fake-db 라우트에 빈 결과를 달아준다
const NO_OTHER_OPTION: Route = (sql) => (sql.startsWith('select 1 from erp.channel_listings') || sql.startsWith('select 1 from erp.order_lines') ? [] : undefined);

beforeEach(() => {
  vi.clearAllMocks();
  m.relinkLines.mockResolvedValue({ checked: 3, changed: [5, 9, 12], legacy: null, deduct: null });
});

describe('toPosInt', () => {
  it('정수·정수 문자열만 통과 — true·소수·음수·빈 문자열은 NaN(Number(true)===1로 새지 않는다)', () => {
    expect(toPosInt(72)).toBe(72);
    expect(toPosInt('72')).toBe(72);
    expect(toPosInt(true)).toBeNaN();
    expect(toPosInt(1.5)).toBeNaN();
    expect(toPosInt(-1)).toBeNaN();
    expect(toPosInt(0)).toBeNaN();
    expect(toPosInt('')).toBeNaN();
    expect(toPosInt('72.5')).toBeNaN();
    expect(toPosInt(undefined)).toBeNaN();
    expect(toPosInt(null)).toBeNaN();
  });
});

describe('linkListing', () => {
  it('수동 리스팅 + SKU 연결을 만들고 그 상품의 미귀속 줄을 재판정한다(채널 잠금 먼저)', async () => {
    const d = db((sql, params) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      const noOpt = NO_OTHER_OPTION(sql, params);
      if (noOpt) return noOpt;
      if (sql.startsWith('select id, active, origin from erp.channel_listings')) return [];
      if (sql.startsWith('insert into erp.channel_listings')) return [{ id: '1801' }];
      if (sql.startsWith('insert into erp.listing_skus')) return [];
      if (sql.startsWith('select id from erp.order_lines')) return [{ id: '5' }, { id: '9' }, { id: '12' }];
      return undefined;
    });
    const r = await linkListing(d, { channel: 'coupang_rg', productId: '95820950723', optionKey: '', skuId: 72, multiplier: 1, label: '타월 블루' }, AT);
    // SKU 확인 → 채널 잠금(7102, RG=2) → 리스팅 확인 순서
    const lockAt = calls.findIndex((c) => c.sql.startsWith('select pg_advisory_xact_lock'));
    expect(calls[lockAt].params).toEqual([7102, 2]);
    expect(lockAt).toBeLessThan(calls.findIndex((c) => c.sql.startsWith('select id, active, origin from erp.channel_listings')));
    const ins = calls.find((c) => c.sql.startsWith('insert into erp.channel_listings'));
    expect(ins?.params).toEqual(['coupang_rg', '95820950723', '', '타월 블루']);
    expect(ins?.sql).toContain("'manual'");
    expect(m.relinkLines).toHaveBeenCalledWith(d, 'coupang_rg', [5, 9, 12], AT);
    expect(r).toMatchObject({ listingId: 1801, relinked: { changed: [5, 9, 12] } });
  });

  it('활성 리스팅이 있으면(origin 무관) 만들지 않고 LinkError(exists)', async () => {
    const d = db((sql, params) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      const noOpt = NO_OTHER_OPTION(sql, params);
      if (noOpt) return noOpt;
      if (sql.startsWith('select id, active, origin from erp.channel_listings')) return [{ id: '86', active: true, origin: 'manual' }];
      return undefined;
    });
    await expect(linkListing(d, { channel: 'coupang_rg', productId: '95401822934', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT))
      .rejects.toMatchObject({ code: 'exists' });
  });

  it('draft 리스팅이 있으면(활성 여부 무관) LinkError(exists) — 적재는 이 화면에서 되살리지 않는다', async () => {
    const d = db((sql, params) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      const noOpt = NO_OTHER_OPTION(sql, params);
      if (noOpt) return noOpt;
      if (sql.startsWith('select id, active, origin from erp.channel_listings')) return [{ id: '86', active: false, origin: 'draft' }];
      return undefined;
    });
    await expect(linkListing(d, { channel: 'coupang_rg', productId: '95401822934', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT))
      .rejects.toMatchObject({ code: 'exists' });
  });

  it('(리뷰 A5~A7 #1) 해제(비활성) 뒤 다시 연결하면 있던 manual 리스팅을 되살린다 — 새로 만들지 않는다', async () => {
    const d = db((sql, params) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      const noOpt = NO_OTHER_OPTION(sql, params);
      if (noOpt) return noOpt;
      if (sql.startsWith('select id, active, origin from erp.channel_listings')) return [{ id: '1801', active: false, origin: 'manual' }];
      if (sql.startsWith('update erp.channel_listings set active = true')) return [];
      if (sql.startsWith('delete from erp.listing_skus')) return [];
      if (sql.startsWith('insert into erp.listing_skus')) return [];
      if (sql.startsWith('select id from erp.order_lines')) return [{ id: '5' }];
      return undefined;
    });
    const r = await linkListing(d, { channel: 'coupang_rg', productId: '95820950723', optionKey: '', skuId: 72, multiplier: 1, label: '타월 블루' }, AT);
    expect(calls.some((c) => c.sql.startsWith('insert into erp.channel_listings'))).toBe(false);
    const upd = calls.find((c) => c.sql.startsWith('update erp.channel_listings set active = true'));
    expect(upd?.params).toEqual([1801, '타월 블루']);
    expect(calls.find((c) => c.sql.startsWith('delete from erp.listing_skus'))?.params).toEqual([1801]);
    expect(calls.find((c) => c.sql.startsWith('insert into erp.listing_skus'))?.params).toEqual([1801, 72, 1]);
    expect(m.relinkLines).toHaveBeenCalledWith(d, 'coupang_rg', [5], AT);
    expect(r.listingId).toBe(1801);
  });

  it('(리뷰 A5~A7 #4) exists 검사와 insert 사이에 경합(23505)하면 LinkError(exists)', async () => {
    const d = db((sql, params) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      const noOpt = NO_OTHER_OPTION(sql, params);
      if (noOpt) return noOpt;
      if (sql.startsWith('select id, active, origin from erp.channel_listings')) return [];
      if (sql.startsWith('insert into erp.channel_listings')) { const e = Object.assign(new Error('dup'), { code: '23505' }); throw e; }
      return undefined;
    });
    await expect(linkListing(d, { channel: 'toss', productId: '1', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT))
      .rejects.toMatchObject({ code: 'exists' });
  });

  it('(리뷰 A5~A7 #2) 다른 옵션 리스팅이 있는 상품에 옵션 없는 리스팅을 만들면 LinkError(invalid)', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      if (sql.startsWith('select 1 from erp.channel_listings')) return [{ '1': 1 }];
      if (sql.startsWith('select 1 from erp.order_lines')) return [];
      return undefined;
    });
    await expect(linkListing(d, { channel: 'toss', productId: '1', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT))
      .rejects.toMatchObject({ code: 'invalid' });
  });

  it('(리뷰 A5~A7 #2) 옵션 있는 미귀속 줄이 있는 상품에 옵션 없는 리스팅을 만들면 LinkError(invalid)', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      if (sql.startsWith('select 1 from erp.channel_listings')) return [];
      if (sql.startsWith('select 1 from erp.order_lines')) return [{ '1': 1 }];
      return undefined;
    });
    await expect(linkListing(d, { channel: 'toss', productId: '1', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT))
      .rejects.toMatchObject({ code: 'invalid' });
  });

  it('(리뷰 A5~A7 #2) 다른 옵션 리스팅도 옵션 있는 미귀속 줄도 없으면(그 상품이 원래 단일상품) 옵션 없는 리스팅을 허용한다', async () => {
    const d = db((sql, params) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      const noOpt = NO_OTHER_OPTION(sql, params);
      if (noOpt) return noOpt;
      if (sql.startsWith('select id, active, origin from erp.channel_listings')) return [];
      if (sql.startsWith('insert into erp.channel_listings')) return [{ id: '1801' }];
      if (sql.startsWith('insert into erp.listing_skus')) return [];
      if (sql.startsWith('select id from erp.order_lines')) return [{ id: '5' }];
      return undefined;
    });
    const r = await linkListing(d, { channel: 'coupang_rg', productId: '9', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, AT);
    expect(r.listingId).toBe(1801);
  });

  it('(리뷰 A5~A7 #5) label이 비면 그 상품 미귀속 줄의 상품명으로 채운다(잠금 뒤 조회)', async () => {
    const d = db((sql, params) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      const noOpt = NO_OTHER_OPTION(sql, params);
      if (noOpt) return noOpt;
      if (sql.startsWith('select id, active, origin from erp.channel_listings')) return [];
      if (sql.startsWith('select max(product_label)')) return [{ label: '극세사 타월 블루' }];
      if (sql.startsWith('insert into erp.channel_listings')) return [{ id: '1801' }];
      if (sql.startsWith('insert into erp.listing_skus')) return [];
      if (sql.startsWith('select id from erp.order_lines')) return [{ id: '5' }];
      return undefined;
    });
    await linkListing(d, { channel: 'toss', productId: '1', optionKey: '', skuId: 72, multiplier: 1, label: '' }, AT);
    const lbl = calls.find((c) => c.sql.startsWith('select max(product_label)'));
    expect(lbl?.params).toEqual(['toss', '1']);
    const lockAt = calls.findIndex((c) => c.sql.startsWith('select pg_advisory_xact_lock'));
    expect(lockAt).toBeLessThan(calls.findIndex((c) => c.sql.startsWith('select max(product_label)')));
    const ins = calls.find((c) => c.sql.startsWith('insert into erp.channel_listings'));
    expect(ins?.params).toEqual(['toss', '1', '', '극세사 타월 블루']);
  });

  it('(리뷰 A5~A7 #5) label도 미귀속 줄의 상품명도 없으면 상품번호를 쓴다 — [object Object] 금지', async () => {
    const d = db((sql, params) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '72', status: 'active' }];
      const noOpt = NO_OTHER_OPTION(sql, params);
      if (noOpt) return noOpt;
      if (sql.startsWith('select id, active, origin from erp.channel_listings')) return [];
      if (sql.startsWith('select max(product_label)')) return [{ label: null }];
      if (sql.startsWith('insert into erp.channel_listings')) return [{ id: '1801' }];
      if (sql.startsWith('insert into erp.listing_skus')) return [];
      if (sql.startsWith('select id from erp.order_lines')) return [];
      return undefined;
    });
    await linkListing(d, { channel: 'toss', productId: '77', optionKey: '', skuId: 72, multiplier: 1, label: '' }, AT);
    const ins = calls.find((c) => c.sql.startsWith('insert into erp.channel_listings'));
    expect(ins?.params).toEqual(['toss', '77', '', '77']);
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
      if (sql.startsWith('select count(*)::int as n from erp.order_lines') && sql.includes('jsonb_array_length')) return [{ n: 1 }];
      return undefined;
    });
    await expect(linkLines(d, { lineIds: [55], skuId: 73 }, AT)).rejects.toMatchObject({ code: 'invalid' });
    expect(m.relinkLines).not.toHaveBeenCalled();
  });

  it('(리뷰 A5~A7 #6) 이미 자동으로 매핑됐고 사람이 정하지 않은 줄은 「이 주문만 연결」로 덮지 않는다', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status from erp.skus')) return [{ id: '73', status: 'active' }];
      if (sql.startsWith('select distinct channel from erp.order_lines')) return [{ channel: 'toss' }];
      if (sql.startsWith('select count(*)::int as n from erp.order_lines') && sql.includes('jsonb_array_length')) return [{ n: 0 }];
      if (sql.startsWith('select count(*)::int as n from erp.order_lines') && sql.includes('not (attribution')) return [{ n: 1 }];
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
