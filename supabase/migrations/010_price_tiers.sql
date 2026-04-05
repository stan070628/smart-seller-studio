-- 010_price_tiers.sql
-- 도매꾹 API의 수량별 가격 티어를 저장하는 테이블
-- 예: "1+11750|10+10580|100+9400" → 3개 행

CREATE TABLE IF NOT EXISTS public.price_tiers (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid    NOT NULL REFERENCES public.sourcing_items(id) ON DELETE CASCADE,
  price_type text    NOT NULL DEFAULT 'dome',  -- 'dome' | 'supply' | 'resale'
  min_qty    integer NOT NULL,                 -- 최소 주문 수량
  unit_price integer NOT NULL,                 -- 해당 수량 기준 단가 (원)
  UNIQUE (item_id, price_type, min_qty)
);

CREATE INDEX IF NOT EXISTS idx_price_tiers_item_id
  ON public.price_tiers (item_id);

COMMENT ON TABLE  public.price_tiers IS '수량별 가격 티어 (도매꾹 API "qty+price|qty+price" 파싱 결과)';
COMMENT ON COLUMN public.price_tiers.price_type IS '가격 유형: dome=도매가, supply=공급가, resale=추천판매가';
COMMENT ON COLUMN public.price_tiers.min_qty    IS '이 단가가 적용되는 최소 주문 수량';
COMMENT ON COLUMN public.price_tiers.unit_price  IS '단가 (원)';
