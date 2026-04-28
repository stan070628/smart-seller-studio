CREATE TABLE IF NOT EXISTS sourcing_recommendations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN
    ('buy_strong', 'buy', 'hold', 'wholesale_only', 'insufficient_data')),
  wholesale_margin_per_unit_krw INT,
  buy_margin_per_unit_krw INT,
  monthly_diff_krw INT,
  payback_months REAL,
  reason TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_rec_sku
  ON sourcing_recommendations (sku_code, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_rec_strong
  ON sourcing_recommendations (generated_at DESC) WHERE recommendation = 'buy_strong';

CREATE TABLE IF NOT EXISTS negotiation_logs (
  id BIGSERIAL PRIMARY KEY,
  sku_code TEXT NOT NULL,
  seller_name TEXT,
  initial_price_rmb REAL,
  final_price_rmb REAL,
  discount_pct REAL,
  notes TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sourcing_recommendations IS '위탁 vs 사입 자동 추천 배치 결과. spec §2.C 기능 6';
COMMENT ON TABLE negotiation_logs IS '1688 가격 협상 이력. spec §2.C 기능 7';
