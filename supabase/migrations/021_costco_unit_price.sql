-- 021_costco_unit_price.sql
-- 코스트코 상품 단위 파싱 결과 및 네이버 단가 비교 컬럼 추가

ALTER TABLE public.costco_products
  ADD COLUMN IF NOT EXISTS unit_type          text CHECK (unit_type IN ('weight', 'volume', 'count')),
  ADD COLUMN IF NOT EXISTS total_quantity     numeric(12,2),
  ADD COLUMN IF NOT EXISTS base_unit          text,
  ADD COLUMN IF NOT EXISTS unit_price         numeric(10,2),
  ADD COLUMN IF NOT EXISTS unit_price_label   text,
  ADD COLUMN IF NOT EXISTS market_unit_price  numeric(10,2),
  ADD COLUMN IF NOT EXISTS market_unit_title  text;

-- 단위 타입별 조회 최적화 (NULL 제외)
CREATE INDEX IF NOT EXISTS idx_costco_products_unit_type
  ON public.costco_products(unit_type) WHERE unit_type IS NOT NULL;

-- 단가 절감율 계산 필터링 최적화 (두 컬럼 모두 있는 행만 인덱싱)
CREATE INDEX IF NOT EXISTS idx_costco_products_unit_saving
  ON public.costco_products(market_unit_price, unit_price)
  WHERE market_unit_price IS NOT NULL AND unit_price IS NOT NULL;
