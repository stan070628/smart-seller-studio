-- label_templates 테이블에 label_type 컬럼 추가
-- 지원 타입: quality (품질표시), event (이벤트 카드), image2x2 (이미지 2×2), nutrition2x3 (영양정보 2×3)
ALTER TABLE label_templates
  ADD COLUMN IF NOT EXISTS label_type TEXT NOT NULL DEFAULT 'quality';

-- user_id + label_type 복합 인덱스 — 타입별 템플릿 목록 조회 성능 확보
CREATE INDEX IF NOT EXISTS idx_label_templates_user_type
  ON label_templates (user_id, label_type);
