-- 125_erp_rg_returns.sql
-- ERP 1-C2c. RG 취소·반품 복귀 — RG API로는 취소·반품을 알 수 없어(2026-10-05 실측) 매일 RG 대조가
-- 입고중으로 설명되지 않는 증가를 최근 30일 RG 판매량까지 복귀(adjust/rg_return)로 더한다.
-- 1) 원장 사유에 rg_return 추가(115의 목록 + rg_return)
alter table erp.stock_ledger drop constraint if exists stock_ledger_reason_chk;
alter table erp.stock_ledger add constraint stock_ledger_reason_chk check (
  reason is null or reason in ('opening', 'count_diff', 'damage', 'loss', 'sample', 'return_in', 'other', 'rg_reconcile', 'rg_return')
);
-- 2) 대조 기록 — planned_return = 복귀 판정 · returned = 실제 기록(자동 이동이 켜져 있을 때만)
alter table erp.rg_recon_snapshots add column if not exists planned_return integer not null default 0 check (planned_return >= 0);
alter table erp.rg_recon_snapshots add column if not exists returned integer not null default 0 check (returned >= 0);
