-- ═══════════════════════════════════════════════════════════════
-- 031_listing_image_upload.sql
-- 상품 등록 이미지 업로드 지원을 위한 assets 테이블 스키마 확장
--
-- 변경 사항:
--   1. assets.project_id — NOT NULL → NULL 허용
--      (listing 이미지는 특정 프로젝트에 종속되지 않음)
--   2. assets.usage_context 컬럼 추가
--      허용값: 'editor' | 'listing_thumbnail' | 'listing_detail'
--   3. (user_id, usage_context) 복합 인덱스 추가
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. assets.project_id — NOT NULL 제약 및 FK 재설정
--    기존: NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
--    변경: NULLABLE REFERENCES public.projects(id) ON DELETE CASCADE
-- ─────────────────────────────────────────────────────────────

-- NOT NULL 제약 해제 (FK는 유지)
ALTER TABLE public.assets
  ALTER COLUMN project_id DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. usage_context 컬럼 추가
--    기존 에디터 업로드 레코드는 'editor'로 채움
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS usage_context text
    NOT NULL DEFAULT 'editor'
    CHECK (usage_context IN ('editor', 'listing_thumbnail', 'listing_detail'));

COMMENT ON COLUMN public.assets.usage_context IS
  '이미지 사용 목적: editor=상품 에디터, listing_thumbnail=상품 대표 이미지, listing_detail=상품 상세 이미지';

-- ─────────────────────────────────────────────────────────────
-- 3. (user_id, usage_context) 복합 인덱스
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_assets_usage_context
  ON public.assets (user_id, usage_context);

COMMIT;
