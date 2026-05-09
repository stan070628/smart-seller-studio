-- sale_records 테이블 신설
-- 입고(cost_entries)와 판매(sale_records)를 분리하여 관리
CREATE TABLE IF NOT EXISTS sale_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid,
  product_cost_id       uuid NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  sold_at               date NOT NULL,
  quantity              integer NOT NULL CHECK (quantity > 0),
  selling_price         integer NOT NULL CHECK (selling_price >= 0),
  channel               text NOT NULL DEFAULT 'manual',
  coupang_order_item_id text UNIQUE,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sale_records_product_cost_id_sold_at_idx
  ON sale_records (product_cost_id, sold_at);
CREATE INDEX IF NOT EXISTS sale_records_user_id_sold_at_idx
  ON sale_records (user_id, sold_at);

-- 기존 cost_entries.selling_price > 0 행을 sale_records로 이전
INSERT INTO sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, channel)
SELECT user_id, product_cost_id, received_at, quantity, selling_price, 'manual'
FROM cost_entries
WHERE selling_price > 0;

-- cost_entries에서 selling_price 제거
ALTER TABLE cost_entries DROP CONSTRAINT IF EXISTS cost_entries_selling_price_check;
ALTER TABLE cost_entries DROP COLUMN IF EXISTS selling_price;
