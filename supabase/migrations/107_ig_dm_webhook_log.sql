-- 107_ig_dm_webhook_log.sql
-- 인스타 웹훅 수신 요청 기록. Supabase 함수 로그는 대시보드 로그인 없이는 볼 수 없어
-- 서명 실패·구조 불일치를 DB에서 바로 확인하려고 둔다 (2026-09-25 Meta 테스트 이벤트가 ig_dm_log에
-- 안 남는 원인을 찾지 못해 신설). 진단용이므로 본문은 앞 1,000자만 남기고 30일 뒤 지운다.

CREATE TABLE IF NOT EXISTS ig_dm_webhook_log (
  id           BIGSERIAL PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sig_ok       BOOLEAN     NOT NULL,
  http_status  INT         NOT NULL,
  events       INT         NOT NULL DEFAULT 0,   -- 추출된 댓글 이벤트 수(내 댓글 제외 전)
  matched      INT         NOT NULL DEFAULT 0,   -- 규칙에 걸린 수
  note         TEXT,                             -- 처리 요약 (duplicate / sent / failed 등)
  body_head    TEXT                              -- 원문 앞 1,000자
);

ALTER TABLE ig_dm_webhook_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ig_dm_webhook_log_received_idx ON ig_dm_webhook_log (received_at);

COMMENT ON TABLE ig_dm_webhook_log IS '진단용. delete from ig_dm_webhook_log where received_at < now() - interval ''30 days'' 를 주기적으로 돌린다';
