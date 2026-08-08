-- 영수증 판독 상태 — cron 동시 실행·중단 대응
-- spec 2026-08-08 / plan 3

-- 'parsing'을 CHECK에 추가한다. 제약을 갈아끼우는 것이라 DROP 후 ADD.
ALTER TABLE receipt_drafts DROP CONSTRAINT IF EXISTS receipt_drafts_ocr_status_check;
ALTER TABLE receipt_drafts ADD CONSTRAINT receipt_drafts_ocr_status_check
  CHECK (ocr_status IN ('pending','parsing','parsed','failed'));

-- 시도 횟수. 흐릿한 사진 하나가 무한히 돈을 태우는 것을 막는다
ALTER TABLE receipt_drafts
  ADD COLUMN IF NOT EXISTS parse_attempts int NOT NULL DEFAULT 0
    CHECK (parse_attempts >= 0);

-- 죽은 cron이 묶어둔 초안을 시각으로 회수한다
ALTER TABLE receipt_drafts
  ADD COLUMN IF NOT EXISTS parse_started_at timestamptz;

-- cron이 집을 후보를 고르는 인덱스
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_claimable
  ON receipt_drafts (ocr_status, parse_started_at)
  WHERE ocr_status IN ('pending','parsing');

COMMENT ON COLUMN receipt_drafts.parse_attempts IS 'cron 판독 시도 횟수. 3회에서 failed로 확정';
COMMENT ON COLUMN receipt_drafts.parse_started_at IS 'parsing 진입 시각. 10분 초과 시 회수 대상';
