-- 위너 관리: 점유율 일별 스냅샷 + 키워드 재구성 제안 이력
-- spec 2026-04-28-strategy-v2-extension §2.B + §5.2

CREATE TABLE IF NOT EXISTS winner_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('coupang', 'naver')),
  occupancy_pct REAL NOT NULL CHECK (occupancy_pct >= 0 AND occupancy_pct <= 100),
  is_winner BOOLEAN NOT NULL,
  search_rank INT,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_winner_history_sku
  ON winner_history (sku_code, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_winner_history_user
  ON winner_history (user_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_winner_history_lost
  ON winner_history (is_winner, snapshot_at DESC) WHERE is_winner = false;

CREATE TABLE IF NOT EXISTS keyword_optimizations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  current_title TEXT NOT NULL,
  suggested_title TEXT NOT NULL,
  reasoning TEXT,
  current_rank INT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_keyword_opt_sku
  ON keyword_optimizations (sku_code, created_at DESC);

COMMENT ON TABLE winner_history IS
  '아이템위너 점유율 일별 스냅샷. spec 2026-04-28 §2.B 기능 4';
COMMENT ON TABLE keyword_optimizations IS
  '위너 SKU 상품명 재구성 제안 이력. spec 2026-04-28 §2.B 기능 5';
