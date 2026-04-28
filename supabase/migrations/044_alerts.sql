-- 알림 통합 테이블
-- spec 2026-04-28-strategy-v2-extension §2.A + §4

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  type TEXT NOT NULL CHECK (type IN (
    'roas_low', 'stock_low', 'negative_review',
    'winner_lost', 'sourcing_recommendation', 'review_milestone',
    'inbound_return_warning', 'channel_distribution'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  sku_code TEXT,
  message TEXT NOT NULL,
  detail JSONB,
  read_at TIMESTAMPTZ,
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_unread
  ON alerts (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_type_severity
  ON alerts (type, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_pending_email
  ON alerts (created_at) WHERE emailed_at IS NULL;

CREATE TABLE IF NOT EXISTS alert_settings (
  user_id UUID PRIMARY KEY,
  email TEXT,
  digest_enabled BOOLEAN NOT NULL DEFAULT true,
  immediate_critical BOOLEAN NOT NULL DEFAULT true,
  type_filters JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE alerts IS '운영 알림 통합 큐. spec 2026-04-28 §2.A + §4';
COMMENT ON TABLE alert_settings IS '사용자별 알림 설정. spec 2026-04-28 §4.4';
