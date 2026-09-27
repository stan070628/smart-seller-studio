-- sourcing_offers에 parse_started_at 추가
-- 왜: 판독 중 함수가 죽으면 'parsing'에 묶여 영구히 재시도 불가 — scans와 같은 10분 회수 규칙.
-- 2026-09-27 적용 완료 (대시보드 SQL Editor에서 직접 실행함 — 이 파일은 기록 목적).

ALTER TABLE sourcing_offers ADD COLUMN IF NOT EXISTS parse_started_at timestamptz;
