-- sourcing_listings에 네이버 상품 URL 추가
-- 왜: 네이버 쇼핑 목록 캡처에는 상품 페이지 주소가 찍히지 않는다 — 검색 링크로
-- 대신할 수는 있지만 정확한 주소는 아니다. ⭐ 후보 20개만 사람이 정확한 주소를
-- 남겨 제출 목록에 싣는다(1688 URL을 별도 입력칸으로 받는 것과 같은 이유).
-- 2026-09-27 적용 완료 (대시보드 SQL Editor에서 직접 실행함 — 이 파일은 기록 목적).

ALTER TABLE sourcing_listings ADD COLUMN IF NOT EXISTS naver_url text CHECK (naver_url ~ '^https?://');
