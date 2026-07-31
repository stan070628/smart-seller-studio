-- PRO 촬영 세션 상태(촬영 가이드 + 컷별 업로드 진행)를 담는 jsonb.
-- 084 detail_page_drafts 확장. 추가/비파괴적(default '{}').
alter table detail_page_drafts
  add column if not exists shoot_session jsonb not null default '{}';
