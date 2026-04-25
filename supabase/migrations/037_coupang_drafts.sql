-- coupang_drafts: 쿠팡 임시저장 테이블
-- 사용자가 "임시저장" 버튼을 누르면 여기에 저장하고, 검토 후 "쿠팡에 제출"을 누르면 실제 API 호출

CREATE TABLE coupang_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name    text NOT NULL DEFAULT '',
  source_url      text,
  source_type     text DEFAULT 'manual',
  draft_data      jsonb NOT NULL DEFAULT '{}',
  status          text DEFAULT 'draft',       -- 'draft' | 'submitted'
  seller_product_id bigint,
  wings_url       text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX ON coupang_drafts(user_id, created_at DESC);
ALTER TABLE coupang_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "본인 데이터만" ON coupang_drafts FOR ALL USING (auth.uid() = user_id);
