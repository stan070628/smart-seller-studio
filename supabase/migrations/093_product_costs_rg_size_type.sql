-- 093_product_costs_rg_size_type.sql
-- 로켓그로스 사이즈 유형을 상품 속성으로 저장한다.
--
-- 배경: 로켓그로스 물류비(입출고비+배송비)는 사이즈 유형별 정액이며,
--      사이즈는 입고 건이 아니라 상품의 속성이다. 매 입고마다 입력하는 대신
--      상품에 한 번 지정하면 마진 계산에서 자동으로 반영된다.
--
-- 우선순위: cost_entries.unit_rg_shipping_fee(실측 정산액) > rg_size_type 기본 요율
--
-- 요율 상수는 src/lib/roi/rg-fees.ts 에 정의되어 있다.
-- 신규 판매자 90일 무료 프로모션은 2026-07-31 종료되었고,
-- 종료 시점 기준 이미 입고된 재고에도 판매 시점에 부과된다.

ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS rg_size_type text;

ALTER TABLE product_costs
  DROP CONSTRAINT IF EXISTS product_costs_rg_size_type_check;

ALTER TABLE product_costs
  ADD CONSTRAINT product_costs_rg_size_type_check
  CHECK (rg_size_type IS NULL OR rg_size_type IN (
    'extra_small', 'small', 'medium', 'large1', 'large2', 'extra_large'
  ));

COMMENT ON COLUMN product_costs.rg_size_type IS
  '로켓그로스 사이즈 유형. 극소형=extra_small, 소형=small, 중형=medium, 대형1=large1, 대형2=large2, 특대형=extra_large. 물류센터 입고 시 실측값 기준. 판매자센터 > 상품별 사이즈 리포트에서 확인.';
