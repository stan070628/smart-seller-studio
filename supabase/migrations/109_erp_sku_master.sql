-- 109_erp_sku_master.sql
-- ERP 1-A: 상품마스터. 실물 옵션 1개 = SKU 1개. 기존 product_costs 등은 건드리지 않는다(병행 추가).
-- 채널 리스팅(쿠팡 Wing·RG vendorItemId, 네이버 origin+옵션, 토스 상품+옵션)은 listing_skus로 SKU × 배수에 연결한다.

create table if not exists erp.skus (
  id                       bigserial primary key,
  key                      text        not null unique,          -- 예: 'cp:16202992314:블랙' (초안 생성기가 만든다)
  name                     text        not null,                 -- 상품명
  option_label             text        not null default '',      -- 수량을 뗀 옵션 표시(색상·사이즈)
  base_unit_label          text,                                 -- 배수 1이 뜻하는 단위(예: '6팩', '낱포 1개')
  kind                     text        not null default 'single' check (kind in ('single', 'set', 'component')),
  safety_stock             integer     not null default 0 check (safety_stock >= 0),
  barcode                  text,
  status                   text        not null default 'active' check (status in ('active', 'archived')),
  legacy_product_cost_ids  uuid[]      not null default '{}',    -- 옛 product_costs 역참조(원가·입고 이력 연결용)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists erp.sku_components (
  set_sku_id        bigint  not null references erp.skus(id) on delete cascade,
  component_sku_id  bigint  not null references erp.skus(id),
  quantity          integer not null check (quantity > 0),
  primary key (set_sku_id, component_sku_id),
  check (set_sku_id <> component_sku_id)
);

create table if not exists erp.purchase_units (
  id                    bigserial primary key,
  supplier              text    not null default 'costco',
  supplier_code         text    not null,                -- 코스트코 품번 등
  label                 text,
  sku_id                bigint  references erp.skus(id),
  pieces_per_purchase   integer not null default 1 check (pieces_per_purchase > 0),   -- 매입 1단위 안의 낱개 수
  pieces_per_sale_unit  integer not null default 1 check (pieces_per_sale_unit > 0),  -- SKU 배수 1이 소비하는 낱개 수
  unique (supplier, supplier_code)
);

create table if not exists erp.channel_listings (
  id                   bigserial primary key,
  channel              text    not null check (channel in ('coupang_wing', 'coupang_rg', 'naver', 'toss')),
  external_product_id  text    not null,               -- 쿠팡: vendorItemId · 네이버: originProductNo · 토스: productId
  external_option_key  text    not null default '',    -- 네이버: optionCombination id('' = 단일) · 토스: valueName 경로
  alt_product_id       text,                           -- 네이버 channelProductNo · 쿠팡 sellerProductId
  label                text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  unique (channel, external_product_id, external_option_key)
);

create table if not exists erp.listing_skus (
  listing_id  bigint  not null references erp.channel_listings(id) on delete cascade,
  sku_id      bigint  not null references erp.skus(id),
  multiplier  integer not null default 1 check (multiplier > 0),  -- 리스팅 1개 판매가 소비하는 SKU 기준 단위 수
  primary key (listing_id, sku_id)
);

create index if not exists listing_skus_sku_idx on erp.listing_skus (sku_id);

alter table erp.skus             enable row level security;
alter table erp.sku_components   enable row level security;
alter table erp.purchase_units   enable row level security;
alter table erp.channel_listings enable row level security;
alter table erp.listing_skus     enable row level security;
