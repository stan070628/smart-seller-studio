-- 1688 이미지 번역 캐시 테이블
-- 같은 1688 이미지 URL이 여러 셀러에 의해 import되어도 한 번만 처리하기 위함

create table image_translations (
  image_url_hash text primary key,
  original_url   text not null,
  translated_url text,
  ocr_blocks     jsonb,
  status         text not null check (status in ('ok', 'no_text', 'failed')),
  error_message  text,
  created_at     timestamptz default now()
);

create index image_translations_status_idx on image_translations(status);
create index image_translations_created_at_idx on image_translations(created_at desc);

-- RLS: service_role만 접근. 일반 사용자는 라우트를 통해서만 접근 가능
alter table image_translations enable row level security;

comment on table image_translations is
  '1688 이미지 OCR + 번역 + 합성 결과 캐시. 키는 sha256(original_url)';
comment on column image_translations.ocr_blocks is
  '[{ text_zh, text_ko, bbox: { x, y, w, h } }, ...] 형태. status=ok일 때만 의미 있음';
