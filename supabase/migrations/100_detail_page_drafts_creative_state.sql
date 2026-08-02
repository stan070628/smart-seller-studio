-- 상세페이지 자동저장이 sections/theme/productName만 담아, 촬영기획·스토리보드·참고자료·
-- 생성된 썸네일(유료 AI 호출 결과)·업로드 이미지·브랜드명/카테고리가 화면 이동 시 유실되는 문제를 막는다.
-- 084/092와 같은 패턴: 기존 컬럼을 건드리지 않는 추가적(non-destructive) jsonb 컬럼.
-- 앞으로도 이런 부가 상태 필드가 늘어날 것을 감안해 필드별 고정 컬럼 대신 확장 가능한 JSON 컬럼 하나로 묶는다.
alter table detail_page_drafts
  add column if not exists creative_state jsonb not null default '{}';
