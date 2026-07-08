BEGIN;

-- label_type CHECK 제약에 image3x3 추가 (3×3 이미지 라벨, 9장)
-- 083까지 있던 타입 + image3x3
ALTER TABLE label_templates
  DROP CONSTRAINT IF EXISTS label_templates_label_type_check;

ALTER TABLE label_templates
  ADD CONSTRAINT label_templates_label_type_check
  CHECK (label_type IN ('quality', 'quality2x3', 'event', 'image2x2', 'image2x3', 'image3x3', 'nutrition2x3', 'cosmetic2x3'));

COMMIT;
