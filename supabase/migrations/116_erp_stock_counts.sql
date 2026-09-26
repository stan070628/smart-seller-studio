-- 116_erp_stock_counts.sql
-- ERP 1-C1 추가(2026-09-26 결정 5). 「센 기록」 — 사람이 실제로 센 개수를 차이가 없어도 남긴다.
-- 원장(stock_ledger)은 재고가 바뀔 때만 전표를 쓰므로 「세어 봤더니 맞았다」가 남지 않는다 → 오늘 셀 목록(순환 실사)이
-- 마지막 실사 시각을 알 수 없다. 원장 전표는 여전히 차이가 있을 때만 쓴다.
--   ledger_qty          = 센 시점(SKU 잠금 안)의 그 위치 원장 재고
--   adjustment_idem_key = 그때 쓴 조정·기초 전표의 원 멱등키(adj:<uuid> · opening:<sku>:<위치>). 차이 0이면 null.
--                         차감 전표의 행 키는 뒤에 #순번이 붙어 이 값과 같지 않으므로 FK를 걸지 않는다
--   request_id          = 화면 요청 id(조정의 requestId). unique — 같은 요청의 재전송이 두 줄을 만들지 않는다.
--                         실사표 불러오기는 서버가 줄마다 새로 만든다
--   counted_at          = 센 시각(화면 조정 = 기록 시각, 실사표 = 실사를 마친 시각)
-- 고치거나 지우는 경로는 없다(앱은 insert만 한다). 조정을 되돌려도 「그때 그렇게 셌다」는 남는다.

create table if not exists erp.stock_counts (
  id                   bigserial   primary key,
  sku_id               bigint      not null references erp.skus(id),
  location             text        not null check (location in ('self', 'rg_inbound', 'rg')),
  counted_qty          integer     not null check (counted_qty >= 0),
  ledger_qty           integer     not null check (ledger_qty >= 0),
  adjustment_idem_key  text,
  counted_at           timestamptz not null default now(),
  request_id           uuid        not null,
  created_at           timestamptz not null default now(),
  constraint stock_counts_request_id_key unique (request_id)
);

-- 「SKU별 집 마지막 실사」(재고 목록·오늘 셀 목록)를 읽는 순서
create index if not exists stock_counts_last_idx on erp.stock_counts (sku_id, location, counted_at desc);

alter table erp.stock_counts enable row level security;
