-- 040_naver_drafts.sql
-- 네이버 스마트스토어 임시저장 테이블
-- coupang_drafts(037)와 동일한 구조

CREATE TABLE naver_drafts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name            text NOT NULL DEFAULT '',
  source_url              text,
  source_type             text DEFAULT 'manual',
  draft_data              jsonb NOT NULL DEFAULT '{}',
  status                  text DEFAULT 'draft',          -- 'draft' | 'submitted'
  naver_origin_product_no bigint,
  naver_channel_product_no bigint,
  smartstore_url          text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

CREATE INDEX ON naver_drafts(user_id, created_at DESC);
ALTER TABLE naver_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "본인 데이터만" ON naver_drafts FOR ALL USING (auth.uid() = user_id);
