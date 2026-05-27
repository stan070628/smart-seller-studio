-- cost_entries, sale_records에 variant_name 추가 (nullable, 하위 호환)
ALTER TABLE cost_entries  ADD COLUMN IF NOT EXISTS variant_name text;
ALTER TABLE sale_records  ADD COLUMN IF NOT EXISTS variant_name text;

-- product_costs에 variants 캐시 (vendorItemId → variant_name JSON 맵)
ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS variants jsonb;
-- 예: {"95304537912": "화이트 S", "95304537913": "화이트 M", ...}
