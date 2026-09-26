-- 115_erp_ledger_reason_purchase_units.sql
-- ERP 1-C1. 적용 시점에 erp.stock_ledger·erp.purchase_units는 비어 있다(2026-09-26).
--
-- 1) 원장 사유(reason). 사람이 고친 재고(kind='adjust')는 왜 고쳤는지가 남아야 한다 — 필수.
--    opening = 기초재고(서버가 정한다) · rg_reconcile = RG 실재고 대조 반영 · 나머지는 화면에서 고른다.
--    가드 트리거는 행 삽입만 막으므로 칸 추가는 안전하다.
-- 2) purchase_units를 품번 : SKU = 1 : N으로. 코스트코 품번 하나가 옵션(색·사이즈) 여러 SKU로 나뉜다.

alter table erp.stock_ledger add column if not exists reason text;

alter table erp.stock_ledger drop constraint if exists stock_ledger_reason_chk;
alter table erp.stock_ledger add constraint stock_ledger_reason_chk check (
  reason is null or reason in ('opening', 'count_diff', 'damage', 'loss', 'sample', 'return_in', 'other', 'rg_reconcile')
);
alter table erp.stock_ledger drop constraint if exists stock_ledger_adjust_reason_chk;
alter table erp.stock_ledger add constraint stock_ledger_adjust_reason_chk check (kind <> 'adjust' or reason is not null);
alter table erp.stock_ledger drop constraint if exists stock_ledger_opening_reason_chk;
alter table erp.stock_ledger add constraint stock_ledger_opening_reason_chk check (reason <> 'opening' or kind = 'opening');

do $$
declare
  r record;
begin
  if exists (select 1 from erp.purchase_units where sku_id is null) then
    raise exception 'erp.purchase_units에 sku_id 없는 행이 있다 — 1:N 전환 전에 정리한다';
  end if;
  -- (supplier, supplier_code) 유니크를 이름과 무관하게 지운다(109가 이름 없이 만들었다)
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'erp.purchase_units'::regclass and c.contype = 'u'
       and c.conkey = (select array_agg(a.attnum order by a.attnum) from pg_attribute a
                        where a.attrelid = 'erp.purchase_units'::regclass and a.attname in ('supplier', 'supplier_code'))
  loop
    execute format('alter table erp.purchase_units drop constraint %I', r.conname);
  end loop;
end $$;

alter table erp.purchase_units alter column sku_id set not null;
alter table erp.purchase_units drop constraint if exists purchase_units_supplier_code_sku_key;
alter table erp.purchase_units add constraint purchase_units_supplier_code_sku_key unique (supplier, supplier_code, sku_id);
