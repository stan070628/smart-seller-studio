-- 쿠팡 등록 이력 테이블
CREATE TABLE coupang_registered_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_product_id bigint NOT NULL,
  seller_product_name text NOT NULL,
  source_url        text,
  source_type       text DEFAULT 'manual',
  wings_status      text DEFAULT 'UNDER_REVIEW',
  created_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX ON coupang_registered_products(user_id, created_at DESC);

ALTER TABLE coupang_registered_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "본인 데이터만" ON coupang_registered_products
  FOR ALL USING (auth.uid() = user_id);
