CREATE TABLE IF NOT EXISTS inbound_returns (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  seller_name TEXT,
  reason TEXT NOT NULL CHECK (reason IN
    ('packaging', 'size', 'barcode', 'damage', 'mismatch', 'other')),
  return_cost_krw INT,
  detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_returns_sku
  ON inbound_returns (sku_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_seller
  ON inbound_returns (seller_name, occurred_at DESC) WHERE seller_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS cs_inquiries (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  channel TEXT NOT NULL CHECK (channel IN ('coupang', 'naver')),
  sku_code TEXT,
  question_text TEXT NOT NULL,
  category TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cs_user_recent
  ON cs_inquiries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_distribution (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  recorded_date DATE NOT NULL,
  coupang_grocery_krw INT NOT NULL DEFAULT 0,
  coupang_general_krw INT NOT NULL DEFAULT 0,
  naver_krw INT NOT NULL DEFAULT 0,
  total_krw INT GENERATED ALWAYS AS
    (coupang_grocery_krw + coupang_general_krw + naver_krw) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_channel_dist_recent
  ON channel_distribution (user_id, recorded_date DESC);

COMMENT ON TABLE inbound_returns IS '회송 사례 누적. spec §2.D 기능 8';
COMMENT ON TABLE cs_inquiries IS 'CS 문의 누적. spec §2.D 기능 9';
COMMENT ON TABLE channel_distribution IS '채널별 일일 매출 분배. spec §2.D 기능 10';
