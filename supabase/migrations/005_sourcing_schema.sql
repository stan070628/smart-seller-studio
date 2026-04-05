-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Sourcing Schema Migration
-- 파일: supabase/migrations/005_sourcing_schema.sql
--
-- 도매꾹 소싱 자동화를 위한 테이블 3종:
--   1. sourcing_items      — 추적 대상 상품 마스터
--   2. inventory_snapshots — 재고·가격 시계열 스냅샷
--   3. collection_logs     — 수집 실행 이력
--
-- NOTE: handle_updated_at 함수는 001_initial_schema.sql 에서 이미 생성됨.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. sourcing_items — 도매꾹 상품 마스터 (추적 대상)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sourcing_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_no       integer     NOT NULL UNIQUE,           -- 도매꾹 상품번호
  title         text        NOT NULL,
  status        text,                                   -- 판매중 / 판매중지 등
  category_name text,
  seller_id     text,
  seller_nick   text,
  image_url     text,
  dome_url      text,                                   -- 도매꾹 상품 상세 URL
  is_tracking   boolean     NOT NULL DEFAULT true,      -- false 이면 수집 제외
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- updated_at 자동 갱신 트리거
CREATE TRIGGER trg_sourcing_items_updated_at
  BEFORE UPDATE ON public.sourcing_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sourcing_items_item_no      ON public.sourcing_items(item_no);
CREATE INDEX IF NOT EXISTS idx_sourcing_items_is_tracking  ON public.sourcing_items(is_tracking);
CREATE INDEX IF NOT EXISTS idx_sourcing_items_category     ON public.sourcing_items(category_name);

-- RLS 활성화 — 서버 전용 테이블이므로 service_role 만 접근 허용
ALTER TABLE public.sourcing_items ENABLE ROW LEVEL SECURITY;

-- anon / authenticated 는 접근 불가 (관리자 API가 service_role 로만 호출)
CREATE POLICY "sourcing_items: service_role only"
  ON public.sourcing_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────
-- 2. inventory_snapshots — 재고·가격 시계열 스냅샷
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inventory_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid        NOT NULL REFERENCES public.sourcing_items(id) ON DELETE CASCADE,
  item_no       integer     NOT NULL,                  -- 조인 없이 빠른 집계용 비정규화
  snapshot_date date        NOT NULL DEFAULT CURRENT_DATE,
  inventory     integer     NOT NULL DEFAULT 0,        -- 수집 시점 재고 수량
  price_dome    integer,                               -- 도매꾹 판매가 (원)
  price_supply  integer,                               -- 공급가 (원)
  collected_at  timestamptz NOT NULL DEFAULT now()
);

-- (item_no, snapshot_date) 복합 유니크 — 하루 1회 upsert 보장
CREATE UNIQUE INDEX IF NOT EXISTS uidx_inventory_snapshots_item_date
  ON public.inventory_snapshots(item_no, snapshot_date);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_item_id     ON public.inventory_snapshots(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_item_no     ON public.inventory_snapshots(item_no);
CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_snapshot_date ON public.inventory_snapshots(snapshot_date DESC);

-- RLS 활성화
ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_snapshots: service_role only"
  ON public.inventory_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────
-- 3. collection_logs — 수집 실행 이력
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.collection_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text        NOT NULL DEFAULT 'running'
                               CHECK (status IN ('running', 'success', 'partial', 'failed')),
  items_fetched    integer     NOT NULL DEFAULT 0,
  snapshots_saved  integer     NOT NULL DEFAULT 0,
  errors           jsonb,                             -- 실패 항목 목록 [{itemNo, error}]
  trigger_type     text        NOT NULL DEFAULT 'cron'
                               CHECK (trigger_type IN ('cron', 'manual'))
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_collection_logs_started_at    ON public.collection_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_logs_status        ON public.collection_logs(status);
CREATE INDEX IF NOT EXISTS idx_collection_logs_trigger_type  ON public.collection_logs(trigger_type);

-- RLS 활성화
ALTER TABLE public.collection_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collection_logs: service_role only"
  ON public.collection_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────
-- 4. 판매 분석 뷰 (sales_analysis_view)
--    최신 스냅샷과 1일/7일 전 스냅샷을 JOIN 해 판매 추정량을 계산
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.sales_analysis_view AS
WITH latest AS (
  -- 각 상품의 가장 최근 스냅샷
  SELECT DISTINCT ON (item_no)
    item_id,
    item_no,
    snapshot_date        AS latest_date,
    inventory            AS latest_inventory,
    price_dome           AS latest_price_dome,
    price_supply         AS latest_price_supply
  FROM public.inventory_snapshots
  ORDER BY item_no, snapshot_date DESC
),
prev_1d AS (
  -- 1일 전 스냅샷
  SELECT DISTINCT ON (item_no)
    item_no,
    inventory            AS prev_inventory_1d
  FROM public.inventory_snapshots
  WHERE snapshot_date = CURRENT_DATE - INTERVAL '1 day'
  ORDER BY item_no, snapshot_date DESC
),
prev_7d AS (
  -- 7일 전 스냅샷 (정확히 7일 전 없으면 가장 가까운 과거)
  SELECT DISTINCT ON (s.item_no)
    s.item_no,
    s.snapshot_date      AS prev_7d_date,
    s.inventory          AS prev_inventory_7d
  FROM public.inventory_snapshots s
  WHERE s.snapshot_date <= CURRENT_DATE - INTERVAL '7 days'
  ORDER BY s.item_no, s.snapshot_date DESC
)
SELECT
  si.id,
  si.item_no,
  si.title,
  si.status,
  si.category_name,
  si.seller_nick,
  si.image_url,
  si.dome_url,
  si.is_tracking,
  l.latest_date,
  l.latest_inventory,
  l.latest_price_dome,
  l.latest_price_supply,
  p1.prev_inventory_1d,
  -- 1일 판매량: 전일 재고 - 오늘 재고 (음수 방지)
  GREATEST(0, COALESCE(p1.prev_inventory_1d, 0) - l.latest_inventory)  AS sales_1d,
  p7.prev_inventory_7d,
  p7.prev_7d_date,
  -- 7일 판매량: 7일 전 재고 - 오늘 재고 (음수 방지)
  GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)  AS sales_7d,
  -- 일평균 판매량 (7일 기준)
  ROUND(
    GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)::numeric
    / GREATEST(1, CURRENT_DATE - COALESCE(p7.prev_7d_date, CURRENT_DATE - INTERVAL '7 days')),
    2
  )                                                                      AS avg_daily_sales
FROM public.sourcing_items si
JOIN latest l ON l.item_id = si.id
LEFT JOIN prev_1d p1 ON p1.item_no = si.item_no
LEFT JOIN prev_7d p7 ON p7.item_no = si.item_no;
