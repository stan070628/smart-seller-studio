import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChannelReport } from '@/lib/erp/orders/collect';

const m = vi.hoisted(() => ({
  collectOrders: vi.fn(),
  sendTelegramMessage: vi.fn(),
  query: vi.fn(),
  enrich: vi.fn(),
}));
vi.mock('@/lib/erp/orders/collect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/orders/collect')>('@/lib/erp/orders/collect');
  return { ...actual, collectOrders: m.collectOrders };
});
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: m.sendTelegramMessage }));
// withJobRun(run-log.ts)이 쓰는 erp.job_runs 기록용 — 실 DB를 건드리지 않는다
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: () => ({ query: m.query }) }));
vi.mock('@/lib/erp/orders/discounts', () => ({ enrichCoupangDiscounts: m.enrich }));
vi.mock('@/lib/listing/coupang-client', () => ({ getCoupangClient: () => ({ getOrderCoupons: vi.fn() }) }));

import { runOrdersSync } from '@/lib/erp/orders/run';
import { emptyReport } from '@/lib/erp/orders/collect';

const CHAT_ID = '-1001234567890';

const busy = (ch: ChannelReport['channel']): ChannelReport => ({
  ...emptyReport(ch, false), ok: false, skipped: 'busy', error: '다른 수집이 이 채널의 임대를 잡고 있다(최대 10분) — 이번 실행은 건너뛴다',
});
const failed = (ch: ChannelReport['channel'], error = '연결 실패'): ChannelReport => ({
  ...emptyReport(ch, false), ok: false, skipped: null, error,
});
const ok = (ch: ChannelReport['channel']): ChannelReport => ({ ...emptyReport(ch, false), ok: true });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JOB_ALERT_TELEGRAM_CHAT_ID = CHAT_ID;
  m.query.mockImplementation(async (sql: string) => (sql.startsWith('insert') ? { rows: [{ id: '1' }] } : { rows: [] }));
  m.sendTelegramMessage.mockResolvedValue(undefined);
  m.enrich.mockResolvedValue({ orders: 2, checked: 3, discounted: 1, errors: 0, errorsClosed: 0, rate: 0 });
});

const finishedCounts = (): Record<string, number> => {
  const fin = m.query.mock.calls.find((c) => String(c[0]).startsWith('update erp.job_runs'));
  // run-log.ts: counts = $3 = JSON.stringify(counts)
  return JSON.parse(String((fin?.[1] as unknown[])[2]));
};

