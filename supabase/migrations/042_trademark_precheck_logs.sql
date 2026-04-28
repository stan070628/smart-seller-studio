-- 1688 발주 사전체크 audit 로그
-- 채널 spec v2 §6.2 — 사전체크 결과 기록 + 회고 데이터

CREATE TABLE IF NOT EXISTS trademark_precheck_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  title TEXT NOT NULL,
  brand_candidate TEXT,
  status TEXT NOT NULL CHECK (status IN ('safe', 'warning', 'blocked')),
  issue_code TEXT,
  issue_message TEXT,
  issue_detail JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trademark_precheck_logs_user_id
  ON trademark_precheck_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_trademark_precheck_logs_checked_at
  ON trademark_precheck_logs (checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_trademark_precheck_logs_status
  ON trademark_precheck_logs (status);

COMMENT ON TABLE trademark_precheck_logs IS
  '1688 발주 사전체크 KIPRIS 결과 audit. spec 2026-04-27-seller-strategy-v2 §6.2';
