-- sourcing_listings에 최근 6개월 리뷰 필드 추가
-- 왜: 누적 리뷰 수는 한때 잘 팔리다 식은 상품을 "강자"로 오판하게 한다 — 지금 팔리는
-- 속도를 보려면 네이버 상세 페이지 별점 옆 ⓘ가 보여주는 "최근 6개월" 값이 필요하다.
-- ⭐ 후보로 올린 20개 안팎에만 사람이 직접 입력한다(상세 캡처 판독은 하지 않는다).
-- 2026-09-27 적용 완료 (대시보드 SQL Editor에서 직접 실행함 — 이 파일은 기록 목적).

ALTER TABLE sourcing_listings ADD COLUMN IF NOT EXISTS recent6m_review_count int CHECK (recent6m_review_count >= 0);
ALTER TABLE sourcing_listings ADD COLUMN IF NOT EXISTS recent6m_rating numeric(3,2) CHECK (recent6m_rating >= 0 AND recent6m_rating <= 5);
