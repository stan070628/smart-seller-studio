-- ─────────────────────────────────────────────────────────────────────────
-- 034: sales_analysis_view → MATERIALIZED VIEW 전환
--
-- 이유: 매 요청마다 inventory_snapshots CTE 풀스캔 3회 → 결과 캐시로 교체
-- refresh: POST /api/sourcing/snapshot 완료 시점에 CONCURRENTLY 갱신
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. 기존 plain VIEW 제거
DROP VIEW IF EXISTS public.sales_analysis_view;

-- 2. MATERIALIZED VIEW 생성 (동일 SQL)
CREATE MATERIALIZED VIEW public.sales_analysis_view AS
WITH latest AS (
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
  SELECT DISTINCT ON (s.item_no)
    s.item_no,
    s.snapshot_date      AS prev_1d_date,
    s.inventory          AS prev_inventory_1d
  FROM public.inventory_snapshots s
  INNER JOIN latest l ON l.item_no = s.item_no
  WHERE s.snapshot_date < l.latest_date
  ORDER BY s.item_no, s.snapshot_date DESC
),
prev_7d AS (
  SELECT DISTINCT ON (s.item_no)
    s.item_no,
    s.snapshot_date      AS prev_7d_date,
    s.inventory          AS prev_inventory_7d
  FROM public.inventory_snapshots s
  INNER JOIN latest l ON l.item_no = s.item_no
  WHERE s.snapshot_date <= l.latest_date - INTERVAL '7 days'
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
  p1.prev_1d_date,
  GREATEST(0, COALESCE(p1.prev_inventory_1d, 0) - l.latest_inventory)  AS sales_1d,
  p7.prev_inventory_7d,
  p7.prev_7d_date,
  GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)  AS sales_7d,
  ROUND(
    GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)::numeric
    / GREATEST(1, (l.latest_date - COALESCE(p7.prev_7d_date, l.latest_date - 7))::integer),
    2
  )                                                                      AS avg_daily_sales
FROM public.sourcing_items si
JOIN latest l ON l.item_id = si.id
LEFT JOIN prev_1d p1 ON p1.item_no = si.item_no
LEFT JOIN prev_7d p7 ON p7.item_no = si.item_no;

-- 3. CONCURRENTLY refresh를 위한 UNIQUE INDEX (id 기준)
CREATE UNIQUE INDEX idx_sales_analysis_view_id ON public.sales_analysis_view (id);

-- 4. 조회 성능 인덱스
CREATE INDEX idx_sales_analysis_view_sales7d ON public.sales_analysis_view (sales_7d DESC);
CREATE INDEX idx_sales_analysis_view_cat     ON public.sales_analysis_view (category_name);

COMMIT;
