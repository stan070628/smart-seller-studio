BEGIN;

-- 규약: seller_product_id < 0 은 쿠팡 미연동 가상 ID. 실제 쿠팡 ID는 항상 양수.
CREATE SEQUENCE virtual_seller_product_id_seq
  INCREMENT BY -1
  START WITH -1
  MINVALUE -9223372036854775808
  NO CYCLE;

-- DEFAULT 먼저 설정: 백필 중 들어오는 INSERT도 자동으로 가상 ID를 받음 (레이스컨디션 방지)
ALTER TABLE product_costs
  ALTER COLUMN seller_product_id
  SET DEFAULT nextval('virtual_seller_product_id_seq');

-- 기존 NULL 행 백필 (각 행마다 고유한 음수 ID)
UPDATE product_costs
  SET seller_product_id = nextval('virtual_seller_product_id_seq')
WHERE seller_product_id IS NULL;

-- NOT NULL 제약 추가
ALTER TABLE product_costs
  ALTER COLUMN seller_product_id SET NOT NULL;

-- 기존 partial index 교체 → full non-unique index
-- (seller_product_id는 그룹 키: 여러 원가 단위가 같은 값을 가질 수 있으므로 UNIQUE 불가)
DROP INDEX IF EXISTS idx_product_costs_seller_product;
CREATE INDEX product_costs_user_seller_product_id_idx
  ON product_costs (user_id, seller_product_id);

COMMENT ON COLUMN product_costs.seller_product_id IS
  '쿠팡 등록상품ID. 양수=실제 쿠팡 ID, 음수=가상 ID(쿠팡 미연동, virtual_seller_product_id_seq로 생성). NOT NULL.';

COMMIT;
