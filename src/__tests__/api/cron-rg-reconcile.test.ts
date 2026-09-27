// src/__tests__/api/cron-rg-reconcile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({ runRgAuto: vi.fn(), withJobRun: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/erp/stock/rg-auto-run', () => ({ runRgAuto: m.runRgAuto }));
vi.mock('@/lib/jobs/run-log', () => ({ withJobRun: m.withJobRun }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: m.send }));

const cron = (qs = '', secret = 's3cret') => new NextRequest(`http://localhost/api/cron/rg-reconcile${qs}`, { headers: { authorization: `Bearer ${secret}` } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 's3cret';
  process.env.JOB_ALERT_TELEGRAM_CHAT_ID = '-100';
  m.withJobRun.mockImplementation(async (_job: string, fn: () => Promise<{ value: unknown }>) => (await fn()).value);
  m.send.mockResolvedValue(undefined);
});

describe('GET /api/cron/rg-reconcile', () => {
  it('비밀값이 다르면 401', async () => {
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    expect((await GET(cron('', 'x'))).status).toBe(401);
    expect(m.runRgAuto).not.toHaveBeenCalled();
  });

  it('실행 → job_runs(rg-reconcile) → 옮김·예정·알림이 있으면 텔레그램 · ?dryRun=1은 forceDry', async () => {
    m.runRgAuto.mockResolvedValue({ skipped: null, autoMove: false, runId: 'r', skus: 17, moves: [{ skuId: 72, qty: 5 }], alerts: ['연결 안 된 RG 번호 9 재고 2개'] });
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    const res = await GET(cron('?dryRun=1'));
    expect(res.status).toBe(200);
    expect(m.runRgAuto).toHaveBeenCalledWith({ now: expect.any(Date), forceDry: true });
    expect(m.withJobRun).toHaveBeenCalledWith('rg-reconcile', expect.any(Function), { trigger: 'manual' });
    expect(m.send.mock.calls[0][1]).toContain('옮길 예정 1건');
    expect(m.send.mock.calls[0][1]).toContain('연결 안 된 RG 번호');
  });

  it('건너뜀·할 일 없음은 텔레그램을 보내지 않는다', async () => {
    m.runRgAuto.mockResolvedValue({ skipped: 'deduct_off', autoMove: false, runId: null, skus: 0, moves: [], alerts: [] });
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    await GET(cron());
    expect(m.send).not.toHaveBeenCalled();
    expect(m.withJobRun).toHaveBeenCalledWith('rg-reconcile', expect.any(Function), { trigger: 'cron' });
  });
});
