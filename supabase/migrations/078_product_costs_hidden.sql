ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
