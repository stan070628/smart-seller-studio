-- 119_erp_orders_lease_absence.sql
-- ERP 1-C2a Task 3·4 리뷰 후속(설계 해석 #24). 118은 pg_cron 일정에 예약돼 있다.
--
-- erp.sync_cursors
--   lease_until · lease_owner  채널 수집 임대(lease). 세션 advisory lock은 Supavisor 트랜잭션 풀러에서 다른 세션에 붙어
--                              풀리지 않거나 엉뚱한 연결이 잡는다 — 행 하나를 autocommit update로 잡고 finally에서 주인일 때만 푼다.
--                              10분이 지나면 다음 실행이 가져간다(쓰기는 트랜잭션 안의 pg_advisory_xact_lock(7102, 채널)이 한 번 더 줄 세운다).
-- erp.order_lines
--   absent_since      응답에서 처음 사라진 시각. 두 번 연속(완전한 수집) 사라져야 취소한다 — 처음엔 이 칸만 적고, 다시 보이면 지운다.
--   status_unmapped   마지막 수집의 채널 상태 문자열이 매핑표에 없었다(status는 이전 값을 지킨다). unknown 재판정·알림은 이 칸으로 센다.
--   legacy_voided_at  수집기가 옛 장부(sale_records) 행을 무효화한 시각. 같은 시각의 무효만 수집기가 되살린다 —
--                     사람·옛 불러오기가 무효화한 행은 건드리지 않는다.

alter table erp.sync_cursors
  add column if not exists lease_until timestamptz,
  add column if not exists lease_owner text;

alter table erp.order_lines
  add column if not exists absent_since     timestamptz,
  add column if not exists status_unmapped  boolean not null default false,
  add column if not exists legacy_voided_at timestamptz;

-- 이미 status='unknown'으로 저장된 라인은 매핑되지 않은 것이다
update erp.order_lines set status_unmapped = true where status = 'unknown' and not status_unmapped;

create index if not exists order_lines_unmapped_idx on erp.order_lines (channel) where status_unmapped;

comment on column erp.sync_cursors.lease_until is '채널 수집 임대 만료 시각(orders:<channel> 행). null = 비어 있음';
comment on column erp.order_lines.absent_since is '응답에서 처음 사라진 시각 — 다음 완전한 수집에서도 없으면 취소';
comment on column erp.order_lines.status_unmapped is '마지막 채널 상태 문자열이 매핑표에 없다(status는 이전 값 유지)';
comment on column erp.order_lines.legacy_voided_at is '수집기가 sale_records를 무효화한 시각 — 이 시각의 무효만 수집기가 되살린다';
