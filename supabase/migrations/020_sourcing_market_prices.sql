-- migration: 020_sourcing_market_prices.sql
-- sourcing_items 테이블에 네이버 쇼핑 시장 최저가 컬럼 추가

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS market_lowest_price     INTEGER,
  ADD COLUMN IF NOT EXISTS market_price_source     TEXT
    CHECK (market_price_source IN ('naver_api', 'manual')),
  ADD COLUMN IF NOT EXISTS market_price_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sourcing_items.market_lowest_price     IS '시장 최저가 (원) — 네이버 쇼핑 API 또는 수동 입력';
COMMENT ON COLUMN public.sourcing_items.market_price_source     IS '시장가 출처: naver_api | manual';
COMMENT ON COLUMN public.sourcing_items.market_price_updated_at IS '시장가 마지막 갱신 시각';
