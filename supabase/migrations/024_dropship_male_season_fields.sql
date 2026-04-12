-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - 남성 타겟·시즌·차단 필드 추가
-- 파일: supabase/migrations/024_dropship_male_season_fields.sql
--
-- sourcing_items 테이블에 v2 보너스 시스템 필드 추가:
--   남성 타겟 분류, 시즌 가산점, 차단 사유, 리뷰 필요 여부
--   시장가 데이터 (네이버/쿠팡), 드롭쉬핑 지원 여부
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 남성 타겟 분류
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS male_tier    text,    -- 'high' | 'mid' | 'neutral' | 'female'
  ADD COLUMN IF NOT EXISTS male_score   smallint, -- 분류 점수 (raw)
  ADD COLUMN IF NOT EXISTS male_bonus   smallint; -- 스코어 가산점 (0, 3, 5)

-- ─────────────────────────────────────────────────────────────────────────
-- 시즌 가산점
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS season_bonus  smallint, -- 가산점 (0-10)
  ADD COLUMN IF NOT EXISTS season_labels text;      -- 매칭된 시즌 이름 (쉼표 구분)

-- ─────────────────────────────────────────────────────────────────────────
-- 차단·검토 상태
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS blocked_reason text,     -- 차단 사유 (null = 정상)
  ADD COLUMN IF NOT EXISTS needs_review   boolean NOT NULL DEFAULT false; -- 셀러 검토 필요

-- ─────────────────────────────────────────────────────────────────────────
-- 시장가 데이터 (네이버/쿠팡)
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS naver_lowest_price  integer, -- 네이버 최저가 (원)
  ADD COLUMN IF NOT EXISTS naver_avg_price     integer, -- 네이버 평균가 (원)
  ADD COLUMN IF NOT EXISTS naver_seller_count  smallint, -- 네이버 판매자 수
  ADD COLUMN IF NOT EXISTS coupang_lowest_price integer, -- 쿠팡 최저가 (원)
  ADD COLUMN IF NOT EXISTS has_rocket          boolean,  -- 쿠팡 로켓배송 존재 여부
  ADD COLUMN IF NOT EXISTS market_updated_at   timestamptz; -- 시장가 최종 갱신

-- ─────────────────────────────────────────────────────────────────────────
-- 드롭쉬핑 공급자 정보
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS supports_dropship  boolean NOT NULL DEFAULT true, -- 직배송 가능
  ADD COLUMN IF NOT EXISTS dropship_fee       integer, -- 드롭쉬핑 추가 수수료 (원)
  ADD COLUMN IF NOT EXISTS alternative_sellers smallint, -- 동일 상품 대체 공급선 수
  ADD COLUMN IF NOT EXISTS seller_rating      numeric(3,2), -- 판매자 평점 (0.00~5.00)
  ADD COLUMN IF NOT EXISTS seller_years       smallint; -- 판매자 가입 연수

-- ─────────────────────────────────────────────────────────────────────────
-- 코멘트
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.sourcing_items.male_tier          IS '남성 타겟 등급: high/mid/neutral/female (shared/male-classifier.ts)';
COMMENT ON COLUMN public.sourcing_items.male_bonus         IS '스코어 남성 보너스: high=5, mid=3, neutral=0';
COMMENT ON COLUMN public.sourcing_items.season_bonus       IS '시즌 가산점 (최대 10, 1시즌만 적용)';
COMMENT ON COLUMN public.sourcing_items.season_labels      IS '매칭된 시즌명 쉼표 구분 (예: 크리스마스,겨울캠핑)';
COMMENT ON COLUMN public.sourcing_items.blocked_reason     IS '차단 사유: 법적금지/고위험CS/MOQ4+ (null=정상)';
COMMENT ON COLUMN public.sourcing_items.needs_review       IS '셀러 검토 필요: 전동공구·보충제 등 인증 확인 필요';
COMMENT ON COLUMN public.sourcing_items.has_rocket         IS '쿠팡 로켓배송 상품 경쟁 여부 (공급 안정성 페널티)';
COMMENT ON COLUMN public.sourcing_items.supports_dropship  IS '드롭쉬핑(직배송) 가능 여부 (도매꾹 market.supply)';
COMMENT ON COLUMN public.sourcing_items.alternative_sellers IS '동일 상품 대체 공급선 수 (공급 안정성 지표)';

-- ─────────────────────────────────────────────────────────────────────────
-- 인덱스
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sourcing_items_male_tier      ON public.sourcing_items(male_tier);
CREATE INDEX IF NOT EXISTS idx_sourcing_items_blocked_reason ON public.sourcing_items(blocked_reason) WHERE blocked_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sourcing_items_needs_review   ON public.sourcing_items(needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS idx_sourcing_items_supports_drop  ON public.sourcing_items(supports_dropship);
