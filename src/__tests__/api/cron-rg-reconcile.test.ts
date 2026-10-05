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
    m.runRgAuto.mockResolvedValue({
      skipped: null, autoMove: false, runId: 'r', skus: 17, moves: [{ skuId: 72, qty: 5 }], moved: [], returns: [], returned: [], returnsChanged: false, failed: 0,
      alerts: ['연결 안 된 RG 번호 9 재고 2개'], newAlerts: ['연결 안 된 RG 번호 9 재고 2개'], movesChanged: true,
    });
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    const res = await GET(cron('?dryRun=1'));
    expect(res.status).toBe(200);
    expect(m.runRgAuto).toHaveBeenCalledWith({ now: expect.any(Date), forceDry: true });
    expect(m.withJobRun).toHaveBeenCalledWith('rg-reconcile', expect.any(Function), { trigger: 'manual' });
    expect(m.send.mock.calls[0][1]).toContain('옮길 예정 1건');
    expect(m.send.mock.calls[0][1]).toContain('연결 안 된 RG 번호');
  });

  it('건너뜀·할 일 없음은 텔레그램을 보내지 않는다', async () => {
    m.runRgAuto.mockResolvedValue({ skipped: 'deduct_off', autoMove: false, runId: null, skus: 0, moves: [], moved: [], returns: [], returned: [], returnsChanged: false, failed: 0, alerts: [], newAlerts: [], movesChanged: false });
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    await GET(cron());
    expect(m.send).not.toHaveBeenCalled();
    expect(m.withJobRun).toHaveBeenCalledWith('rg-reconcile', expect.any(Function), { trigger: 'cron' });
  });

  it('직전 실행과 같으면 보내지 않고 · 새 알림만 있으면 그 줄만 보낸다(옮길 예정 머리줄은 예정이 바뀔 때만)', async () => {
    const base = { skipped: null, autoMove: false, runId: 'r', skus: 17, moves: [{ skuId: 72, qty: 5 }], moved: [], returns: [], returned: [], returnsChanged: false, failed: 0, alerts: ['A 알림', 'B 알림'] };
    m.runRgAuto.mockResolvedValueOnce({ ...base, newAlerts: [], movesChanged: false });
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    await GET(cron());
    expect(m.send).not.toHaveBeenCalled();
    m.runRgAuto.mockResolvedValueOnce({ ...base, newAlerts: ['B 알림'], movesChanged: false });
    await GET(cron());
    const text = m.send.mock.calls[0][1] as string;
    expect(text).toContain('· B 알림');
    expect(text).not.toContain('A 알림');
    expect(text).not.toContain('옮길 예정');
  });

  it('자동 이동이 켜져 있으면 머리줄은 실제로 옮긴 건수 · 실패 수', async () => {
    m.runRgAuto.mockResolvedValue({
      skipped: null, autoMove: true, runId: 'r', skus: 17, moves: [{ skuId: 72, qty: 5 }, { skuId: 80, qty: 4 }], moved: [{ skuId: 80, qty: 4 }], returns: [], returned: [], returnsChanged: false, failed: 1,
      alerts: ['X 자동 이동 실패: 부족'], newAlerts: ['X 자동 이동 실패: 부족'], movesChanged: true,
    });
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    await GET(cron());
    expect(m.send.mock.calls[0][1]).toContain('RG 입고 완료 자동 1건');
    expect(m.send.mock.calls[0][1]).toContain('실패 1건');
    expect(m.withJobRun).toHaveBeenCalled();
  });

  it('자동 이동으로 실제로 옮겼으면 옮길 예정이 직전과 같아도(movesChanged false) 늘 보낸다', async () => {
    m.runRgAuto.mockResolvedValue({
      skipped: null, autoMove: true, runId: 'r', skus: 17, moves: [{ skuId: 72, qty: 5 }], moved: [{ skuId: 72, qty: 5 }], returns: [], returned: [], returnsChanged: false, failed: 0,
      alerts: [], newAlerts: [], movesChanged: false,
    });
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    await GET(cron());
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.send.mock.calls[0][1]).toContain('RG 입고 완료 자동 1건');
  });

  const ret = (o: object) => ({ skipped: null, autoMove: true, runId: 'r', skus: 17, moves: [], moved: [], returns: [], returned: [], returnsChanged: false, failed: 0, alerts: [], newAlerts: [], movesChanged: false, ...o });

  it('복귀를 실제로 기록했으면 🔵 줄(건수·개수)을 늘 보낸다', async () => {
    m.runRgAuto.mockResolvedValue(ret({ returns: [{ skuId: 1, qty: 2 }, { skuId: 2, qty: 1 }], returned: [{ skuId: 1, qty: 2 }, { skuId: 2, qty: 1 }] }));
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    await GET(cron());
    expect(m.send.mock.calls[0][1]).toContain('🔵 RG 취소·반품 복귀 2건 3개');
  });

  it('자동 이동이 꺼져 있고 복귀 예정이 바뀌었으면 예정 줄', async () => {
    m.runRgAuto.mockResolvedValue(ret({ autoMove: false, returns: [{ skuId: 1, qty: 2 }], returnsChanged: true }));
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    await GET(cron());
    expect(m.send.mock.calls[0][1]).toContain('복귀 예정 1건 2개(자동 이동 꺼짐)');
  });

  it('이동·복귀가 없어도 실패가 있으면 🔴 줄', async () => {
    m.runRgAuto.mockResolvedValue(ret({ failed: 2 }));
    const { GET } = await import('@/app/api/cron/rg-reconcile/route');
    await GET(cron());
    expect(m.send.mock.calls[0][1]).toContain('🔴 RG 대조 전표 실패 2건');
  });
});
