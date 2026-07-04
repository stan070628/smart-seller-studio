-- 상세페이지 편집 드래프트 (자동저장)
-- user_id FK 없음: 앱이 Render 자체 auth_users를 사용하므로 auth.users 참조 FK는 삽입을 막음 (061/063 패턴)
create table if not exists detail_page_drafts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  listing_id    uuid,
  product_name  text,
  sections      jsonb not null default '[]',
  theme         jsonb not null default '{}',
  thumbnail_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists detail_page_drafts_user_updated
  on detail_page_drafts (user_id, updated_at desc);

alter table detail_page_drafts enable row level security;
create policy "service role full access" on detail_page_drafts using (true) with check (true);
