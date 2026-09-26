-- 118_pg_cron_orders_sync.sql
-- ERP 1-C2a. 주문 수집을 15분마다(pg_cron → /api/cron/orders-sync). 108(stock-sync)과 같은 방식 — URL·비밀값은 Vault(app_url, cron_secret).
-- 🔴 운영 앱에 /api/cron/orders-sync가 배포되고 컨트롤러가 첫 실행을 확인한 뒤에 적용한다(1-C2a 계획 Task 9 Step 5).
--    먼저 걸면 옛 배포에 라우트가 없어 15분마다 404가 나고 erp.job_runs에도 남지 않는다.
do $$ begin
  if (select count(*) from vault.decrypted_secrets
      where name in ('app_url','cron_secret') and coalesce(decrypted_secret,'') <> '') <> 2 then
    raise exception 'vault 비밀값(app_url, cron_secret)이 없다 — scripts/ops/set-cron-secrets.mjs 먼저 실행';
  end if;
end $$;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('orders-sync') where exists (select 1 from cron.job where jobname = 'orders-sync');

select cron.schedule(
  'orders-sync',
  '*/15 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/orders-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $job$
);
