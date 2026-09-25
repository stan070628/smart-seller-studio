-- 107_erp_job_runs.sql
-- ERP 재구성 0단계: 모든 예약 작업의 실행 기록.
-- 스케줄러가 실제로 제시각에 도는지(GitHub Actions는 5~6시간 간격으로 밀렸다)를 이 표로 잰다.
create schema if not exists erp;

create table if not exists erp.job_runs (
  id           bigserial primary key,
  job          text        not null,               -- 예: 'stock-sync'
  trigger      text        not null default 'cron', -- 'cron' | 'manual'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text        not null default 'running'
               check (status in ('running', 'ok', 'failed')),
  counts       jsonb       not null default '{}'::jsonb,
  error        text                                  -- mask.ts를 거친 값만 넣는다
);

create index if not exists job_runs_job_started_idx on erp.job_runs (job, started_at desc);

alter table erp.job_runs enable row level security;  -- 서버는 service role/직접 접속만 쓴다
