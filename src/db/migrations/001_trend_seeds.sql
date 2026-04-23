CREATE TABLE IF NOT EXISTS trend_seeds (
  id SERIAL PRIMARY KEY,
  seed_date DATE NOT NULL,
  keyword TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(seed_date, keyword)
);

CREATE INDEX IF NOT EXISTS idx_trend_seeds_date ON trend_seeds(seed_date DESC);
