-- ============================================================
-- 025_costco_v2_fields.sql
-- costco_products v2 컬럼 추가 및 1.4x 생성 컬럼 제거
--
-- 변경 사항:
--   1. target_sell_price (GENERATED ALWAYS AS price * 1.4) DROP
--   2. v2 개별 스코어 컬럼 추가 (costco_score_*)
--   3. 상품 메타 컬럼 추가 (pack_qty, has_asterisk, expected_turnover_days)
--   4. 분류 컬럼 추가 (male_tier, male_bonus, season_bonus, season_labels, asterisk_bonus)
--   5. 차단·검토 컬럼 추가 (blocked_reason, needs_review)
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. target_sell_price 생성 컬럼 제거 (1.4x 로직 폐기)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.costco_products
  DROP COLUMN IF EXISTS target_sell_price;

-- ──────────────────────────────────────────────────────────────
-- 2. v2 개별 스코어 컬럼 (costco-scoring.ts 결과 저장)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.costco_products
  ADD COLUMN IF NOT EXISTS costco_score_legal     smallint,
  ADD COLUMN IF NOT EXISTS costco_score_price     smallint,
  ADD COLUMN IF NOT EXISTS costco_score_cs        smallint,
  ADD COLUMN IF NOT EXISTS costco_score_margin    smallint,
  ADD COLUMN IF NOT EXISTS costco_score_demand    smallint,
  ADD COLUMN IF NOT EXISTS costco_score_turnover  smallint,
  ADD COLUMN IF NOT EXISTS costco_score_supply    smallint,
  ADD COLUMN IF NOT EXISTS costco_score_total     smallint,
  ADD COLUMN IF NOT EXISTS costco_score_calculated_at timestamptz;

COMMENT ON COLUMN public.costco_products.costco_score_legal    IS 'v2 법적·IP 점수 (0~15)';
COMMENT ON COLUMN public.costco_products.costco_score_price    IS 'v2 가격경쟁력 점수 (0~25)';
COMMENT ON COLUMN public.costco_products.costco_score_cs       IS 'v2 CS안전성 점수 (0~10)';
COMMENT ON COLUMN public.costco_products.costco_score_margin   IS 'v2 마진안전성 점수 (0~20)';
COMMENT ON COLUMN public.costco_products.costco_score_demand   IS 'v2 수요신호 점수 (0~15)';
COMMENT ON COLUMN public.costco_products.costco_score_turnover IS 'v2 재고회전 점수 — 코스트코 전용 (0~10)';
COMMENT ON COLUMN public.costco_products.costco_score_supply   IS 'v2 공급안정성 점수 (0~5)';
COMMENT ON COLUMN public.costco_products.costco_score_total    IS 'v2 종합점수 (0~110, 보너스 포함)';
COMMENT ON COLUMN public.costco_products.costco_score_calculated_at IS 'v2 스코어 마지막 계산 시각';

-- ──────────────────────────────────────────────────────────────
-- 3. 상품 메타 (입수·별표·회전)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.costco_products
  ADD COLUMN IF NOT EXISTS pack_qty               smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS has_asterisk           boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expected_turnover_days smallint;

COMMENT ON COLUMN public.costco_products.pack_qty               IS '입수 단위 (예: 6개입 → 6)';
COMMENT ON COLUMN public.costco_products.has_asterisk           IS '단종·희소 별표(*) 상품 여부';
COMMENT ON COLUMN public.costco_products.expected_turnover_days IS '재고회전 점수 산출 결과 — 예상 소진일수';

-- ──────────────────────────────────────────────────────────────
-- 4. 성별·시즌 분류 (shared/male-classifier.ts 결과)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.costco_products
  ADD COLUMN IF NOT EXISTS male_tier     text,
  ADD COLUMN IF NOT EXISTS male_bonus    smallint,
  ADD COLUMN IF NOT EXISTS season_bonus  smallint,
  ADD COLUMN IF NOT EXISTS season_labels text,
  ADD COLUMN IF NOT EXISTS asterisk_bonus smallint;

COMMENT ON COLUMN public.costco_products.male_tier      IS '성별 타겟 분류: high | mid | neutral | female';
COMMENT ON COLUMN public.costco_products.male_bonus     IS '남성 타겟 보너스 점수 (0, 3, 5)';
COMMENT ON COLUMN public.costco_products.season_bonus   IS '시즌 가산점 (0~10)';
COMMENT ON COLUMN public.costco_products.season_labels  IS '매칭된 시즌 목록 (쉼표 구분)';
COMMENT ON COLUMN public.costco_products.asterisk_bonus IS '별표 상품 보너스 점수 (0 또는 5)';

-- male_tier 값 제약
ALTER TABLE public.costco_products
  DROP CONSTRAINT IF EXISTS costco_products_male_tier_check;
ALTER TABLE public.costco_products
  ADD CONSTRAINT costco_products_male_tier_check
    CHECK (male_tier IS NULL OR male_tier IN ('high', 'mid', 'neutral', 'female'));

-- ──────────────────────────────────────────────────────────────
-- 5. 차단·검토 플래그
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.costco_products
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS needs_review   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.costco_products.blocked_reason IS '소싱 차단 사유 (null = 정상 상품)';
COMMENT ON COLUMN public.costco_products.needs_review   IS '수동 검토 필요 플래그';

COMMIT;
