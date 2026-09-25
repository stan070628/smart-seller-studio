// src/__tests__/api/cron-stock-sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRun, mockWith } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockWith: vi.fn(async (_job: string, fn: () => Promise<{ value: unknown; counts?: Record<string, number> }>) => (await fn()).value),
}));
vi.mock('@/lib/stock-sync/run', () => ({ runStockSync: mockRun, formatSyncReport: () => 'report' }));
vi.mock('@/lib/jobs/run-log', () => ({ withJobRun: mockWith }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: vi.fn() }));

const req = (qs = '') =>
  new NextRequest(`http://localhost/api/cron/stock-sync${qs}`, { headers: { authorization: 'Bearer s3cret' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  mockRun.mockResolvedValue({ dryRun: false, links: 10, changes: [{}, {}], errors: [] });
});

describe('GET /api/cron/stock-sync', () => {
  it('비밀값이 틀리면 401이고 작업을 기록하지 않는다', async () => {
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    const res = await GET(new NextRequest('http://localhost/api/cron/stock-sync', { headers: { authorization: 'Bearer x' } }));
    expect(res.status).toBe(401);
    expect(mockWith).not.toHaveBeenCalled();
  });

  it('stock-sync 작업으로 기록하고 counts에 링크·변경·오류 수를 넘긴다', async () => {
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockWith).toHaveBeenCalledWith('stock-sync', expect.any(Function), { trigger: 'cron' });
    const outcome = await mockWith.mock.calls[0][1]();
    expect(outcome.counts).toEqual({ links: 10, changes: 2, errors: 0 });
  });

  it('dryRun 호출은 manual로 기록한다', async () => {
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    await GET(req('?dryRun=1'));
    expect(mockWith).toHaveBeenCalledWith('stock-sync', expect.any(Function), { trigger: 'manual' });
  });
});
