-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Niche Chinese Query Cache
-- 파일: supabase/migrations/013_niche_chinese_queries.sql
--
-- 한국어→중국어 검색어 변환 캐시 테이블.
-- Claude API 호출 비용 절감 목적. 동일 키워드 재요청 시 캐시 히트.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.niche_chinese_queries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword         text        NOT NULL UNIQUE,          -- 한국어 원문 키워드
  chinese_queries jsonb       NOT NULL DEFAULT '[]',     -- ["电动滑板车", "电动踏板车", ...]
  model_used      text,                                  -- 생성에 사용된 모델명
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.niche_chinese_queries              IS '한국어→중국어 검색어 변환 캐시. Claude API 호출 비용 절감 목적.';
COMMENT ON COLUMN public.niche_chinese_queries.chinese_queries IS 'Claude가 생성한 중국어 검색어 변형 배열 (3~5개). 간체자.';
COMMENT ON COLUMN public.niche_chinese_queries.model_used   IS '생성에 사용된 모델명. 모델 변경 시 캐시 무효화 판단 기준.';

-- updated_at 자동 갱신 트리거
CREATE TRIGGER trg_niche_chinese_queries_updated_at
  BEFORE UPDATE ON public.niche_chinese_queries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
