-- Render DB(SOURCING_DATABASE_URL)에 직접 적용됨. 아래 SQL은 참고용.
-- product_sourcing 테이블에 코스트코 재고 상태 컬럼 추가

ALTER TABLE product_sourcing
  ADD COLUMN IF NOT EXISTS costco_stock_status TEXT
    CHECK (costco_stock_status IN ('inStock', 'outOfStock', 'lowStock')),
  ADD COLUMN IF NOT EXISTS costco_stock_checked_at TIMESTAMPTZ;
