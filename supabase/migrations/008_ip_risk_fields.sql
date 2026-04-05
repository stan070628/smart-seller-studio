-- 마이그레이션: sourcing_items 테이블에 IP(지식재산권) 리스크 검증 컬럼 추가
-- 관련 API: POST /api/sourcing/verify-ip (KIPRIS 상표/특허/디자인 검색)

ALTER TABLE sourcing_items
  ADD COLUMN IF NOT EXISTS ip_risk_level   TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ip_checked_at   TIMESTAMPTZ   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ip_details      JSONB         DEFAULT NULL;

-- ip_risk_level 값 도메인 제약: 'low', 'medium', 'high' 또는 NULL
ALTER TABLE sourcing_items
  ADD CONSTRAINT chk_ip_risk_level
    CHECK (ip_risk_level IN ('low', 'medium', 'high') OR ip_risk_level IS NULL);

-- ip_risk_level 필터링/정렬 성능을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_sourcing_items_ip_risk_level
  ON sourcing_items (ip_risk_level)
  WHERE ip_risk_level IS NOT NULL;

COMMENT ON COLUMN sourcing_items.ip_risk_level  IS 'KIPRIS IP 리스크 등급: low=관련 IP 없음, medium=유사 IP 존재, high=등록 IP와 충돌';
COMMENT ON COLUMN sourcing_items.ip_checked_at  IS '마지막 KIPRIS 검증 시각 (UTC)';
COMMENT ON COLUMN sourcing_items.ip_details     IS 'KIPRIS 검색 결과 요약 JSON {trademark, patent, design}';
