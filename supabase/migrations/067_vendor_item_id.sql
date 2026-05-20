BEGIN;

ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS vendor_item_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS product_costs_user_vendor_item_id_idx
  ON product_costs (user_id, vendor_item_id) WHERE vendor_item_id IS NOT NULL;

COMMIT;
