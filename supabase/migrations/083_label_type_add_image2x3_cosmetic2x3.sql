-- label_type CHECK 제약 조건 업데이트
-- 060_label_type 마이그레이션에서 image2x3, cosmetic2x3가 누락됨
-- 두 타입은 코드에 추가됐지만 제약 조건이 없어 저장 시 CHECK 위반으로 500 오류 발생

ALTER TABLE label_templates
  DROP CONSTRAINT IF EXISTS label_templates_label_type_check;

ALTER TABLE label_templates
  ADD CONSTRAINT label_templates_label_type_check
  CHECK (label_type IN ('quality', 'quality2x3', 'event', 'image2x2', 'image2x3', 'nutrition2x3', 'cosmetic2x3'));
