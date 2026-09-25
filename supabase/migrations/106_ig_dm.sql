-- 106_ig_dm.sql
-- 인스타 댓글 키워드 → 자동 DM(비공개 답장). 자체 계정(cheongyeon.corp) 전용.
--
-- 규칙은 표로 관리한다 — 릴스를 올릴 때마다 한 줄 추가하면 되고 배포가 필요 없다.
-- 로그의 PK를 comment_id로 둔 이유: Meta는 webhook을 재전송하고, 비공개 답장은 댓글당 1회만 허용된다.
-- 같은 댓글을 두 번 처리하면 두 번째는 API가 거부하므로, 먼저 로그를 선점해 중복 발송을 막는다.

CREATE TABLE IF NOT EXISTS ig_dm_rules (
  id          BIGSERIAL PRIMARY KEY,
  keyword     TEXT        NOT NULL,
  media_id    TEXT,                       -- NULL이면 모든 게시물에 적용. 특정 릴스 전용이면 그 미디어 ID
  link_url    TEXT        NOT NULL,
  link_type   TEXT        NOT NULL CHECK (link_type IN ('partners', 'own', 'other')),
  message     TEXT,                       -- DM 머리말. NULL이면 기본 문구
  label       TEXT,                       -- 사람이 알아볼 이름(상품명 등)
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ig_dm_log (
  comment_id          TEXT        PRIMARY KEY,
  rule_id             BIGINT      REFERENCES ig_dm_rules(id),
  media_id            TEXT,
  commenter_id        TEXT,
  commenter_username  TEXT,
  comment_text        TEXT,
  status              TEXT        NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

-- RLS: 활성화하되 정책 없음. webhook은 service role로 우회한다 (105와 동일)
ALTER TABLE ig_dm_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_dm_log   ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ig_dm_rules_active_idx ON ig_dm_rules (active) WHERE active;
CREATE INDEX IF NOT EXISTS ig_dm_log_rule_idx     ON ig_dm_log (rule_id, created_at);

COMMENT ON COLUMN ig_dm_rules.link_type IS 'partners=쿠팡파트너스(대가성 문구 자동 부착) / own=내 스토어(판매자 표기 부착) / other=문구 없음';
COMMENT ON COLUMN ig_dm_log.status      IS 'pending=선점만 되고 발송 결과가 기록되지 않음(중단 의심) / sent / failed(error 참조). 규칙에 안 맞는 댓글은 기록하지 않는다';
