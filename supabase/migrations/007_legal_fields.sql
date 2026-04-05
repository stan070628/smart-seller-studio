-- ============================================================
-- 007: Legal 방어 로직용 컬럼 추가
-- Layer 1: KC 인증 체크
-- Layer 2: 플랫폼 금지어 필터
-- Layer 3: KIPRIS 상표 조회
-- ============================================================

-- sourcing_items 에 법적 검토 상태 컬럼 추가
ALTER TABLE sourcing_items
  ADD COLUMN IF NOT EXISTS legal_status text DEFAULT 'unchecked'
    CHECK (legal_status IN ('blocked', 'warning', 'safe', 'unchecked')),
  ADD COLUMN IF NOT EXISTS legal_issues jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS legal_checked_at timestamptz;

-- legal_issues JSON 구조 예시:
-- [
--   {
--     "layer": "kc",
--     "severity": "RED",
--     "code": "KC_REQUIRED_NO_CERT",
--     "message": "KC 인증 필수 품목이나 인증 정보가 없습니다",
--     "detail": { "keyword": "유아용품", "safetyCert": null }
--   },
--   {
--     "layer": "banned",
--     "severity": "YELLOW",
--     "code": "EXAGGERATION",
--     "message": "과장광고 의심 표현: '100% 완치'",
--     "detail": { "matched": "100% 완치" }
--   },
--   {
--     "layer": "trademark",
--     "severity": "YELLOW",
--     "code": "TRADEMARK_CAUTION",
--     "message": "등록상표 발견: 'XXX' (출원번호: 1234567)",
--     "detail": { "word": "XXX", "applicationNumber": "1234567" }
--   }
-- ]

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sourcing_items_legal_status
  ON sourcing_items (legal_status);

COMMENT ON COLUMN sourcing_items.legal_status IS
  'blocked=판매불가, warning=주의필요, safe=안전, unchecked=미검사';
COMMENT ON COLUMN sourcing_items.legal_issues IS
  'Layer별 법적 이슈 배열 (kc, banned, trademark)';
COMMENT ON COLUMN sourcing_items.legal_checked_at IS
  '마지막 법적 검토 시각';
