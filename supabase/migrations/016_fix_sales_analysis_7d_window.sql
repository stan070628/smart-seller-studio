-- ─────────────────────────────────────────────────────────────────────────
-- 016: sales_analysis_view 의 prev_7d 로직 수정
--
-- 015에서 prev_7d 윈도우를 '2 days'로 잘못 설정한 버그 수정
-- '2 days' → '7 days' 로 변경
--
-- 결과: sales_7d 가 실제 7일치 판매량을 반영하게 됨
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
  -- 최신 스냅샷 기준 7일 이상 전 중 가장 최근 스냅샷 (수집 누락일 있어도 동작)
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
  -- 전일 판매량: 직전 스냅샷 재고 − 최신 재고 (음수 방지)
  GREATEST(0, COALESCE(p1.prev_inventory_1d, 0) - l.latest_inventory)  AS sales_1d,
  p7.prev_inventory_7d,
  p7.prev_7d_date,
  -- 7일 판매량: 7일 이상 전 스냅샷 재고 − 최신 재고 (음수 방지)
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
