-- 123_erp_rg_recon.sql
-- ERP 1-C2b ④. 매일 RG 대조(/api/cron/rg-reconcile)의 기록. 「감소가 2회 연속」 판정과 화면의 「마지막 자동 대조」가 이 표를 읽는다.
--   run_id        한 번의 실행(같은 run_id = 같은 시각)
--   sku_id/vid    SKU 줄이면 sku_id, 연결 안 된 RG 번호 줄이면 vid(sku_id null)
--   planned_move  입고중 → RG로 옮길 수량(판정) · moved = 실제로 옮긴 수량(자동 이동이 켜져 있을 때만)
--   alert         사람이 볼 것(보낸 기록 없는 증가 · 2회 연속 감소 · 입고중 7일 초과 · 연결 안 된 번호)
create table if not exists erp.rg_recon_snapshots (
  id            bigserial   primary key,
  run_id        uuid        not null,
  run_at        timestamptz not null default now(),
  sku_id        bigint      references erp.skus(id),
  vid           text,
  ledger        integer     not null default 0,
  actual        integer     not null default 0,
  inbound       integer     not null default 0,
  planned_move  integer     not null default 0 check (planned_move >= 0),
  moved         integer     not null default 0 check (moved >= 0),
  alert         text,
  check ((sku_id is null) <> (vid is null))
);
create index if not exists rg_recon_snapshots_sku_idx on erp.rg_recon_snapshots (sku_id, run_at desc);
create index if not exists rg_recon_snapshots_run_idx on erp.rg_recon_snapshots (run_at desc);

-- 자동 이동 스위치(기본 꺼짐) — 꺼져 있으면 「옮길 예정」만 기록·보고한다. 사용자 승인 후 SQL로 켠다(D6)
insert into erp.settings (name, value) values ('rg_auto_arrive_enabled', '{"enabled": false}'::jsonb) on conflict (name) do nothing;
