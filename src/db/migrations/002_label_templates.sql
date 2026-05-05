-- label_templates: 라벨 인쇄 템플릿 저장
create table if not exists label_templates (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  image_url  text        not null default '',
  fields     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 사용자별 조회 인덱스
create index if not exists label_templates_user_id_idx on label_templates(user_id);

-- RLS 활성화
alter table label_templates enable row level security;

-- 본인 데이터만 접근 가능
create policy "Users can manage their own label templates"
  on label_templates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
