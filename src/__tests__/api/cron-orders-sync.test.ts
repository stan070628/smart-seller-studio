// src/__tests__/api/cron-orders-sync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  collectOrders: vi.fn(),
  withJobRun: vi.fn(async (_job: string, fn: () => Promise<{ value: unknown; counts?: Record<string, number> }>) => (await fn()).value),
  send: vi.fn(async () => undefined),
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/erp/orders/collect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/orders/collect')>('@/lib/erp/orders/collect');
  return { ...actual, collectOrders: m.collectOrders };
});
vi.mock('@/lib/jobs/run-log', () => ({ withJobRun: m.withJobRun }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: m.send }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: m.getCurrentUser }));

const rep = (channel: string, ok: boolean, error: string | null = null) => ({
  channel, ok, skipped: null, dryRun: false, window: null, fetched: ok ? 3 : 0, inserted: ok ? 2 : 0, updated: 1, absent: 0,
  unattributed: 0, unknownStatus: 0, legacy: { upserted: 0, inserted: 0, voided: 0 }, deduct: null, error,
});
const cron = (qs = '', token = 's3cret') =>
  new NextRequest(`http://localhost/api/cron/orders-sync${qs}`, { headers: { authorization: `Bearer ${token}` } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('JOB_ALERT_TELEGRAM_CHAT_ID', 'chat-1');
  m.collectOrders.mockResolvedValue([rep('coupang_wing', true), rep('coupang_rg', true), rep('naver', true), rep('toss', true)]);
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/orders-sync', () => {
  it('비밀값이 틀리거나 비어 있으면 401이고 작업을 기록하지 않는다', async () => {
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    expect((await GET(cron('', 'x'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(cron('', ''))).status).toBe(401);
    expect(m.withJobRun).not.toHaveBeenCalled();
  });

  it('4채널을 orders-sync 작업(cron)으로 기록하고 채널별 counts를 남긴다', async () => {
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    const res = await GET(cron());
    expect(res.status).toBe(200);
    expect(m.withJobRun).toHaveBeenCalledWith('orders-sync', expect.any(Function), { trigger: 'cron' });
    expect(m.collectOrders).toHaveBeenCalledWith({ channels: ['coupang_wing', 'coupang_rg', 'naver', 'toss'], dryRun: false });
    const outcome = await m.withJobRun.mock.calls[0][1]();
    expect(outcome.counts).toMatchObject({ channels: 4, errors: 0, fetched: 12, naver_fetched: 3, naver_new: 2, toss_error: 0 });
    expect(m.send).not.toHaveBeenCalled();
    expect((await res.json()).reports).toHaveLength(4);
  });

  it('?channel=naver&dryRun=1 — 한 채널 드라이런은 manual로 기록한다', async () => {
    m.collectOrders.mockResolvedValue([rep('naver', true)]);
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    await GET(cron('?channel=naver&dryRun=1'));
    expect(m.collectOrders).toHaveBeenCalledWith({ channels: ['naver'], dryRun: true });
    expect(m.withJobRun).toHaveBeenCalledWith('orders-sync', expect.any(Function), { trigger: 'manual' });
  });

  it('없는 채널은 400', async () => {
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    expect((await GET(cron('?channel=karrot'))).status).toBe(400);
    expect(m.collectOrders).not.toHaveBeenCalled();
  });

  it('일부 채널만 실패하면 200 · 텔레그램에 채널별 실패', async () => {
    m.collectOrders.mockResolvedValue([rep('coupang_wing', true), rep('naver', false, '[네이버 API] 500')]);
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    const res = await GET(cron());
    expect(res.status).toBe(200);
    expect(m.send).toHaveBeenCalledWith('chat-1', expect.stringContaining('네이버 — [네이버 API] 500'));
  });

  it('모든 채널이 실패하면 500(작업 실패로 남는다)', async () => {
    m.collectOrders.mockResolvedValue([rep('naver', false, 'x'), rep('toss', false, 'y')]);
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    const res = await GET(cron());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/모든 채널 실패/);
  });
});

describe('POST /api/erp/orders/sync', () => {
  const post = (body: unknown) => new NextRequest('http://localhost/api/erp/orders/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('로그인하지 않으면 401이고 수집하지 않는다', async () => {
    m.getCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/orders/sync/route');
    expect((await POST(post({}))).status).toBe(401);
    expect(m.collectOrders).not.toHaveBeenCalled();
  });

  it('화면의 「지금 수집」 — 4채널을 manual로 · 결과를 data로', async () => {
    m.getCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
    const { POST } = await import('@/app/api/erp/orders/sync/route');
    const res = await POST(post({}));
    expect(res.status).toBe(200);
    expect(m.withJobRun).toHaveBeenCalledWith('orders-sync', expect.any(Function), { trigger: 'manual' });
    expect((await res.json()).data).toHaveLength(4);
  });

  it('채널 하나만 · 없는 채널은 400', async () => {
    m.getCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
    const { POST } = await import('@/app/api/erp/orders/sync/route');
    await POST(post({ channel: 'toss' }));
    expect(m.collectOrders).toHaveBeenCalledWith({ channels: ['toss'], dryRun: false });
    expect((await POST(post({ channel: 'x' }))).status).toBe(400);
  });
});
