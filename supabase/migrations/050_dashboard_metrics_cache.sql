-- 대시보드 위젯용 사전 집계 캐시.
-- 쿠팡 상품 수는 cursor 페이징 순차 호출(50회+)이 필요해 매 요청마다 조회 시 수십 초 소요.
-- 일 1회 cron(03:00 KST)으로 미리 채우고, /api/dashboard/product-count 가 즉시 반환.
-- spec: docs/superpowers/specs (dashboard 성능 fix)

CREATE TABLE IF NOT EXISTS dashboard_metrics_cache (
  user_id UUID PRIMARY KEY,
  coupang_product_count INTEGER NOT NULL DEFAULT 0,
  naver_product_count INTEGER NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE dashboard_metrics_cache IS '대시보드 사전 집계 캐시. 일 1회 cron으로 갱신.';
COMMENT ON COLUMN dashboard_metrics_cache.refreshed_at IS '마지막 갱신 시각. UI에 노출 (예: "동기화: 03:02").';
