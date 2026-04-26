-- 038_generated_assets.sql
-- "썸네일·상세만 만들기" 탭에서 생성한 자산을 영구 보관

CREATE TABLE IF NOT EXISTS generated_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type     text NOT NULL CHECK (source_type IN ('url', 'upload')),
  source_url      text,
  thumbnails      text[] NOT NULL DEFAULT '{}',
  detail_html     text,
  detail_image    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS generated_assets_user_created_idx
  ON generated_assets(user_id, created_at DESC);

ALTER TABLE generated_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "본인 데이터만"
  ON generated_assets
  FOR ALL
  USING (auth.uid() = user_id);
