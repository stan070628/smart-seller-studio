BEGIN;

CREATE TABLE IF NOT EXISTS product_cost_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  product_cost_id uuid NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  channel_type    text NOT NULL,
  external_id     bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_cost_channels_channel_type_check
    CHECK (channel_type IN ('coupang_rg', 'coupang_wing', 'naver')),
  UNIQUE (user_id, channel_type, external_id)
);

CREATE INDEX IF NOT EXISTS product_cost_channels_product_cost_id_idx
  ON product_cost_channels (product_cost_id);

CREATE INDEX IF NOT EXISTS product_cost_channels_user_channel_idx
  ON product_cost_channels (user_id, channel_type);

-- 백필: product_costs.vendor_item_id → coupang_rg
INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
SELECT user_id, id, 'coupang_rg', vendor_item_id
FROM product_costs
WHERE vendor_item_id IS NOT NULL
ON CONFLICT (user_id, channel_type, external_id) DO NOTHING;

-- 백필: product_costs.naver_channel_product_no → naver
INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
SELECT user_id, id, 'naver', naver_channel_product_no
FROM product_costs
WHERE naver_channel_product_no IS NOT NULL
ON CONFLICT (user_id, channel_type, external_id) DO NOTHING;

-- 백필: product_wing_seller_ids → coupang_wing
INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
SELECT user_id, product_cost_id, 'coupang_wing', seller_product_id
FROM product_wing_seller_ids
ON CONFLICT (user_id, channel_type, external_id) DO NOTHING;

COMMENT ON TABLE product_cost_channels IS
  '원가 단위(product_costs)에 연결된 채널별 외부 ID. channel_type: coupang_rg|coupang_wing|naver';
COMMENT ON COLUMN product_cost_channels.external_id IS
  'coupang_rg=vendor_item_id, coupang_wing=seller_product_id(Wing옵션), naver=naver_channel_product_no';

COMMIT;
