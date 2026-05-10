create table if not exists assets_drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  draft_data  jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists assets_drafts_user_created
  on assets_drafts (user_id, created_at desc);

alter table assets_drafts enable row level security;
create policy "본인 데이터만" on assets_drafts for all using (auth.uid() = user_id);
