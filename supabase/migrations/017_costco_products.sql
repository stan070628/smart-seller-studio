-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Costco Products Schema
-- 파일: supabase/migrations/017_costco_products.sql
--
-- 코스트코 온라인몰 스크래핑 데이터를 저장하는 테이블:
--   1. costco_products        — 상품 마스터
--   2. costco_price_logs      — 가격 변동 이력 (스냅샷)
--   3. costco_collection_logs — 수집 실행 이력
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. costco_products — 코스트코 상품 마스터
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.costco_products (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code     text        NOT NULL UNIQUE,    -- 코스트코 상품 코드 (URL 슬러그 또는 SKU)
  title            text        NOT NULL,
  category_name    text,
  image_url        text,
  product_url      text        NOT NULL,
  price            integer     NOT NULL,           -- 현재 표시 가격 (원)
  original_price   integer,                        -- 할인 전 원가 (표시될 경우)
  is_active        boolean     NOT NULL DEFAULT true,   -- false = 현재 사이트에서 내려간 상품
  collected_at     timestamptz NOT NULL DEFAULT now(),  -- 마지막 수집 시각
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_costco_products_updated_at
  BEFORE UPDATE ON public.costco_products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_costco_products_category     ON public.costco_products(category_name);
CREATE INDEX IF NOT EXISTS idx_costco_products_collected_at ON public.costco_products(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_costco_products_is_active    ON public.costco_products(is_active);

ALTER TABLE public.costco_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "costco_products: service_role only"
  ON public.costco_products FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────
-- 2. costco_price_logs — 가격 변동 이력
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.costco_price_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid        NOT NULL REFERENCES public.costco_products(id) ON DELETE CASCADE,
  product_code     text        NOT NULL,
  price            integer     NOT NULL,
  logged_at        date        NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_costco_price_logs_code_date
  ON public.costco_price_logs(product_code, logged_at);

CREATE INDEX IF NOT EXISTS idx_costco_price_logs_product_id ON public.costco_price_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_costco_price_logs_logged_at  ON public.costco_price_logs(logged_at DESC);

ALTER TABLE public.costco_price_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "costco_price_logs: service_role only"
  ON public.costco_price_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────
-- 3. costco_collection_logs — 수집 실행 이력
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.costco_collection_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text        NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'success', 'partial', 'failed')),
  products_scraped integer     NOT NULL DEFAULT 0,
  errors           jsonb,
  trigger_type     text        NOT NULL DEFAULT 'manual'
                   CHECK (trigger_type IN ('cron', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_costco_collection_logs_started_at ON public.costco_collection_logs(started_at DESC);

ALTER TABLE public.costco_collection_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "costco_collection_logs: service_role only"
  ON public.costco_collection_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);
