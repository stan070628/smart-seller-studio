// src/__tests__/api/cron-stock-sync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRun, mockWith, mockSendTelegram } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockWith: vi.fn(async (_job: string, fn: () => Promise<{ value: unknown; counts?: Record<string, number> }>) => (await fn()).value),
  mockSendTelegram: vi.fn(),
}));
vi.mock('@/lib/stock-sync/run', () => ({ runStockSync: mockRun, formatSyncReport: () => 'report' }));
vi.mock('@/lib/jobs/run-log', () => ({ withJobRun: mockWith }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: mockSendTelegram }));

const req = (qs = '') =>
  new NextRequest(`http://localhost/api/cron/stock-sync${qs}`, { headers: { authorization: 'Bearer s3cret' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  mockRun.mockResolvedValue({ dryRun: false, links: 10, changes: [{}, {}], errors: [] });
});

afterEach(() => vi.unstubAllEnvs());

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

  it('?trigger=manual이면 dryRun이 아니어도 manual로 기록한다', async () => {
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    await GET(req('?trigger=manual'));
    expect(mockWith).toHaveBeenCalledWith('stock-sync', expect.any(Function), { trigger: 'manual' });
  });

  it('CRON_SECRET이 비어 있으면 빈 Bearer로도 401이고 작업을 기록하지 않는다', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    const res = await GET(new NextRequest('http://localhost/api/cron/stock-sync', { headers: { authorization: 'Bearer ' } }));
    expect(res.status).toBe(401);
    expect(mockWith).not.toHaveBeenCalled();
  });

  it('실패하면 500이고 오류 메시지·텔레그램 모두 개인정보가 가려진다', async () => {
    vi.stubEnv('STOCK_SYNC_TELEGRAM_CHAT_ID', 'c9');
    mockRun.mockRejectedValue(new Error('수취인 010-1234-5678 boom'));
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('010-****-5678');
    expect(body.error).not.toContain('010-1234-5678');
    expect(mockSendTelegram).toHaveBeenCalledTimes(1);
    const [, sentMsg] = mockSendTelegram.mock.calls[0];
    expect(sentMsg).toContain('010-****-5678');
    expect(sentMsg).not.toContain('010-1234-5678');
  });

  describe('텔레그램 분기', () => {
    it('changes·errors 둘 다 0이면 보내지 않는다', async () => {
      vi.stubEnv('STOCK_SYNC_TELEGRAM_CHAT_ID', 'c9');
      mockRun.mockResolvedValue({ dryRun: false, links: 10, changes: [], errors: [] });
      const { GET } = await import('@/app/api/cron/stock-sync/route');
      await GET(req());
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    it('errors만 있어도 보낸다', async () => {
      vi.stubEnv('STOCK_SYNC_TELEGRAM_CHAT_ID', 'c9');
      mockRun.mockResolvedValue({ dryRun: false, links: 10, changes: [], errors: ['쿠팡 조회 실패'] });
      const { GET } = await import('@/app/api/cron/stock-sync/route');
      await GET(req());
      expect(mockSendTelegram).toHaveBeenCalledTimes(1);
    });

    it('chat id가 없으면 변경이 있어도 보내지 않는다', async () => {
      mockRun.mockResolvedValue({ dryRun: false, links: 10, changes: [{}], errors: [] });
      const { GET } = await import('@/app/api/cron/stock-sync/route');
      await GET(req());
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });
  });
});
