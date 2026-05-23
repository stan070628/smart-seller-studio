-- 대시보드 12주 매출 캐시 테이블
-- Coupang 외부 API 순차 호출(최대 50페이지) 비용을 하루 1회로 줄임
CREATE TABLE IF NOT EXISTS dashboard_revenue_cache (
  cache_key   TEXT PRIMARY KEY,          -- 'coupang:12w:YYYY-MM-DD' 형식
  actual      JSONB        NOT NULL,     -- (number | null)[] 12개 원소
  cached_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
