-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Costco Seasonal Cache
-- 파일: supabase/migrations/018_costco_seasonal_cache.sql
--
-- 네이버 DataLab API 계절성 지수 캐시 테이블
-- 월 1회 갱신, 소싱 스코어 seasonal_score 계산에 사용
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.costco_seasonal_cache (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_group   text         NOT NULL,   -- 카테고리 키워드 그룹 (예: '식품', '전자제품')
  reference_month date         NOT NULL,   -- 기준 월 (항상 1일: 예: 2026-04-01)
  ratio           numeric(5,2) NOT NULL,   -- DataLab 검색량 비율 (0~100)
  seasonal_index  numeric(4,2),            -- 정규화된 계절성 지수 (0~1.0, NULL = 미계산)
  fetched_at      timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (keyword_group, reference_month)
);

CREATE INDEX idx_costco_seasonal_cache_keyword
  ON public.costco_seasonal_cache(keyword_group);
CREATE INDEX idx_costco_seasonal_cache_month
  ON public.costco_seasonal_cache(reference_month DESC);

-- RLS는 Supabase 전용 (Render PostgreSQL에서는 생략)
