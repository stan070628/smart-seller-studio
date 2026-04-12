-- ═══════════════════════════════════════════════════════════════
-- 030_analytics_4layer_schema.sql
-- 4계층 데이터 추적 시스템
--
-- Layer 1: discovery_logs     — 시스템 추천 기록 (자동)
-- Layer 2: registrations      — 실제 등록 추적 (반자동)
-- Layer 3: sales_events       — 판매 발생 (정산 CSV)
-- Layer 4: settlements        — 정산·수익·CS (정산 CSV)
--
-- 참고: Render PostgreSQL 환경 — Supabase RLS 롤 없음
--       접근 제어는 SOURCING_DATABASE_URL 비공개 + API Route 인증으로 대체
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Layer 1: discovery_logs — 시스템 추천 기록
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discovery_logs (
  id              BIGSERIAL    PRIMARY KEY,
  scanned_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  channel_source  TEXT         NOT NULL,

  -- 상품 정보 스냅샷 (스캔 시점 기준 — 이후 변경되어도 발굴 시점 데이터 보존)
  product_id      TEXT         NOT NULL,
  product_name    TEXT         NOT NULL,
  category        TEXT,

  -- 시스템 판단 스냅샷
  score_total          INT,
  score_breakdown      JSONB,                -- { legal: 12, price: 20, cs: 8, ... }
  grade                TEXT,                 -- 'S' | 'A' | 'B' | 'C' | 'D'

  -- 가격 추천 (스캔 시점)
  recommended_price_naver   INT,
  recommended_price_coupang INT,

  -- 분류 메타
  male_score       INT,
  male_tier        TEXT,                     -- 'high' | 'mid' | 'neutral' | 'female'
  season_bonus     INT,
  season_labels    TEXT[],
  needs_review     BOOLEAN  NOT NULL DEFAULT FALSE,
  blocked_reason   TEXT,

  -- 사용자 의사결정 (나중에 UPDATE)
  operator_action  TEXT,                     -- 'registered' | 'skipped' | 'bookmarked'
  action_at        TIMESTAMPTZ,
  action_note      TEXT,                     -- 스킵·북마크 자유 메모

  CONSTRAINT discovery_logs_channel_check
    CHECK (channel_source IN ('costco', 'domeggook')),
  CONSTRAINT discovery_logs_action_check
    CHECK (operator_action IS NULL OR operator_action IN ('registered', 'skipped', 'bookmarked'))
);

COMMENT ON TABLE  public.discovery_logs                     IS 'Layer 1: 시스템이 추천한 상품 발굴 기록 (스냅샷)';
COMMENT ON COLUMN public.discovery_logs.score_breakdown     IS '항목별 점수 스냅샷 { legal, price, cs, margin, demand, supply, [moq|turnover] }';
COMMENT ON COLUMN public.discovery_logs.operator_action     IS '사용자 의사결정: registered=등록완료, skipped=스킵, bookmarked=나중에볼것';
COMMENT ON COLUMN public.discovery_logs.action_note         IS '스킵 사유 등 자유 메모 (선택)';

-- 중복 방지: 같은 채널의 같은 상품은 하루 1번만 기록
-- ON CONFLICT로 당일 재스캔 시 스코어만 갱신
CREATE UNIQUE INDEX IF NOT EXISTS uidx_discovery_daily_dedup
  ON public.discovery_logs (channel_source, product_id, (scanned_at::date));

