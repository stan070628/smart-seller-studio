-- 112_erp_origin_default_manual.sql
-- 111이 기존 행을 draft로 채우려고 기본값을 'draft'로 두었다. 그대로 두면 앞으로 origin을 빠뜨린 insert가
-- draft가 되어 다음 sku-apply --apply에 보관·비활성화·삭제된다. 새 행의 기본값은 manual로 두고,
-- sku-apply만 draft를 명시한다 — 실수의 결과가 「적재가 그 행을 무시한다」가 되게.
alter table erp.skus             alter column origin set default 'manual';
alter table erp.channel_listings alter column origin set default 'manual';
alter table erp.listing_skus     alter column origin set default 'manual';
