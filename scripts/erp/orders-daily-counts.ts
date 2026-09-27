// scripts/erp/orders-daily-counts.ts
// 사용법: npx --no-install tsx scripts/erp/orders-daily-counts.ts [--from=YYYY-MM-DD]
// 게이트 ①(1-C2a): KST 날짜 × 채널 주문 수·라인 수·수량·취소·미귀속. 사용자가 채널 관리자 화면(주문일 기준)과 대조한다.
// 읽기 전용(BEGIN READ ONLY). 구매자 정보는 표에 없다.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { dailyCounts } from '@/lib/erp/orders/queries';
import { CHANNEL_LABEL } from '@/lib/erp/orders/types';

loadEnvLocal();

(async () => {
  const from = process.argv.find((a) => a.startsWith('--from='))?.slice('--from='.length) ?? '2026-09-26';
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const rows = await dailyCounts(c, from);
    console.log('날짜(KST 주문일) | 채널 | 주문 | 라인 | 수량 | 취소·반품 | 미귀속');
    for (const r of rows) {
      console.log(`${r.day} | ${CHANNEL_LABEL[r.channel] ?? r.channel} | ${r.orders} | ${r.lines} | ${r.qty} | ${r.canceled} | ${r.unattributed}`);
    }
    const run = (await c.query(`select started_at, status, counts, error from erp.job_runs where job = 'orders-sync' order by started_at desc limit 1`)).rows[0];
    console.log(run ? `마지막 수집: ${new Date(run.started_at).toISOString()} · ${run.status}${run.error ? ` · ${run.error}` : ''}` : '수집 기록 없음');
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
})();