describe('runOrdersSync — busy는 실패가 아니다', () => {
  it('모든 채널이 busy면 던지지 않고 정상 반환한다 — 텔레그램도 보내지 않는다', async () => {
    m.collectOrders.mockResolvedValue([busy('coupang_wing'), busy('coupang_rg'), busy('naver'), busy('toss')]);
    const reports = await runOrdersSync({ channels: ['coupang_wing', 'coupang_rg', 'naver', 'toss'], dryRun: false, trigger: 'manual' });
    expect(reports).toHaveLength(4);
    expect(reports.every((r) => r.skipped === 'busy')).toBe(true);
    expect(m.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('busy 3개 + 실패 1개면 (실패한 채널이 active 전부 실패이므로) 던진다', async () => {
    m.collectOrders.mockResolvedValue([busy('coupang_wing'), busy('coupang_rg'), busy('naver'), failed('toss', '연결 실패')]);
    await expect(
      runOrdersSync({ channels: ['coupang_wing', 'coupang_rg', 'naver', 'toss'], dryRun: false, trigger: 'manual' }),
    ).rejects.toThrow(/모든 채널 실패/);
  });

  it('busy 1개 + 성공 3개면 던지지 않고, 텔레그램 알림줄에 busy 채널을 싣지 않는다', async () => {
    m.collectOrders.mockResolvedValue([busy('toss'), ok('coupang_wing'), ok('coupang_rg'), ok('naver')]);
    await runOrdersSync({ channels: ['coupang_wing', 'coupang_rg', 'naver', 'toss'], dryRun: false, trigger: 'manual' });
    if (m.sendTelegramMessage.mock.calls.length > 0) {
      const text = m.sendTelegramMessage.mock.calls[0][1] as string;
      expect(text).not.toMatch(/busy|토스/);
    }
  });

  it('busy 1개 + 실패 1개 + 성공 2개면 실패한 채널만 텔레그램 알림줄에 싣는다(busy는 제외)', async () => {
    m.collectOrders.mockResolvedValue([busy('toss'), failed('naver', '연결 끊김'), ok('coupang_wing'), ok('coupang_rg')]);
    await runOrdersSync({ channels: ['coupang_wing', 'coupang_rg', 'naver', 'toss'], dryRun: false, trigger: 'manual' });
    expect(m.sendTelegramMessage).toHaveBeenCalledTimes(1);
    const text = m.sendTelegramMessage.mock.calls[0][1] as string;
    expect(text).toContain('네이버');
    expect(text).toContain('연결 끊김');
    expect(text).not.toContain('토스');
  });
});

describe('runOrdersSync — (1-C2b ②) 쿠팡 쿠폰 조회', () => {
  it('쓰는 실행이고 쿠팡 채널이 있으면 수집 뒤 쿠폰을 조회해 job_runs counts에 싣는다 · dryRun·쿠팡 없는 실행은 부르지 않는다', async () => {
    m.collectOrders.mockResolvedValue([ok('coupang_rg'), ok('naver')]);
    await runOrdersSync({ channels: ['coupang_rg', 'naver'], dryRun: false, trigger: 'cron' });
    expect(m.enrich).toHaveBeenCalledWith(expect.anything(), expect.any(Function), { limitOrders: 60 });
    expect(finishedCounts()).toMatchObject({ discount_orders: 2, discount_checked: 3, discount_errors: 0, discount_errors_closed: 0, discount_rate: 0 });
    expect(m.sendTelegramMessage).not.toHaveBeenCalled();
    m.enrich.mockClear();
    m.collectOrders.mockResolvedValue([ok('naver')]);
    await runOrdersSync({ channels: ['naver'], dryRun: false, trigger: 'cron' });
    m.collectOrders.mockResolvedValue([ok('coupang_rg')]);
    await runOrdersSync({ channels: ['coupang_rg'], dryRun: true, trigger: 'manual' });
    expect(m.enrich).not.toHaveBeenCalled();
  });

  it('RATE 쿠폰·조회 불가로 닫은 주문이 있으면 텔레그램에 따로 알린다', async () => {
    m.enrich.mockResolvedValue({ orders: 5, checked: 2, discounted: 1, errors: 2, errorsClosed: 2, rate: 1 });
    m.collectOrders.mockResolvedValue([ok('coupang_wing')]);
    await runOrdersSync({ channels: ['coupang_wing'], dryRun: false, trigger: 'cron' });
    expect(m.sendTelegramMessage).toHaveBeenCalledTimes(1);
    const text = m.sendTelegramMessage.mock.calls[0][1] as string;
    expect(text).toContain('쿠팡 율(RATE) 쿠폰 주문 1건 — 할인 미기록');
    expect(text).toContain('쿠팡 쿠폰 조회 불가로 닫은 주문 2건 — 할인 모름');
  });

  it('쿠폰 조회 자체가 던져도 수집 결과는 그대로 남기고 discount_failed = 1', async () => {
    m.enrich.mockRejectedValue(new Error('DB 끊김'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.collectOrders.mockResolvedValue([ok('coupang_rg')]);
    const reports = await runOrdersSync({ channels: ['coupang_rg'], dryRun: false, trigger: 'cron' });
    expect(reports).toHaveLength(1);
    expect(finishedCounts()).toMatchObject({ discount_failed: 1 });
    err.mockRestore();
  });
});
