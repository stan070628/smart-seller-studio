-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Domeggook v2 드롭쉬핑 스코어링 필드
-- 파일: supabase/migrations/023_dropship_scoring_fields.sql
--
-- sourcing_items 테이블에 v2 스코어링/드롭쉬핑 전략 필드 추가:
--   7개 항목 점수, CS 위험 등급, MOQ 묶음 전략, 단가 격차율
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 7개 항목 점수 컬럼
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS score_total      smallint,   -- 종합 점수 (0-100)
  ADD COLUMN IF NOT EXISTS score_legal_ip   smallint,   -- 법적·IP 점수 (0-20)
  ADD COLUMN IF NOT EXISTS score_price_comp smallint,   -- 가격경쟁력 점수 (0-20)
  ADD COLUMN IF NOT EXISTS score_cs_safety  smallint,   -- CS안전성 점수 (0-15)
  ADD COLUMN IF NOT EXISTS score_margin     smallint,   -- 마진 점수 (0-15)
  ADD COLUMN IF NOT EXISTS score_demand     smallint,   -- 수요 점수 (0-15)
  ADD COLUMN IF NOT EXISTS score_supply     smallint,   -- 공급안정성 점수 (0-10)
  ADD COLUMN IF NOT EXISTS score_moq_fit    smallint,   -- MOQ 적합성 점수 (0-5)
  ADD COLUMN IF NOT EXISTS score_calculated_at timestamptz; -- 점수 계산 시각

-- ─────────────────────────────────────────────────────────────────────────
-- CS 위험 등급 컬럼
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS cs_risk_level  text,  -- 'low' | 'medium' | 'high'
  ADD COLUMN IF NOT EXISTS cs_risk_reason text;  -- 위험 사유 (카테고리명 등)

-- ─────────────────────────────────────────────────────────────────────────
-- MOQ 드롭쉬핑 전략 컬럼
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS dropship_moq_strategy  text,    -- 'single' | '1+1' | '2+1'
  ADD COLUMN IF NOT EXISTS dropship_bundle_price  integer, -- 묶음 판매 최소가 (원, break-even)
  ADD COLUMN IF NOT EXISTS dropship_price_gap_rate numeric(6,2); -- 시장가 대비 격차율 (%)

-- ─────────────────────────────────────────────────────────────────────────
-- 코멘트
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.sourcing_items.score_total       IS '7개 항목 합산 종합 점수 (0-100)';
COMMENT ON COLUMN public.sourcing_items.score_legal_ip    IS '법적·IP 점수 (0-20): legal_safe+ip_low 최고';
COMMENT ON COLUMN public.sourcing_items.score_price_comp  IS '가격경쟁력 점수 (0-20): 단가격차율 기반';
COMMENT ON COLUMN public.sourcing_items.score_cs_safety   IS 'CS안전성 점수 (0-15): 카테고리 위험도+판매자평점';
COMMENT ON COLUMN public.sourcing_items.score_margin      IS '마진 점수 (0-15): 마진율 기반';
COMMENT ON COLUMN public.sourcing_items.score_demand      IS '수요 점수 (0-15): 7일 판매량 기반';
COMMENT ON COLUMN public.sourcing_items.score_supply      IS '공급안정성 점수 (0-10): 재고 수량 기반';
COMMENT ON COLUMN public.sourcing_items.score_moq_fit     IS 'MOQ 적합성 점수 (0-5): MOQ=1→5, 2-3→3, 4+→0';
COMMENT ON COLUMN public.sourcing_items.cs_risk_level     IS 'CS 위험 등급: low/medium/high (카테고리 기반)';
COMMENT ON COLUMN public.sourcing_items.cs_risk_reason    IS 'CS 위험 사유 (고위험 카테고리명 등)';
COMMENT ON COLUMN public.sourcing_items.dropship_moq_strategy  IS '묶음 전략: single=단품, 1+1, 2+1';
COMMENT ON COLUMN public.sourcing_items.dropship_bundle_price  IS '묶음 최소 판매가 (도매가×MOQ+배송비) / (1-fee-vat)';
COMMENT ON COLUMN public.sourcing_items.dropship_price_gap_rate IS '단가 격차율 (%) = (시장가-묶음가)/시장가×100';

-- ─────────────────────────────────────────────────────────────────────────
-- 인덱스
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sourcing_items_score_total      ON public.sourcing_items(score_total DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_sourcing_items_cs_risk          ON public.sourcing_items(cs_risk_level);
CREATE INDEX IF NOT EXISTS idx_sourcing_items_dropship_strategy ON public.sourcing_items(dropship_moq_strategy);
