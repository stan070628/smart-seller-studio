-- 077_naver_variants.sql
-- 네이버 옵션 ID 저장 (표시 전용 — 매출 집계와 무관)
-- product_costs 와 동일하게 Render PostgreSQL (SOURCING_DATABASE_URL) 에 적용

ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS naver_origin_product_no BIGINT,
  ADD COLUMN IF NOT EXISTS naver_variants JSONB;

COMMENT ON COLUMN product_costs.naver_origin_product_no IS '네이버 원상품 번호 (channelProductNo → 역조회 캐시)';
COMMENT ON COLUMN product_costs.naver_variants IS '{ optionId: 옵션명 } 매핑 — 표시 전용';
