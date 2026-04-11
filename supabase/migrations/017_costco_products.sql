-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Costco Products Schema v2
-- 파일: supabase/migrations/017_costco_products.sql
--
-- 코스트코 온라인몰 SAP Hybris OCC v2 API 스크래핑 데이터:
--   1. costco_products        — 상품 마스터 + 소싱 스코어
--   2. costco_price_logs      — 가격 이력 (일별 스냅샷)
--   3. costco_collection_logs — 수집 실행 이력
-- ═══════════════════════════════════════════════════════════════════════════

-- 기존 테이블 초기화 (순서 중요: FK 참조 순서대로 DROP)
DROP TABLE IF EXISTS public.costco_price_logs CASCADE;
DROP TABLE IF EXISTS public.costco_collection_logs CASCADE;
DROP TABLE IF EXISTS public.costco_products CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- 1. costco_products — 상품 마스터 + 소싱 스코어
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.costco_products (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code           text        NOT NULL UNIQUE,    -- OCC productCode (예: 1234567)
  title                  text        NOT NULL,
  category_name          text,                           -- 한글 카테고리명
  category_code          text,                           -- OCC 카테고리 코드 (예: cos_15.3.1)
  image_url              text,
  product_url            text        NOT NULL,
  brand                  text,

  -- 가격 정보
  price                  integer     NOT NULL,           -- 현재 판매가 (원)
  original_price         integer,                        -- 할인 전 정가 (있을 경우)
  first_price            integer,                        -- 최초 수집 가격 (COALESCE — 덮어쓰지 않음)
  lowest_price           integer,                        -- 역대 최저가 (LEAST — 항상 갱신)
  target_sell_price      integer GENERATED ALWAYS AS (
    CASE WHEN price > 0 THEN CEIL(price * 1.4) ELSE NULL END
  ) STORED,                                              -- 1.4x 목표 판매가 (자동계산)

  -- 상품 메타
  average_rating         numeric(2,1),                  -- 별점 (0.0~5.0)
  review_count           integer     NOT NULL DEFAULT 0,
  stock_status           text        NOT NULL DEFAULT 'inStock'
    CHECK (stock_status IN ('inStock', 'outOfStock', 'lowStock')),
  shipping_included      boolean     NOT NULL DEFAULT false,

  -- 시장 가격 (수동 입력 or API 수집)
  market_lowest_price    integer,                        -- 네이버/쿠팡 최저가
  market_price_source    text        CHECK (market_price_source IN ('manual', 'naver_api', 'coupang_api')),
  market_price_updated_at timestamptz,

  -- 소싱 종합 스코어 (0~100)
  sourcing_score         integer     NOT NULL DEFAULT 0,
  demand_score           integer     NOT NULL DEFAULT 0, -- 수요 점수 (리뷰 수 기반)
  price_opp_score        integer     NOT NULL DEFAULT 0, -- 가격 기회 점수 (시장가 대비 마진)
  urgency_score          integer     NOT NULL DEFAULT 0, -- 긴급성 점수 (재고 상태)
  seasonal_score         integer     NOT NULL DEFAULT 0, -- 계절성 점수 (Naver DataLab)
  margin_score           integer     NOT NULL DEFAULT 0, -- 마진 점수 (순이익률)

  -- 상태
  is_active              boolean     NOT NULL DEFAULT true,  -- false = 판매 종료 상품
  collected_at           timestamptz NOT NULL DEFAULT now(), -- 마지막 수집 시각
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_costco_products_updated_at
  BEFORE UPDATE ON public.costco_products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_costco_products_category      ON public.costco_products(category_name);
CREATE INDEX idx_costco_products_collected_at  ON public.costco_products(collected_at DESC);
CREATE INDEX idx_costco_products_is_active     ON public.costco_products(is_active);
CREATE INDEX idx_costco_products_sourcing_score ON public.costco_products(sourcing_score DESC);
CREATE INDEX idx_costco_products_stock_status  ON public.costco_products(stock_status);

-- RLS는 Supabase 전용 (Render PostgreSQL에서는 생략)


-- ─────────────────────────────────────────────────────────────────────────
-- 2. costco_price_logs — 일별 가격 스냅샷
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.costco_price_logs (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid    NOT NULL REFERENCES public.costco_products(id) ON DELETE CASCADE,
  product_code text    NOT NULL,
  price        integer NOT NULL,
  logged_at    date    NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX uidx_costco_price_logs_code_date
  ON public.costco_price_logs(product_code, logged_at);

CREATE INDEX idx_costco_price_logs_product_id ON public.costco_price_logs(product_id);
CREATE INDEX idx_costco_price_logs_logged_at  ON public.costco_price_logs(logged_at DESC);

-- RLS는 Supabase 전용 (Render PostgreSQL에서는 생략)


-- ─────────────────────────────────────────────────────────────────────────
-- 3. costco_collection_logs — 수집 실행 이력
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.costco_collection_logs (
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

CREATE INDEX idx_costco_collection_logs_started_at
  ON public.costco_collection_logs(started_at DESC);

-- RLS는 Supabase 전용 (Render PostgreSQL에서는 생략)
