-- 068_cost_entries_channel.sql
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'wing';

-- 기존 데이터 자동 분류: RG 배송비가 있으면 RG 입고, 없으면 윙 입고
UPDATE cost_entries SET channel = 'rg'   WHERE unit_rg_shipping_fee > 0;
UPDATE cost_entries SET channel = 'wing' WHERE unit_rg_shipping_fee = 0;
