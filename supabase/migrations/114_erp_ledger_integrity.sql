-- 114_erp_ledger_integrity.sql
-- ERP 1-B: 113 원장 리뷰 반영. 적용 시점에 erp.stock_ledger는 비어 있다(2026-09-26).
--
-- 1) 음수 검사 트리거의 동시성 — 113의 검사는 store.ts의 SKU 잠금에 기대고 있었다. store.ts를 거치지 않은 쓰기
--    (수동 SQL·다른 스크립트) 두 개가 같은 lot을 동시에 차감하면, 둘 다 커밋 시점에 상대의 미커밋 행을 못 보고 통과한다.
--    그래서 차감 행의 검사가 store.ts와 같은 advisory lock을 잡고 합계를 센다 — 커밋이 SKU 단위로 줄을 서고,
--    READ COMMITTED에서는 잠금 뒤의 조회가 새 스냅샷이라 먼저 커밋된 차감이 보인다.
--    REPEATABLE READ는 트랜잭션 첫 스냅샷을 계속 쓰므로 잠금을 잡아도 먼저 커밋된 차감이 안 보인다 — 거부한다.
-- 2) 부호 — 113은 kind별 부호를 검사하지 않아 양수 'sale'(재고가 늘어나는 판매)이 들어갈 수 있었다.
-- 3) 역전표 대칭 — 113은 reverses_id만 요구해 원 전표와 다른 SKU·위치·수량·lot으로 「상쇄」할 수 있었다.
--    역전표는 원 전표의 정확한 거울이어야 한다(lot 생성 전표를 되돌리면 그 전표 자신을 lot으로 가리킨다).

create or replace function erp.stock_ledger_balance() returns trigger language plpgsql as $$
declare
  bal bigint;
begin
  if new.qty < 0 then
    if current_setting('transaction_isolation') = 'repeatable read' then
      raise exception 'erp.stock_ledger 차감은 READ COMMITTED(또는 SERIALIZABLE)에서만 한다';
    end if;
    -- store.ts의 lockSku와 같은 키. store.ts를 거치지 않은 쓰기도 커밋 시점에 SKU 단위로 줄을 세운다.
    -- READ COMMITTED에서는 잠금 뒤의 조회가 새 스냅샷을 쓰므로 먼저 커밋된 차감이 보인다.
    perform pg_advisory_xact_lock(7101, new.sku_id::int);
  end if;
  select coalesce(sum(qty), 0) into bal from erp.stock_ledger
   where sku_id = new.sku_id and location = new.location and coalesce(lot_id, id) = coalesce(new.lot_id, new.id);
  if bal < 0 then
    raise exception 'SKU % · % · lot %의 재고가 음수가 된다 (%)', new.sku_id, new.location, coalesce(new.lot_id, new.id), bal;
  end if;
  return null;
end $$;

alter table erp.stock_ledger drop constraint if exists stock_ledger_sign_chk;
alter table erp.stock_ledger add constraint stock_ledger_sign_chk check (
  (kind = 'sale' and qty < 0) or (kind = 'return' and qty > 0) or kind in ('opening', 'receipt', 'transfer', 'adjust', 'reversal')
);

create or replace function erp.stock_ledger_guard() returns trigger language plpgsql as $$
declare
  lot_row erp.stock_ledger%rowtype;
  orig    erp.stock_ledger%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'erp.stock_ledger는 고치거나 지우지 않는다 — 역전표로 상쇄한다 (%)', tg_op;
  end if;
  if new.lot_id is not null then
    select * into lot_row from erp.stock_ledger where id = new.lot_id;
    if lot_row.id is null or lot_row.lot_id is not null or lot_row.sku_id <> new.sku_id then
      raise exception 'lot_id %는 같은 SKU의 lot 생성 전표가 아니다', new.lot_id;
    end if;
  end if;
  if new.reverses_id is not null then
    select * into orig from erp.stock_ledger where id = new.reverses_id;
    if orig.id is null
       or orig.kind = 'reversal'
       or orig.sku_id <> new.sku_id
       or orig.location <> new.location
       or orig.qty <> -new.qty
       or new.lot_id is distinct from coalesce(orig.lot_id, orig.id) then
      raise exception '역전표 %는 원 전표 %를 정확히 상쇄하지 않는다', new.idem_key, new.reverses_id;
    end if;
  end if;
  return new;
end $$;
