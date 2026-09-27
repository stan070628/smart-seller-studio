import { describe, it, expect } from 'vitest';
import { dayLines, ordersStatus } from '@/lib/erp/orders/queries';
import type { Db } from '@/lib/erp/ledger/store';

describe('ordersStatus', () => {
  it('KST 오늘 기준 채널별 건수 · 없는 채널은 0 · 마지막 실행의 채널별 오류·busy·사라짐 거절·버림', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db: Db = {
      async query(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.startsWith('select channel,')) {
          return { rows: [{ channel: 'naver', t_orders: 2, t_lines: 3, y_orders: 1, y_lines: 1, l3_orders: 4, l3_lines: 6, unattributed: 1, short: 0, pending: 5, unknown: 0 }], rowCount: 1 };
        }
        if (sql.startsWith('select name, cursor_at')) {
          return { rows: [{ name: 'ledger_cutover', cursor_at: new Date('2026-09-26T11:07:04.989Z') }, { name: 'orders:naver', cursor_at: new Date('2026-09-27T02:45:00Z') }], rowCount: 2 };
        }
        if (sql.startsWith('select started_at')) {
          return {
            rows: [{
              started_at: new Date('2026-09-27T02:45:00Z'), finished_at: new Date('2026-09-27T02:45:40Z'), status: 'ok',
              counts: { naver_error: 0, toss_error: 1, naver_busy: 0, toss_busy: 0, naver_absence_refused: 0, toss_absence_refused: 1, naver_rejected: 0, toss_rejected: 2 },
              error: null,
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('select value from erp.settings')) return { rows: [{ value: { enabled: false } }], rowCount: 1 };
        throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
      },
    };
    const s = await ordersStatus(db, new Date('2026-09-26T16:00:00.000Z'));
    expect(calls[0].params).toEqual(['2026-09-27']);
    expect(s.today).toBe('2026-09-27');
    expect(s.cutover).toBe('2026-09-26T11:07:04.989Z');
    expect(s.deduct).toEqual({ enabled: false, enabledAt: null, by: null });
    expect(s.channels.map((c) => c.channel)).toEqual(['coupang_wing', 'coupang_rg', 'naver', 'toss']);
    expect(s.channels[2]).toEqual({
      channel: 'naver', label: '네이버', today: { orders: 2, lines: 3 }, yesterday: { orders: 1, lines: 1 }, last3: { orders: 4, lines: 6 },
      unattributed: 1, short: 0, pending: 5, unknownStatus: 0, cursorAt: '2026-09-27T02:45:00.000Z',
      lastError: 0, lastBusy: 0, lastAbsenceRefused: 0, lastRejected: 0,
    });
    expect(s.channels[0]).toMatchObject({ today: { orders: 0, lines: 0 }, cursorAt: null, lastError: null, lastBusy: null, lastAbsenceRefused: null, lastRejected: null });
    expect(s.channels[3]).toMatchObject({ lastError: 1, lastBusy: 0, lastAbsenceRefused: 1, lastRejected: 2 });
    expect(s.lastRun).toEqual({ startedAt: '2026-09-27T02:45:00.000Z', finishedAt: '2026-09-27T02:45:40.000Z', status: 'ok', error: null });
  });
});

describe('dayLines', () => {
  it('(1-C2b ②) 주문 줄에 할인 금액을 싣는다', async () => {
    let sql = '';
    const db: Db = {
      async query(q: string) {
        sql = q;
        return { rows: [{
          id: '1', external_order_id: '9001', external_line_id: '9001:95373359497', ordered_at: new Date('2026-09-27T01:00:00Z'),
          paid_at: new Date('2026-09-27T01:00:30Z'), status: 'paid', raw_status: 'ACCEPT', product_label: '쿨매트', order_qty: 2, sku_qty: 2,
          amount: 28200, discount_amount: 840, discount_known: true, attribution: 'mapped', unattributed_reason: null, deduction_state: 'posted', deduction_note: null, sku_labels: '쿨매트 ×2',
        }], rowCount: 1 };
      },
    };
    const r = await dayLines(db, 'coupang_rg', '2026-09-27');
    expect(r[0]).toMatchObject({ id: 1, amount: 28200, discountAmount: 840, discountKnown: true });
    // (리뷰) 「확인 전」과 「0원」을 가른다
    expect(sql).toContain('(l.discount_checked_at is not null) as discount_known');
  });
});
