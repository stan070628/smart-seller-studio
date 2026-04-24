-- 자동 등록 수정 기록 테이블
-- AI 제시 값과 사용자 승인 값의 차이를 추적하여 향후 AI 모델 개선에 활용
CREATE TABLE IF NOT EXISTS auto_register_corrections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type    text NOT NULL CHECK (source_type IN ('domeggook', 'costco')),
  field_name     text NOT NULL,
  ai_value       text,
  accepted_value text,
  was_corrected  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 소스 타입과 필드별 조회 성능 최적화
CREATE INDEX idx_auto_register_corrections_source_field
  ON auto_register_corrections (source_type, field_name, created_at DESC);
