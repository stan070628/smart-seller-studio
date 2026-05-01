-- Migration 051: 시드 발굴 탭 스키마
-- sourcing_items 에 seed 컬럼 3개 추가
-- seed_sessions 신규 테이블 생성

ALTER TABLE sourcing_items
  ADD COLUMN IF NOT EXISTS seed_keyword    TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seed_score      SMALLINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seed_session_id UUID     DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_sourcing_items_seed_score
  ON sourcing_items (seed_score DESC NULLS LAST)
  WHERE seed_score IS NOT NULL;

CREATE TABLE IF NOT EXISTS seed_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL,
  categories   TEXT[]      NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'in_progress'
                           CHECK (status IN ('in_progress', 'confirmed')),
  step         SMALLINT    NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 7),
  state_json   JSONB       DEFAULT '{}',
  confirmed_at TIMESTAMPTZ,
  winner_count SMALLINT    NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seed_sessions_user_id
  ON seed_sessions (user_id, created_at DESC);
