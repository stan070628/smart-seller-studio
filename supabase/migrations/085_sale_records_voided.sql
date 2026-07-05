BEGIN;

ALTER TABLE sale_records
  ADD COLUMN IF NOT EXISTS voided_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN sale_records.voided_at IS
  '취소/반품으로 무효화된 시각. NULL이면 유효 판매. FIFO·집계에서 제외.';

COMMIT;
