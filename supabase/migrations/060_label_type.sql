-- label_templates 테이블에 label_type 컬럼 추가
-- 지원 타입: quality, quality2x3, event, image2x2, nutrition2x3
BEGIN;

ALTER TABLE label_templates
  ADD COLUMN IF NOT EXISTS label_type TEXT NOT NULL DEFAULT 'quality'
    CHECK (label_type IN ('quality', 'quality2x3', 'event', 'image2x2', 'image2x3', 'nutrition2x3', 'cosmetic2x3'));

-- user_id + label_type 복합 인덱스 — 타입별 템플릿 목록 조회 성능 확보
CREATE INDEX IF NOT EXISTS idx_label_templates_user_type
  ON label_templates (user_id, label_type);

COMMIT;
