-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Sourcing Margin Fields Migration
-- 파일: supabase/migrations/006_sourcing_margin_fields.sql
--
-- sourcing_items 테이블에 마진율 계산에 필요한 필드 추가:
--   moq                    — 최소주문수량 (Minimum Order Quantity)
--   unit_qty               — 묶음수량
--   price_dome             — 도매가 (sourcing_items 레벨의 기준가)
--   price_resale_recommend — 추천판매가 (도매꾹 getItemView에서 제공)
--   deli_who               — 배송비 부담 (S=무료, P=선결제, B=착불, C=구매자선택)
--   deli_fee               — 배송비 (원)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS moq                    integer,
  ADD COLUMN IF NOT EXISTS unit_qty               integer,
  ADD COLUMN IF NOT EXISTS price_dome             integer,
  ADD COLUMN IF NOT EXISTS price_resale_recommend integer,
  ADD COLUMN IF NOT EXISTS deli_who               text,
  ADD COLUMN IF NOT EXISTS deli_fee               integer;

-- 코멘트
COMMENT ON COLUMN public.sourcing_items.moq                    IS '최소주문수량 (qty.domeMoq from getItemView)';
COMMENT ON COLUMN public.sourcing_items.unit_qty               IS '묶음수량 (unitQty from getItemList)';
COMMENT ON COLUMN public.sourcing_items.price_dome             IS '도매가 기준값 (price.dome from getItemView로 갱신)';
COMMENT ON COLUMN public.sourcing_items.price_resale_recommend IS '추천판매가 (price.resale.Recommand from getItemView)';
COMMENT ON COLUMN public.sourcing_items.deli_who               IS '배송비 부담: S=무료, P=선결제, B=착불, C=구매자선택';
COMMENT ON COLUMN public.sourcing_items.deli_fee               IS '배송비 (원)';
