-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Niche Competitor Sales Tracking
-- 파일: supabase/migrations/014_niche_competitor_sales.sql
--
-- 니치소싱 경쟁 상품 전일 판매 추적을 위한 테이블 2종 + 요약 뷰:
--   1. niche_competitor_products  — 키워드별 경쟁 상품 마스터
--   2. niche_sales_snapshots      — 경쟁 상품 일별 판매 데이터 스냅샷
--   3. niche_competitor_summary_view — 최신 데이터 요약 뷰
--
-- 설계 원칙:
--   - 기존 테이블 수정 없음 (순수 ADD)
--   - niche_keywords.keyword 에 FK 연결
--   - 크롤링 없음 — 사용자 수동 입력 전제
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. niche_competitor_products — 키워드별 경쟁 상품 마스터
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.niche_competitor_products (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 키워드 참조
  keyword           text        NOT NULL
                      REFERENCES public.niche_keywords(keyword)
                      ON UPDATE CASCADE ON DELETE CASCADE,

  -- 상품 식별
  platform          text        NOT NULL DEFAULT 'coupang'
                      CHECK (platform IN ('coupang', 'naver', 'gmarket', 'auction', 'etc')),
  product_url       text,
  product_id        text,
  product_name      text        NOT NULL,
  seller_name       text,
  image_url         text,

  -- 상품 메타
  is_rocket         boolean     DEFAULT false,
  is_ad             boolean     DEFAULT false,
  rank_position     smallint,

  -- 추적 상태
  is_tracking       boolean     NOT NULL DEFAULT true,
  memo              text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.niche_competitor_products             IS '니치 키워드별 경쟁 상품 마스터. 사용자가 추적할 경쟁 상품을 등록.';
COMMENT ON COLUMN public.niche_competitor_products.platform    IS '판매 플랫폼: coupang, naver, gmarket, auction, etc';
COMMENT ON COLUMN public.niche_competitor_products.product_id  IS '플랫폼 내 고유 상품 ID (쿠팡 vendorItemId, 네이버 productId 등)';
COMMENT ON COLUMN public.niche_competitor_products.rank_position IS '해당 키워드 검색 시 상품의 노출 순위 (등록 시점 기준)';
COMMENT ON COLUMN public.niche_competitor_products.is_rocket   IS '쿠팡 로켓배송/로켓직구 여부';

-- (keyword, platform, product_id) 복합 유니크
CREATE UNIQUE INDEX IF NOT EXISTS uidx_niche_competitor_kw_plat_pid
  ON public.niche_competitor_products (keyword, platform, product_id)
  WHERE product_id IS NOT NULL;

CREATE TRIGGER trg_niche_competitor_products_updated_at
  BEFORE UPDATE ON public.niche_competitor_products
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_niche_competitor_products_keyword
  ON public.niche_competitor_products (keyword);

CREATE INDEX IF NOT EXISTS idx_niche_competitor_products_tracking
  ON public.niche_competitor_products (is_tracking)
  WHERE is_tracking = true;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. niche_sales_snapshots — 경쟁 상품 일별 판매 데이터 스냅샷
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.niche_sales_snapshots (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 상품 참조
  competitor_id     uuid        NOT NULL
                      REFERENCES public.niche_competitor_products(id)
                      ON DELETE CASCADE,

  -- 비정규화 (조인 없이 집계용)
  keyword           text        NOT NULL,
  platform          text        NOT NULL,

  -- 기준일
  snapshot_date     date        NOT NULL DEFAULT CURRENT_DATE,

  -- 핵심 판매 데이터
  price             integer,
  original_price    integer,
  review_count      integer,
  rating            numeric(2,1),
  sales_count       integer,

  -- 파생 지표
  review_delta      integer,
  sales_rank        smallint,
  rank_position     smallint,

  -- 입력 메타
  input_method      text        NOT NULL DEFAULT 'manual'
                      CHECK (input_method IN ('manual', 'bookmarklet', 'extension', 'api')),
  memo              text,

  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.niche_sales_snapshots                IS '경쟁 상품 일별 판매 데이터 스냅샷. 사용자가 직접 확인하여 입력.';
COMMENT ON COLUMN public.niche_sales_snapshots.sales_count    IS '전일 판매량 (추정). 쿠팡 "최근 X일간 N개 판매" 문구에서 추산.';
COMMENT ON COLUMN public.niche_sales_snapshots.review_delta   IS '전일 대비 리뷰 증가량. 판매량 간접 추정 가능 (x20~x50 배수).';
COMMENT ON COLUMN public.niche_sales_snapshots.input_method   IS 'manual=수동입력, bookmarklet=북마클릿, extension=브라우저확장, api=외부API';

-- (competitor_id, snapshot_date) 복합 유니크 — 하루 1회 upsert 보장
CREATE UNIQUE INDEX IF NOT EXISTS uidx_niche_sales_competitor_date
  ON public.niche_sales_snapshots (competitor_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_niche_sales_keyword_date
  ON public.niche_sales_snapshots (keyword, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_niche_sales_competitor_date
  ON public.niche_sales_snapshots (competitor_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_niche_sales_snapshot_date
  ON public.niche_sales_snapshots (snapshot_date DESC);


-- ─────────────────────────────────────────────────────────────────────────
-- 3. niche_competitor_summary_view — 키워드별 경쟁 현황 요약 뷰
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.niche_competitor_summary_view AS
WITH latest_snapshots AS (
  SELECT DISTINCT ON (competitor_id)
    competitor_id,
    keyword,
    platform,
    snapshot_date,
    price,
    review_count,
    rating,
    sales_count,
    review_delta,
    rank_position
  FROM public.niche_sales_snapshots
  ORDER BY competitor_id, snapshot_date DESC
),
prev_snapshots AS (
  SELECT DISTINCT ON (s.competitor_id)
    s.competitor_id,
    s.review_count AS prev_review_count,
    s.sales_count  AS prev_sales_count,
    s.price        AS prev_price
  FROM public.niche_sales_snapshots s
  INNER JOIN latest_snapshots ls
    ON ls.competitor_id = s.competitor_id
    AND s.snapshot_date < ls.snapshot_date
  ORDER BY s.competitor_id, s.snapshot_date DESC
)
SELECT
  cp.id               AS competitor_id,
  cp.keyword,
  cp.platform,
  cp.product_name,
  cp.seller_name,
  cp.product_url,
  cp.is_rocket,
  cp.is_ad,
  ls.snapshot_date     AS latest_date,
  ls.price,
  ls.review_count,
  ls.rating,
  ls.sales_count,
  ls.review_delta,
  ls.rank_position,
  ps.prev_price,
  ls.price - COALESCE(ps.prev_price, ls.price)                       AS price_change,
  COALESCE(ls.review_count, 0) - COALESCE(ps.prev_review_count, 0)   AS review_change
FROM public.niche_competitor_products cp
LEFT JOIN latest_snapshots ls ON ls.competitor_id = cp.id
LEFT JOIN prev_snapshots   ps ON ps.competitor_id = cp.id
WHERE cp.is_tracking = true;

COMMENT ON VIEW public.niche_competitor_summary_view IS '키워드별 추적 중인 경쟁 상품의 최신 판매 데이터 요약. 대시보드 메인 조회용.';
