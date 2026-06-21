ALTER TABLE product_cost_channels
  ADD COLUMN unit_multiplier INTEGER NOT NULL DEFAULT 1
  CHECK (unit_multiplier >= 1);

COMMENT ON COLUMN product_cost_channels.unit_multiplier IS
  '판매 1건당 소비되는 단품 개수. 1개입=1(기본), 2개입=2, 3개입=3.';
