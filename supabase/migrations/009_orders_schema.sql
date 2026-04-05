-- ============================================================
-- 009: 주문/매출 관리 스키마
-- 판매 채널 연결, 주문 추적, 발주 규칙, 일별 매출 집계
-- ============================================================

-- 판매 채널 연결 정보
CREATE TABLE IF NOT EXISTS sales_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('coupang','naver','gmarket','elevenst','shopee')),
  is_connected boolean DEFAULT false,
  credentials jsonb DEFAULT '{}'::jsonb,
  sync_enabled boolean DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (platform)
);

-- 주문 테이블
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES sales_channels(id),
  platform text NOT NULL,
  platform_order_id text NOT NULL,
  product_title text,
  quantity integer DEFAULT 1,
  selling_price integer,
  cost_price integer,
  profit integer,
  status text DEFAULT 'new'
    CHECK (status IN ('new','processing','ordered','shipping','delivered','cancelled','returned')),
  supplier text,
  supplier_order_id text,
  tracking_number text,
  ordered_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (platform, platform_order_id)
);

-- 발주 규칙
CREATE TABLE IF NOT EXISTS order_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel_platform text,
  action text DEFAULT 'notify_only'
    CHECK (action IN ('auto_order','notify_only','manual')),
  conditions jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 일별 매출 집계
CREATE TABLE IF NOT EXISTS daily_sales_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_date date NOT NULL,
  platform text NOT NULL,
  total_orders integer DEFAULT 0,
  total_revenue integer DEFAULT 0,
  total_cost integer DEFAULT 0,
  total_profit integer DEFAULT 0,
  return_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (summary_date, platform)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_orders_platform ON orders (platform);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_ordered_at ON orders (ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sales_date ON daily_sales_summary (summary_date DESC);

-- 채널 초기 데이터
INSERT INTO sales_channels (platform, is_connected) VALUES
  ('coupang', false),
  ('naver', false),
  ('gmarket', false),
  ('elevenst', false),
  ('shopee', false)
ON CONFLICT (platform) DO NOTHING;
