-- 광고 전략 수집/분석 캐시 (단일 계정, 24h TTL)

create table if not exists ad_strategy_cache (
  id             bigint generated always as identity primary key,
  user_id        text         not null default 'cheong-yeon',
  collected_data jsonb,
  report_json    jsonb,
  collected_at   timestamptz  not null default now(),
  created_at     timestamptz  not null default now()
);

create index if not exists idx_ad_strategy_cache_collected_at
  on ad_strategy_cache (collected_at desc);

comment on table ad_strategy_cache is
  '광고 전략 수집/분석 캐시 (단일 계정, 24h TTL)';
