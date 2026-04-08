-- ─────────────────────────────────────────────────────────────────────────
-- 015: sales_analysis_view 의 prev_1d 로직 수정
--
-- 기존: snapshot_date = CURRENT_DATE - 1 day (정확히 어제만)
-- 변경: 최신 스냅샷 직전의 가장 최근 스냅샷 (하루 빠져도 계산 가능)
--
-- prev_7d도 동일하게 "최신 스냅샷 기준 2일 이상 전 중 가장 최근"으로 변경하여
-- 수집이 빠진 날이 있어도 판매량 추정이 가능하도록 함
-- ─────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.sales_analysis_view;
CREATE VIEW public.sales_analysis_view AS
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
  -- 최신 스냅샷 직전의 가장 최근 스냅샷 (하루 빠져도 동작)
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
  -- 최신 스냅샷 기준 2일 이상 전 중 가장 최근 스냅샷
  SELECT DISTINCT ON (s.item_no)
    s.item_no,
    s.snapshot_date      AS prev_7d_date,
    s.inventory          AS prev_inventory_7d
  FROM public.inventory_snapshots s
  INNER JOIN latest l ON l.item_no = s.item_no
  WHERE s.snapshot_date <= l.latest_date - INTERVAL '2 days'
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
  -- 전일 판매량: 직전 스냅샷 재고 − 최신 재고 (음수 방지)
  GREATEST(0, COALESCE(p1.prev_inventory_1d, 0) - l.latest_inventory)  AS sales_1d,
  p7.prev_inventory_7d,
  p7.prev_7d_date,
  -- 7일 판매량: 과거 스냅샷 재고 − 최신 재고 (음수 방지)
  GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)  AS sales_7d,
  -- 일평균 판매량 (경과일수 기준)
  ROUND(
    GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)::numeric
    / GREATEST(1, (l.latest_date - COALESCE(p7.prev_7d_date, l.latest_date - 7))::integer),
    2
  )                                                                      AS avg_daily_sales
FROM public.sourcing_items si
JOIN latest l ON l.item_id = si.id
LEFT JOIN prev_1d p1 ON p1.item_no = si.item_no
LEFT JOIN prev_7d p7 ON p7.item_no = si.item_no;
