CREATE TABLE IF NOT EXISTS review_milestones (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('coupang', 'naver')),
  review_count INT NOT NULL,
  reached_50 BOOLEAN NOT NULL DEFAULT false,
  reached_100 BOOLEAN NOT NULL DEFAULT false,
  reached_50_at TIMESTAMPTZ,
  reached_100_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sku_code, channel)
);

CREATE INDEX IF NOT EXISTS idx_review_milestones_50
  ON review_milestones (reached_50_at DESC) WHERE reached_50 = true;
CREATE INDEX IF NOT EXISTS idx_review_milestones_100
  ON review_milestones (reached_100_at DESC) WHERE reached_100 = true;

COMMENT ON TABLE review_milestones IS '리뷰 50/100 도달 트래킹. spec §2.E 기능 11';
