-- 108_pg_cron_stock_sync.sql
-- 품절 동기화 스케줄을 GitHub Actions에서 DB 안의 pg_cron으로 옮긴다.
-- GitHub 예약은 0 */3 * * * 인데 실제 5~6시간 간격이었다(2026-09-25, 최근 16회).
-- URL·비밀값은 Vault(app_url, cron_secret)에서 읽는다 — scripts/ops/set-cron-secrets.mjs로 먼저 넣는다.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('stock-sync') where exists (select 1 from cron.job where jobname = 'stock-sync');

select cron.schedule(
  'stock-sync',
  '0 */3 * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/stock-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $job$
);
