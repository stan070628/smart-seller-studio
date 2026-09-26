// src/__tests__/api/erp-stock.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockApply, mockReverse } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockApply: vi.fn(),
  mockReverse: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/ledger/adjust-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/adjust-store')>()),
  applyAdjustments: mockApply,
}));
vi.mock('@/lib/erp/ledger/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/store')>()),
  reverse: mockReverse,
}));

import { AdjustItemError, StaleCountError } from '@/lib/erp/ledger/adjust';
import { erpError } from '@/lib/erp/stock/http';

const REQ = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
type Rows = { rows: Record<string, unknown>[]; rowCount: number };

let poolRows: (sql: string) => Rows;
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

const get = (url: string) => new NextRequest(`http://localhost${url}`);
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const clientSql = () => client.query.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  poolRows = (sql) => {
    if (sql.startsWith("select id from erp.skus where status = 'active'")) return { rows: [{ id: 7 }, { id: 9 }], rowCount: 2 };
    throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
  };
  // 활성 SKU 확인은 이제 트랜잭션 안(client)에서 한다 — pool이 아니라 client가 그 SQL을 답한다
  client = {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("select id from erp.skus where status = 'active'")) return { rows: [{ id: 7 }, { id: 9 }], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  mockGetPool.mockReturnValue({ query: vi.fn(async (sql: string) => poolRows(sql)), connect: vi.fn(async () => client) });
});

describe('GET /api/erp/stock', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/stock/route');
    expect((await GET(get('/api/erp/stock'))).status).toBe(401);
  });

  it('SKU별 위치 재고·평가액·단가를 돌려준다', async () => {
    poolRows = () => ({
      rows: [{
        id: '7', key: 'cp:1:블랙', name: '왜건', option_label: '블랙', legacy: ['pc-1'], self: 3, rg_inbound: 0, rg: 2, value: '5000', self_value: '3000',
        has_ledger: true, has_self_ledger: true, lot_cost: 1000, legacy_cost: null, base_unit_label: null, last_counted_at: new Date('2026-09-20T01:00:00Z'),
      }],
      rowCount: 1,
    });
    const { GET } = await import('@/app/api/erp/stock/route');
    const json = await (await GET(get('/api/erp/stock'))).json();
    expect(json.data).toEqual([{
      skuId: 7, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: ['pc-1'],
      self: 3, rgInbound: 0, rg: 2, value: 5000, hasLedger: true, hasSelfLedger: true, lotCost: 1000, legacyCost: null, costNeedsInput: false,
      selfValue: 3000, lastCountedAt: '2026-09-20T01:00:00.000Z',
    }]);
  });

  it('rg 위치에만 전표가 있고 self 전표는 없으면 hasLedger는 true, hasSelfLedger는 false', async () => {
    poolRows = () => ({
      rows: [{
        id: '7', key: 'cp:1:블랙', name: '왜건', option_label: '블랙', legacy: [], self: 0, rg_inbound: 0, rg: 2, value: '0', self_value: '0',
        has_ledger: true, has_self_ledger: false, lot_cost: null, legacy_cost: null, base_unit_label: null, last_counted_at: null,
      }],
      rowCount: 1,
    });
    const { GET } = await import('@/app/api/erp/stock/route');
    const json = await (await GET(get('/api/erp/stock'))).json();
    expect(json.data[0].hasLedger).toBe(true);
    expect(json.data[0].hasSelfLedger).toBe(false);
  });

  it('기준 단위가 정해진 SKU는 옛 입고 단가를 미리 채우지 않고 단가 입력이 필요하다고 알린다', async () => {
    let sql = '';
    poolRows = (q) => {
      sql = q;
      return {
        rows: [
          { id: '7', key: 'k7', name: 'a', option_label: '', legacy: ['pc-1'], self: 0, rg_inbound: 0, rg: 0, value: '0', has_ledger: false, has_self_ledger: false, lot_cost: null, legacy_cost: 650, base_unit_label: '개' },
          { id: '9', key: 'k9', name: 'b', option_label: '', legacy: ['pc-2'], self: 0, rg_inbound: 0, rg: 0, value: '0', has_ledger: false, has_self_ledger: false, lot_cost: null, legacy_cost: 650, base_unit_label: null },
        ],
        rowCount: 2,
      };
    };
    const { GET } = await import('@/app/api/erp/stock/route');
    const json = await (await GET(get('/api/erp/stock'))).json();
    expect(json.data.map((r: { legacyCost: number | null; costNeedsInput: boolean }) => [r.legacyCost, r.costNeedsInput])).toEqual([[null, true], [650, false]]);
    expect(sql).toMatch(/received_at desc nulls last, ce\.created_at desc nulls last/);
  });
});

