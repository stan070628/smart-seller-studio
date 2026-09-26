-- 117_erp_orders.sql
-- ERP 1-C2a. 채널 주문 수집(쿠팡 판매자배송·쿠팡 RG·네이버·토스)과 판매 차감 상태.
-- 🔴 구매자 개인정보(이름·전화·주소·이메일·배송메모)는 두지 않는다 — 어댑터가 버린다. 송장은 로지아이, 재고·매출에는 필요 없다.
--
-- erp.orders       주문 한 건(채널 · 외부 주문번호). status는 라인 상태가 모두 같으면 그 값, 섞이면 'mixed'
-- erp.order_lines  채널의 주문 품목 한 줄(외부 라인 키로 유일). 수집할 때마다 upsert — 원래 상태 문자열(raw_status)을 남긴다
--   alloc      리스팅 → SKU 연결 결과 [{skuId, qty}](qty = 주문 수량 × 배수, SKU 오름차순). 미귀속이면 []
--   sku_id     alloc이 SKU 하나일 때만(조회 편의). bundle 라인은 null
--   posted     실제로 원장에서 뺀 것 [{skuId, qty, idemKey}]. 역전표를 쓰면 []로 돌아간다
--   ledger_version  지금까지 차감한 횟수. 멱등키 sale:<channel>:<라인키>:s<skuId>, 두 번째부터 @n
--   deduction_state pending(켜지면 뺀다) · posted · skipped_short(재고 부족 — 다음 수집에서 다시) · reversed(취소·반품으로 되돌림) · none(대상 아님)
--   legacy_*   옛 장부(sale_records) 연결: 키(채널별 통일) · 고른 product_cost · 수량 · 행 id
-- erp.settings     이름 하나 = 행 하나. deduct_enabled = {"enabled": bool, "enabledAt"?, "by"?}
-- 채널 수집 커서는 erp.sync_cursors의 'orders:<channel>' 행(수집기가 처음 성공할 때 만든다).

create table if not exists erp.orders (
  id                 bigserial   primary key,
  channel            text        not null check (channel in ('coupang_wing', 'coupang_rg', 'naver', 'toss')),
  external_order_id  text        not null,
  ordered_at         timestamptz not null,
  paid_at            timestamptz,
  status             text        not null check (status in (
                       'unpaid', 'paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'canceled',
                       'return_requested', 'returned', 'exchange', 'unknown', 'mixed')),
  raw_status         text        not null,
  first_seen_at      timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (channel, external_order_id)
);

create table if not exists erp.order_lines (
  id                      bigserial   primary key,
  order_id                bigint      not null references erp.orders(id),
  channel                 text        not null check (channel in ('coupang_wing', 'coupang_rg', 'naver', 'toss')),
  external_line_id        text        not null check (external_line_id ~ '^[0-9A-Za-z_-]+(:[0-9A-Za-z_-]+)*$'),
  listing_id              bigint      references erp.channel_listings(id),
  sku_id                  bigint      references erp.skus(id),
  alloc                   jsonb       not null default '[]'::jsonb,
  attribution             text        not null check (attribution in ('mapped', 'unattributed')),
  unattributed_reason     text        check (unattributed_reason in ('no_listing', 'any_of', 'option_unmatched', 'no_sku_link')),
  order_qty               integer     not null check (order_qty > 0),
  sku_qty                 integer     not null default 0 check (sku_qty >= 0),
  unit_price              integer     not null default 0,
  amount                  integer     not null default 0,
  status                  text        not null check (status in (
                            'unpaid', 'paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'canceled',
                            'return_requested', 'returned', 'exchange', 'unknown')),
  raw_status              text        not null,
  ordered_at              timestamptz not null,
  paid_at                 timestamptz,
  product_id              text        not null default '',
  option_key              text        not null default '',
  alt_product_id          text,
  product_label           text        not null default '',
  deduction_state         text        not null default 'none'
                            check (deduction_state in ('pending', 'posted', 'skipped_short', 'reversed', 'none')),
  deduction_note          text,
  ledger_version          integer     not null default 0 check (ledger_version >= 0),
  posted                  jsonb       not null default '[]'::jsonb,
  deducted_at             timestamptz,
  legacy_key              text,
  legacy_product_cost_id  uuid,
  legacy_qty              integer,
  legacy_sale_id          uuid,
  first_seen_at           timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (channel, external_line_id),
  constraint order_lines_alloc_chk check (jsonb_typeof(alloc) = 'array' and jsonb_typeof(posted) = 'array'),
  constraint order_lines_attribution_chk check ((attribution = 'mapped') = (jsonb_array_length(alloc) > 0)),
  constraint order_lines_reason_chk check ((attribution = 'unattributed') = (unattributed_reason is not null)),
  constraint order_lines_posted_chk check ((deduction_state = 'posted') = (jsonb_array_length(posted) > 0)),
  constraint order_lines_single_sku_chk check (sku_id is null or jsonb_array_length(alloc) = 1)
);

create index if not exists order_lines_order_idx on erp.order_lines (order_id);
create index if not exists order_lines_channel_ordered_idx on erp.order_lines (channel, ordered_at desc);
create index if not exists order_lines_channel_paid_idx on erp.order_lines (channel, paid_at);
create index if not exists order_lines_open_idx on erp.order_lines (deduction_state) where deduction_state in ('pending', 'skipped_short');
create index if not exists order_lines_sku_idx on erp.order_lines (sku_id);
create index if not exists order_lines_legacy_key_idx on erp.order_lines (legacy_key);

create table if not exists erp.settings (
  name        text        primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

insert into erp.settings (name, value) values ('deduct_enabled', '{"enabled": false}'::jsonb)
on conflict (name) do nothing;

alter table erp.orders      enable row level security;
alter table erp.order_lines enable row level security;
alter table erp.settings    enable row level security;

comment on table erp.order_lines is '채널 주문 품목. 구매자 개인정보 없음. 1-C2a';
comment on column erp.order_lines.alloc is '[{skuId, qty}] — 리스팅 연결 결과. qty = 주문 수량 × listing_skus.multiplier';
comment on column erp.order_lines.posted is '[{skuId, qty, idemKey}] — 원장에서 실제로 뺀 것';
