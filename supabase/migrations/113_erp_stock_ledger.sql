-- 113_erp_stock_ledger.sql
-- ERP 1-B: 재고 원장. 재고는 저장하지 않고 전표 합계로 계산한다.
--
-- lot: 「lot을 만든 전표」(기초·입고·양수 조정, lot_id null)의 id가 곧 lot 번호다.
--      차감·이동·반품·역전표는 lot_id로 그 전표를 가리킨다. lot 단가는 lot을 만든 전표에만 있다.
-- 위치: self(자체보관) · rg_inbound(RG로 보냈으나 아직 판매 가능 수량에 안 잡힘) · rg(RG 판매 가능).
--      RG 입고 API는 없다(2026-09-26 공식 문서 확인) — rg_inbound → rg 이동은 1-C가 RG 재고 증가로 처리한다.
-- 불변: 수정·삭제·truncate 금지(트리거). 틀린 전표는 역전표(kind='reversal')로 상쇄한다.
-- 음수 금지: (SKU·위치·lot) 합계가 음수가 되면 커밋 시점에 실패한다(지연 제약 트리거).

create table if not exists erp.stock_ledger (
  id           bigserial   primary key,
  sku_id       bigint      not null references erp.skus(id),
  location     text        not null check (location in ('self', 'rg_inbound', 'rg')),
  qty          integer     not null check (qty <> 0),
  kind         text        not null check (kind in ('opening', 'receipt', 'transfer', 'sale', 'return', 'adjust', 'reversal')),
  lot_id       bigint      references erp.stock_ledger(id),
  unit_cost    integer     check (unit_cost >= 0),
  occurred_at  timestamptz not null,
  ref_type     text,
  ref_id       text,
  reverses_id  bigint      unique references erp.stock_ledger(id),
  idem_key     text        not null unique,
  note         text,
  created_at   timestamptz not null default now(),
  check ((lot_id is null) = (unit_cost is not null)),
  check (lot_id is not null or (qty > 0 and kind in ('opening', 'receipt', 'adjust'))),
  check ((kind = 'reversal') = (reverses_id is not null))
);

create index if not exists stock_ledger_lot_idx on erp.stock_ledger (sku_id, location, (coalesce(lot_id, id)));
create index if not exists stock_ledger_ref_idx on erp.stock_ledger (ref_type, ref_id);
create index if not exists stock_ledger_idem_prefix_idx on erp.stock_ledger (idem_key text_pattern_ops);

create or replace function erp.stock_ledger_guard() returns trigger language plpgsql as $$
declare
  lot_row erp.stock_ledger%rowtype;
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
  return new;
end $$;

drop trigger if exists stock_ledger_guard on erp.stock_ledger;
create trigger stock_ledger_guard before insert or update or delete on erp.stock_ledger
  for each row execute function erp.stock_ledger_guard();
drop trigger if exists stock_ledger_no_truncate on erp.stock_ledger;
create trigger stock_ledger_no_truncate before truncate on erp.stock_ledger
  for each statement execute function erp.stock_ledger_guard();

create or replace function erp.stock_ledger_balance() returns trigger language plpgsql as $$
declare
  bal bigint;
begin
  select coalesce(sum(qty), 0) into bal from erp.stock_ledger
   where sku_id = new.sku_id and location = new.location and coalesce(lot_id, id) = coalesce(new.lot_id, new.id);
  if bal < 0 then
    raise exception 'SKU % · % · lot %의 재고가 음수가 된다 (%)', new.sku_id, new.location, coalesce(new.lot_id, new.id), bal;
  end if;
  return null;
end $$;

drop trigger if exists stock_ledger_balance on erp.stock_ledger;
create constraint trigger stock_ledger_balance after insert on erp.stock_ledger
  deferrable initially deferred for each row execute function erp.stock_ledger_balance();

create or replace view erp.stock_lots with (security_invoker = true) as
select l.sku_id, l.location, coalesce(l.lot_id, l.id) as lot_id, sum(l.qty)::int as qty, h.unit_cost, h.occurred_at as lot_at
  from erp.stock_ledger l
  join erp.stock_ledger h on h.id = coalesce(l.lot_id, l.id)
 group by l.sku_id, l.location, coalesce(l.lot_id, l.id), h.unit_cost, h.occurred_at
having sum(l.qty) <> 0;

create or replace view erp.stock_on_hand with (security_invoker = true) as
select sku_id, location, sum(qty)::int as qty, sum(qty::bigint * unit_cost)::bigint as value
  from erp.stock_lots
 group by sku_id, location;

-- 채널별·작업별 마지막 처리 시각. 'ledger_cutover' = 기초재고 시각(1-C 수집의 시작점).
create table if not exists erp.sync_cursors (
  name        text        primary key,
  cursor_at   timestamptz not null,
  updated_at  timestamptz not null default now()
);

alter table erp.stock_ledger enable row level security;
alter table erp.sync_cursors enable row level security;