describe('POST /api/erp/stock/adjust', () => {
  const item = { skuId: 7, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', unitCost: 900, requestId: REQ };

  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    expect((await POST(post('/api/erp/stock/adjust', { items: [item] }))).status).toBe(401);
  });

  it.each([
    ['빈 items', { items: [] }],
    ['RG 위치(대조로만 고친다)', { items: [{ ...item, location: 'rg' }] }],
    ['서버 전용 사유', { items: [{ ...item, reason: 'opening' }] }],
    ['활성이 아닌 SKU', { items: [{ ...item, skuId: 11 }] }],
  ])('%s → 400, 원장을 건드리지 않는다', async (_, body) => {
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const res = await POST(post('/api/erp/stock/adjust', body));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('한 트랜잭션에서 applyAdjustments를 부르고 서버 시각을 쓴다', async () => {
    mockApply.mockResolvedValue([{ skuId: 7, location: 'self', requestId: REQ, outcome: 'posted', kind: 'adjust', qty: 2, idemKey: `adj:${REQ}`, unitCost: 900, costSource: 'input' }]);
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const res = await POST(post('/api/erp/stock/adjust', { items: [item] }));
    expect(res.status).toBe(200);
    const [db, inputs] = mockApply.mock.calls[0];
    expect(db).toBe(client);
    expect(inputs).toEqual([{
      skuId: 7, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', unitCost: 900, requestId: REQ, occurredAt: expect.stringMatching(ISO),
    }]);
    expect(clientSql()).toEqual(['BEGIN', "select id from erp.skus where status = 'active'", 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('화면 재고가 낡았으면 409 stale + 몇 번째인지, 트랜잭션은 되돌린다', async () => {
    mockApply.mockRejectedValue(new AdjustItemError(0, 7, 'self', new StaleCountError(3, 4)));
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const res = await POST(post('/api/erp/stock/adjust', { items: [item] }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, code: 'stale', index: 0, skuId: 7 });
    expect(clientSql()).toEqual(['BEGIN', "select id from erp.skus where status = 'active'", 'ROLLBACK']);
  });

  it('rg가 아닌 잘못된 위치는 「위치는 self·rg_inbound만」, rg는 기존 안내문', async () => {
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const resBad = await POST(post('/api/erp/stock/adjust', { items: [{ ...item, location: 'warehouse' }] }));
    expect(resBad.status).toBe(400);
    expect((await resBad.json()).error).toContain('위치는 self·rg_inbound만');

    const resRg = await POST(post('/api/erp/stock/adjust', { items: [{ ...item, location: 'rg' }] }));
    expect(resRg.status).toBe(400);
    expect((await resRg.json()).error).toContain('RG 실재고 대조');
  });

  it('items가 500건을 넘으면 400', async () => {
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const many = Array.from({ length: 501 }, () => item);
    const res = await POST(post('/api/erp/stock/adjust', { items: many }));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('items가 500건이면 통과한다(경계값)', async () => {
    mockApply.mockResolvedValue([]);
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const many = Array.from({ length: 500 }, () => item);
    const res = await POST(post('/api/erp/stock/adjust', { items: many }));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/erp/stock/[skuId]/history', () => {
  const ctx = (skuId: string) => ({ params: Promise.resolve({ skuId }) });

  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/stock/[skuId]/history/route');
    expect((await GET(get('/api/erp/stock/7/history'), ctx('7'))).status).toBe(401);
  });

  it('숫자가 아닌 SKU는 400', async () => {
    const { GET } = await import('@/app/api/erp/stock/[skuId]/history/route');
    expect((await GET(get('/api/erp/stock/abc/history'), ctx('abc'))).status).toBe(400);
  });

  it('postgres integer 상한(2147483647)을 넘는 SKU id는 400', async () => {
    const { GET } = await import('@/app/api/erp/stock/[skuId]/history/route');
    const res = await GET(get('/api/erp/stock/2147483648/history'), ctx('2147483648'));
    expect(res.status).toBe(400);
  });

  it('상한값 2147483647은 통과한다(경계값)', async () => {
    poolRows = () => ({ rows: [], rowCount: 0 });
    const { GET } = await import('@/app/api/erp/stock/[skuId]/history/route');
    const res = await GET(get('/api/erp/stock/2147483647/history'), ctx('2147483647'));
    expect(res.status).toBe(200);
  });

  it('되돌리기는 되돌리지 않은 조정·기초 묶음에만 연다', async () => {
    poolRows = () => ({
      rows: [
        { id: 3, location: 'self', qty: -2, kind: 'adjust', reason: 'damage', note: null, occurred_at: new Date('2026-09-27T02:00:00Z'), idem_key: `adj:${REQ}#0`, ref_type: 'adjust', ref_id: REQ, unit_cost: 700, reversed: false },
        { id: 2, location: 'self', qty: -5, kind: 'reversal', reason: null, note: null, occurred_at: new Date('2026-09-27T01:30:00Z'), idem_key: 'rev:opening:7:self', ref_type: 'adjust', ref_id: 'r0', unit_cost: 700, reversed: false },
        { id: 1, location: 'self', qty: 5, kind: 'opening', reason: 'opening', note: null, occurred_at: new Date('2026-09-27T01:00:00Z'), idem_key: 'opening:7:self', ref_type: 'adjust', ref_id: 'r0', unit_cost: 700, reversed: true },
      ],
      rowCount: 3,
    });
    const { GET } = await import('@/app/api/erp/stock/[skuId]/history/route');
    const json = await (await GET(get('/api/erp/stock/7/history'), ctx('7'))).json();
    expect(json.data.map((h: { baseKey: string; reversible: boolean }) => [h.baseKey, h.reversible])).toEqual([
      [`adj:${REQ}`, true],
      ['rev:opening:7:self', false],
      ['opening:7:self', false],
    ]);
    expect(json.data[0].occurredAt).toBe('2026-09-27T02:00:00.000Z');
  });
});

describe('POST /api/erp/stock/reverse', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    expect((await POST(post('/api/erp/stock/reverse', { idemKey: `adj:${REQ}` }))).status).toBe(401);
    expect(mockReverse).not.toHaveBeenCalled();
  });

  it('조정·기초 키가 아니면 400', async () => {
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    expect((await POST(post('/api/erp/stock/reverse', { idemKey: 'receipt:x:7' }))).status).toBe(400);
    expect(mockReverse).not.toHaveBeenCalled();
  });

  it('트랜잭션 안에서 reverse를 부른다', async () => {
    mockReverse.mockResolvedValue({ posted: true, ids: [10] });
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    const res = await POST(post('/api/erp/stock/reverse', { idemKey: `adj:${REQ}` }));
    expect(res.status).toBe(200);
    expect(mockReverse).toHaveBeenCalledWith(client, `adj:${REQ}`, { occurredAt: expect.stringMatching(ISO), note: '화면에서 되돌림' });
    expect(clientSql()).toEqual(['BEGIN', 'COMMIT']);
  });

  it('이미 되돌렸으면 409', async () => {
    mockReverse.mockResolvedValue({ posted: false, ids: [] });
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    const res = await POST(post('/api/erp/stock/reverse', { idemKey: 'opening:7:self' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('already');
  });

  it('되돌릴 전표가 없으면 404', async () => {
    mockReverse.mockRejectedValue(new Error('되돌릴 전표가 없다: opening:7:self'));
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    expect((await POST(post('/api/erp/stock/reverse', { idemKey: 'opening:7:self' }))).status).toBe(404);
  });

  it('되돌리면 재고가 음수가 되면 409', async () => {
    mockReverse.mockRejectedValue(new Error('SKU 7 · self · lot 1의 재고가 음수가 된다 (-1)'));
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    const res = await POST(post('/api/erp/stock/reverse', { idemKey: 'opening:7:self' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('negative');
  });

  it('대문자가 섞인 키도 소문자로 맞춰 되돌린다(재전송 대소문자 차이가 다른 요청이 되지 않는다)', async () => {
    mockReverse.mockResolvedValue({ posted: true, ids: [10] });
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    const mixed = `ADJ:${REQ.toUpperCase()}`;
    const res = await POST(post('/api/erp/stock/reverse', { idemKey: mixed }));
    expect(res.status).toBe(200);
    expect(mockReverse).toHaveBeenCalledWith(client, mixed.toLowerCase(), expect.anything());
  });
});

describe('GET /api/erp/stock/recent', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/stock/recent/route');
    expect((await GET(get('/api/erp/stock/recent'))).status).toBe(401);
  });

  it('최근 조정을 요청 단위로 돌려준다(limit 1~20)', async () => {
    let limit: unknown = null;
    mockGetPool.mockReturnValue({
      query: vi.fn(async (_sql: string, params: unknown[]) => {
        limit = params[0];
        return { rows: [{ ref_id: REQ, sku_id: '7', name: '왜건', option_label: '블랙', location: 'self', qty: -2, reason: 'damage', occurred_at: new Date('2026-09-27T02:00:00Z') }], rowCount: 1 };
      }),
    });
    const { GET } = await import('@/app/api/erp/stock/recent/route');
    const json = await (await GET(get('/api/erp/stock/recent?limit=99'))).json();
    expect(limit).toBe(20);
    expect(json.data).toEqual([{ requestId: REQ, skuId: 7, name: '왜건', option: '블랙', location: 'self', qty: -2, reason: 'damage', occurredAt: '2026-09-27T02:00:00.000Z' }]);
  });
});

describe('erpError', () => {
  it('멱등키 unique 위반(23505)은 409 — 겹친 요청이 먼저 기록했다', async () => {
    const e = Object.assign(new Error('duplicate key value violates unique constraint "stock_ledger_idem_key_key"'), {
      code: '23505', constraint: 'stock_ledger_idem_key_key',
    });
    const res = erpError(e);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('conflict');
    expect(erpError(new AdjustItemError(0, 7, 'self', e)).status).toBe(409);
  });

  it('센 기록 요청 id unique 위반(23505)도 409 — 겹친 요청이 먼저 셌다', async () => {
    const e = Object.assign(new Error('duplicate key value violates unique constraint "stock_counts_request_id_key"'), {
      code: '23505', constraint: 'stock_counts_request_id_key',
    });
    const res = erpError(e);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('conflict');
  });

  it('다른 unique 위반은 500', () => {
    const e = Object.assign(new Error('dup'), { code: '23505', constraint: 'skus_key_key' });
    expect(erpError(e).status).toBe(500);
  });

  it('되돌릴 전표가 없으면 404', async () => {
    const res = erpError(new Error('되돌릴 전표가 없다: opening:7:self'));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });

  it('원장 불변식 위반(일반 Error)은 500', () => {
    expect(erpError(new AdjustItemError(0, 7, 'self', new Error('멱등키 adj:x가 이미 있다'))).status).toBe(500);
  });
});
