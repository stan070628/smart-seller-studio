-- 069_subdivision.sql
-- product_costs: 소분 기본 설정 + 이월 상태
ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS subdivision_unit               INT,
  ADD COLUMN IF NOT EXISTS subdivision_carryover          INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subdivision_carryover_unit_cost INT NOT NULL DEFAULT 0;

-- cost_entries: 소분 입고 원본 정보 보존
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS purchase_quantity INT,
  ADD COLUMN IF NOT EXISTS subdivision_unit  INT;

COMMENT ON COLUMN product_costs.subdivision_unit IS '기본 소분 갯수. null = 소분 없음';
COMMENT ON COLUMN product_costs.subdivision_carryover IS '이월 잔여 수량';
COMMENT ON COLUMN product_costs.subdivision_carryover_unit_cost IS '이월 개당 원가(원)';
COMMENT ON COLUMN cost_entries.purchase_quantity IS '사입 총량. null = 소분 없음';
COMMENT ON COLUMN cost_entries.subdivision_unit IS '이 건의 소분 갯수';
