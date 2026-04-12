-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Costco Market Prices
-- 파일: supabase/migrations/019_costco_market_prices.sql
--
-- 네이버/쿠팡 시장 최저가 이력 테이블
-- 수동 입력(Phase 2) 및 API 자동 수집(Phase 4) 모두 저장
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.costco_market_prices (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid    NOT NULL REFERENCES public.costco_products(id) ON DELETE CASCADE,
  product_code text    NOT NULL,
  market_price integer NOT NULL,
  source       text    NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'naver_api', 'coupang_api')),
  logged_at    date    NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (product_code, logged_at, source)
);

CREATE INDEX idx_costco_market_prices_product_id
  ON public.costco_market_prices(product_id);
CREATE INDEX idx_costco_market_prices_code
  ON public.costco_market_prices(product_code);
CREATE INDEX idx_costco_market_prices_logged_at
  ON public.costco_market_prices(logged_at DESC);

-- RLS는 Supabase 전용 (Render PostgreSQL에서는 생략)
