// src/__tests__/lib/jobs/run-log.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockSend } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockSend: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: () => ({ query: mockQuery }) }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: mockSend }));

import { withJobRun } from '@/lib/jobs/run-log';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JOB_ALERT_TELEGRAM_CHAT_ID', 'chat-1');
  mockQuery.mockImplementation(async (sql: string) =>
    sql.startsWith('insert') ? { rows: [{ id: 42 }] } : { rows: [] },
  );
  mockSend.mockResolvedValue(undefined);
});

describe('withJobRun', () => {
  it('성공하면 running 행을 만들고 ok와 counts로 닫는다', async () => {
    const result = await withJobRun('stock-sync', async () => ({ value: 'done', counts: { changes: 2 } }));

    expect(result).toBe('done');
    expect(mockQuery.mock.calls[0][0]).toMatch(/^insert into erp\.job_runs/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['stock-sync', 'cron']);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/^update erp\.job_runs/);
    expect(params).toEqual([42, 'ok', JSON.stringify({ changes: 2 }), null]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('실패하면 마스킹한 오류로 failed를 남기고 텔레그램을 보낸 뒤 다시 던진다', async () => {
    await expect(
      withJobRun('stock-sync', async () => { throw new Error('수취인 010-1234-5678 조회 실패'); }),
    ).rejects.toThrow('조회 실패');

    const params = mockQuery.mock.calls[1][1];
    expect(params[1]).toBe('failed');
    expect(params[3]).toBe('수취인 010-****-5678 조회 실패');
    expect(mockSend).toHaveBeenCalledWith('chat-1', '🔴 작업 실패 [stock-sync]: 수취인 010-****-5678 조회 실패');
  });

  it('trigger를 넘기면 그대로 기록한다', async () => {
    await withJobRun('stock-sync', async () => ({ value: 1, counts: {} }), { trigger: 'manual' });
    expect(mockQuery.mock.calls[0][1]).toEqual(['stock-sync', 'manual']);
  });

  it('기록 DB가 실패해도 작업 결과는 돌려준다', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const result = await withJobRun('stock-sync', async () => ({ value: 'still', counts: {} }));
    expect(result).toBe('still');
  });

  it('텔레그램 전송이 실패해도 원래 오류를 던진다', async () => {
    mockSend.mockRejectedValueOnce(new Error('TELEGRAM_BOT_TOKEN 없음'));
    await expect(
      withJobRun('stock-sync', async () => { throw new Error('원래 오류'); }),
    ).rejects.toThrow('원래 오류');
    expect(mockQuery.mock.calls[1][1][1]).toBe('failed');
  });
});
