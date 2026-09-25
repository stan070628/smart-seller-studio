// src/lib/jobs/run-log.ts
import { getSourcingPool } from '@/lib/sourcing/db';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { maskPII } from './mask';

export interface JobOutcome<T> {
  value: T;
  counts: Record<string, number>;
}

/**
 * 예약 작업 한 번을 erp.job_runs에 남긴다.
 *
 * 스케줄러가 제시각에 도는지, 무엇이 실패했는지를 한 표에서 보려고 만들었다.
 * 기록 자체가 실패해도 작업은 막지 않는다 — 로그 때문에 품절 동기화가 멈추면 주객전도다.
 */
export async function withJobRun<T>(
  job: string,
  fn: () => Promise<JobOutcome<T>>,
  opts: { trigger?: 'cron' | 'manual' } = {},
): Promise<T> {
  const pool = getSourcingPool();
  let runId: number | null = null;
  try {
    const { rows } = await pool.query(
      'insert into erp.job_runs (job, trigger) values ($1, $2) returning id',
      [job, opts.trigger ?? 'cron'],
    );
    runId = rows[0]?.id ?? null;
  } catch (e) {
    console.error('[job_runs] 시작 기록 실패:', e);
  }

  const finish = async (status: 'ok' | 'failed', counts: Record<string, number>, error: string | null) => {
    if (runId === null) return;
    try {
      await pool.query(
        'update erp.job_runs set finished_at = now(), status = $2, counts = $3::jsonb, error = $4 where id = $1',
        [runId, status, JSON.stringify(counts), error],
      );
    } catch (e) {
      console.error('[job_runs] 종료 기록 실패:', e);
    }
  };

  try {
    const { value, counts } = await fn();
    await finish('ok', counts, null);
    return value;
  } catch (e: unknown) {
    const msg = maskPII(e instanceof Error ? e.message : String(e));
    await finish('failed', {}, msg);
    const chatId = process.env.JOB_ALERT_TELEGRAM_CHAT_ID ?? '';
    if (chatId) await sendTelegramMessage(chatId, `🔴 작업 실패 [${job}]: ${msg}`);
    throw e;
  }
}
