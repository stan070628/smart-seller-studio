-- 111_erp_origin.sql
-- ERP 1-B 선행(P2): 행 출처. 'draft' = sku-apply가 초안에서 적재한 행, 'manual' = 1-B 이후 화면·스크립트가 만든 행.
-- sku-apply는 「초안이 전부」라 가정하고 초안에 없는 행을 보관·비활성화·삭제한다 — 그 범위를 draft로 한정한다.
alter table erp.skus
  add column if not exists origin text not null default 'draft' check (origin in ('draft', 'manual'));
alter table erp.channel_listings
  add column if not exists origin text not null default 'draft' check (origin in ('draft', 'manual'));
alter table erp.listing_skus
  add column if not exists origin text not null default 'draft' check (origin in ('draft', 'manual'));