CREATE INDEX IF NOT EXISTS idx_discovery_scanned_at
  ON public.discovery_logs (scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_channel_source
  ON public.discovery_logs (channel_source);
CREATE INDEX IF NOT EXISTS idx_discovery_score_total
  ON public.discovery_logs (score_total DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_discovery_grade
  ON public.discovery_logs (grade);
CREATE INDEX IF NOT EXISTS idx_discovery_operator_action
  ON public.discovery_logs (operator_action) WHERE operator_action IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- Layer 2: registrations — 실제 등록 추적
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.registrations (
  id                     BIGSERIAL    PRIMARY KEY,
  registered_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- discovery_logs 역참조 (null 허용: 직접 등록 등)
  discovery_log_id       BIGINT       REFERENCES public.discovery_logs(id)
                                      ON DELETE SET NULL,

  -- 플랫폼 정보
  platform               TEXT         NOT NULL,         -- 'naver' | 'coupang'
  platform_product_id    TEXT,                          -- 플랫폼 상품번호 (등록 후 입력)

  -- 상품 정보 스냅샷
  product_name           TEXT         NOT NULL,
  category_path          TEXT,

  -- 가격 전략
  actual_listed_price    INT          NOT NULL,
  actual_bundle_strategy TEXT,         -- 'single' | '1+1' | '2+1' | 'set_3ea' 등

  -- SEO 데이터
  title_used             TEXT         NOT NULL,
  keywords_used          TEXT[],
  thumbnail_url          TEXT,

  -- 시스템 vs 실제 가격 괴리 추적
  system_recommended_price INT,
  price_deviation        NUMERIC(5,3),  -- (actual - recommended) / recommended

  -- 원가 정보
  wholesale_cost         INT,           -- 매입 원가
  shipping_cost_estimate INT,           -- 예상 배송비

  -- 상태
  status                 TEXT         NOT NULL DEFAULT 'active',
  deactivated_at         TIMESTAMPTZ,
  deactivation_reason    TEXT,          -- '경쟁심화' | '마진부족' | '품절' 등

  CONSTRAINT registrations_platform_check
    CHECK (platform IN ('naver', 'coupang')),
  CONSTRAINT registrations_status_check
    CHECK (status IN ('active', 'paused', 'deactivated'))
);

COMMENT ON TABLE  public.registrations                      IS 'Layer 2: 실제 등록한 상품 추적 (반자동)';
COMMENT ON COLUMN public.registrations.price_deviation      IS '(actual - recommended) / recommended — 추천가 대비 실제 등록가 괴리율';
COMMENT ON COLUMN public.registrations.deactivation_reason  IS '상품 내림 사유 (경쟁심화, 마진부족, 품절 등)';

-- 동일 플랫폼·동일 상품 중복 등록 방지 (platform_product_id가 있을 때만)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_registrations_platform_product
  ON public.registrations (platform, platform_product_id)
  WHERE platform_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_discovery_log
  ON public.registrations (discovery_log_id);
CREATE INDEX IF NOT EXISTS idx_registrations_platform
  ON public.registrations (platform);
CREATE INDEX IF NOT EXISTS idx_registrations_status
  ON public.registrations (status);
CREATE INDEX IF NOT EXISTS idx_registrations_registered_at
  ON public.registrations (registered_at DESC);

-- ─────────────────────────────────────────────────────────────
-- Layer 3: sales_events — 판매 발생 기록
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sales_events (
  id                BIGSERIAL    PRIMARY KEY,
  sold_at           TIMESTAMPTZ  NOT NULL,

  registration_id   BIGINT       REFERENCES public.registrations(id)
                                 ON DELETE SET NULL,
  platform          TEXT         NOT NULL,

  -- 주문 정보
  platform_order_id TEXT,                  -- 플랫폼 주문번호 (중복 임포트 방지)
  quantity          INT          NOT NULL DEFAULT 1,
  unit_price        INT,                   -- 개당 판매가
  gross_revenue     INT          NOT NULL,

  -- 전환 지표
  days_to_first_sale INT,                  -- 등록 후 첫 판매까지 일수

  -- 구매자 지역 (CSV에서 제공되는 경우)
  buyer_region      TEXT,

  -- 임포트 메타
  imported_from     TEXT,                  -- 'coupang_csv' | 'naver_csv' | 'manual'
  imported_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  import_batch_id   TEXT,                  -- 같은 CSV 업로드를 묶는 ID (롤백용)

  CONSTRAINT sales_events_platform_check
    CHECK (platform IN ('naver', 'coupang'))
);

COMMENT ON TABLE  public.sales_events                      IS 'Layer 3: 판매 발생 기록 (정산 CSV 임포트)';
COMMENT ON COLUMN public.sales_events.platform_order_id    IS '플랫폼 주문번호 — 중복 임포트 방지용 유니크 키';
COMMENT ON COLUMN public.sales_events.import_batch_id      IS '같은 CSV 업로드 묶음 ID — 배치 단위 롤백에 사용';

-- 동일 주문 중복 임포트 방지
CREATE UNIQUE INDEX IF NOT EXISTS uidx_sales_platform_order
  ON public.sales_events (platform, platform_order_id)
  WHERE platform_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_sold_at
  ON public.sales_events (sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_registration
  ON public.sales_events (registration_id);
CREATE INDEX IF NOT EXISTS idx_sales_platform
  ON public.sales_events (platform);
CREATE INDEX IF NOT EXISTS idx_sales_import_batch
  ON public.sales_events (import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- Layer 4: settlements — 정산·수익·CS 기록
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.settlements (
  id                    BIGSERIAL    PRIMARY KEY,
  sale_event_id         BIGINT       REFERENCES public.sales_events(id)
                                     ON DELETE SET NULL,
  settled_at            TIMESTAMPTZ  NOT NULL,

  -- 비용 구조 (정산 CSV 기준)
  channel_fee           INT          NOT NULL,   -- 플랫폼 수수료 (VAT 포함)
  wholesale_cost        INT          NOT NULL,   -- 매입 원가
  shipping_cost         INT          NOT NULL,   -- 실제 배송비
  ad_cost               INT          NOT NULL DEFAULT 0,    -- 키워드 광고비
  promo_discount        INT          NOT NULL DEFAULT 0,    -- 프로모션 할인 부담금

  -- 실수령 수익
  net_profit            INT          NOT NULL,
  real_margin_rate      NUMERIC(5,3) NOT NULL,   -- net_profit / gross_revenue

  -- CS 기록
  cs_inquiries          INT          NOT NULL DEFAULT 0,
  is_returned           BOOLEAN      NOT NULL DEFAULT FALSE,
  return_reason         TEXT,
  return_cost           INT          NOT NULL DEFAULT 0,
  is_exchanged          BOOLEAN      NOT NULL DEFAULT FALSE,

  -- 리뷰 (있을 경우)
  review_rating         NUMERIC(2,1),
  review_text           TEXT,

  -- 임포트 메타
  imported_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  import_batch_id       TEXT,

  CONSTRAINT settlements_margin_range
    CHECK (real_margin_rate BETWEEN -1.000 AND 1.000)
);

COMMENT ON TABLE  public.settlements                        IS 'Layer 4: 정산·순이익·CS 부담 기록 (정산 CSV 임포트)';
COMMENT ON COLUMN public.settlements.real_margin_rate       IS 'net_profit / gross_revenue — 실질 마진율 (소수, 예: 0.150 = 15%)';
COMMENT ON COLUMN public.settlements.import_batch_id        IS '같은 CSV 업로드 묶음 ID — 배치 단위 롤백에 사용';

CREATE INDEX IF NOT EXISTS idx_settlements_settled_at
  ON public.settlements (settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_sale_event
  ON public.settlements (sale_event_id);
CREATE INDEX IF NOT EXISTS idx_settlements_margin
  ON public.settlements (real_margin_rate);
CREATE INDEX IF NOT EXISTS idx_settlements_returned
  ON public.settlements (is_returned) WHERE is_returned = TRUE;
CREATE INDEX IF NOT EXISTS idx_settlements_import_batch
  ON public.settlements (import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 분석 뷰: 추천 → 등록 전환율 (Phase 4-C에서 사용)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.discovery_conversion_view AS
SELECT
  d.channel_source,
  d.grade,
  COUNT(*)                                                          AS total_discovered,
  COUNT(*) FILTER (WHERE d.operator_action = 'registered')         AS registered_count,
  COUNT(*) FILTER (WHERE d.operator_action = 'skipped')            AS skipped_count,
  COUNT(*) FILTER (WHERE d.operator_action = 'bookmarked')         AS bookmarked_count,
  ROUND(
    COUNT(*) FILTER (WHERE d.operator_action = 'registered')::NUMERIC
    / NULLIF(COUNT(*), 0),
    3
  )                                                                 AS conversion_rate,
  ROUND(AVG(d.score_total)::NUMERIC, 1)                            AS avg_score
FROM public.discovery_logs d
GROUP BY d.channel_source, d.grade;

COMMENT ON VIEW public.discovery_conversion_view IS 'Phase 4-C 분석: 채널·등급별 발굴→등록 전환율';

COMMIT;
