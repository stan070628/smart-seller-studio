-- 영수증 이미지 보관 기간 — 확정 여부와 무관하게 3개월
-- 공개 버킷을 쓰기로 한 결정(스펙 §7) 때문에 오래 둘수록 노출 창이 길어진다.
-- 판독 결과(raw_ocr)와 줄 데이터는 남으므로 이미지를 지워도 근거는 유지된다.

ALTER TABLE receipt_drafts
  ADD COLUMN IF NOT EXISTS images_purged_at timestamptz;

COMMENT ON COLUMN receipt_drafts.images_purged_at IS
  '이미지 삭제 시각. 값이 있으면 image_paths는 비어 있고 raw_ocr만 남는다';

-- 삭제 대상을 고르는 인덱스
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_purgeable
  ON receipt_drafts (created_at)
  WHERE images_purged_at IS NULL;
