-- 124_pg_cron_rg_reconcile.sql
-- ERP 1-C2b ④. 매일 09:37 KST(00:37 UTC — 15분 주문 수집(:30)과 겹치지 않게) RG 대조(pg_cron → /api/cron/rg-reconcile). 118과 같은 방식 — URL·비밀값은 Vault.
-- 🔴 운영 앱에 /api/cron/rg-reconcile이 배포된 뒤 적용한다(먼저 걸면 404만 쌓인다). 차감이 꺼져 있으면 라우트가 건너뛴다.
-- :37은 orders-sync(*/15 — :30·:45)와 겹치지 않게 고른 시각이다. :30 수집이 길어져 RG 임대가 아직 busy면 실행기(rg-auto-run.ts)가 30초 간격으로 4번까지 다시 수집한다.
do $$ begin
  if (select count(*) from vault.decrypted_secrets
      where name in ('app_url','cron_secret') and coalesce(decrypted_secret,'') <> '') <> 2 then
    raise exception 'vault 비밀값(app_url, cron_secret)이 없다';
  end if;
end $$;

select cron.unschedule('rg-reconcile') where exists (select 1 from cron.job where jobname = 'rg-reconcile');

select cron.schedule(
  'rg-reconcile',
  '37 0 * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/rg-reconcile',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $job$
);
