ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS naver_channel_product_no bigint;

CREATE INDEX IF NOT EXISTS product_costs_naver_channel_product_no_idx
  ON product_costs (user_id, naver_channel_product_no)
  WHERE naver_channel_product_no IS NOT NULL;
