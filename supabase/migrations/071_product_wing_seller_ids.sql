-- Wing 판매 채널의 sellerProductId는 옵션별로 분리됨
-- 1개 product_costs ← N개 seller_product_id 매핑을 지원하는 junction 테이블
CREATE TABLE IF NOT EXISTS product_wing_seller_ids (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid NOT NULL,
  product_cost_id   uuid NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  seller_product_id bigint NOT NULL,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (user_id, seller_product_id)
);

CREATE INDEX IF NOT EXISTS product_wing_seller_ids_user_product_idx
  ON product_wing_seller_ids (user_id, product_cost_id);

-- 기존 product_costs.seller_product_id 데이터를 junction 테이블로 마이그레이션
INSERT INTO product_wing_seller_ids (user_id, product_cost_id, seller_product_id)
SELECT user_id, id, seller_product_id
FROM product_costs
WHERE seller_product_id IS NOT NULL
ON CONFLICT (user_id, seller_product_id) DO NOTHING;
