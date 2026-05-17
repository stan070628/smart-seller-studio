-- cost_entries.quantity를 소수점 1자리 지원으로 변경
ALTER TABLE cost_entries
  ALTER COLUMN quantity TYPE numeric(10,1) USING quantity::numeric(10,1);

ALTER TABLE cost_entries
  DROP CONSTRAINT IF EXISTS cost_entries_quantity_check;

ALTER TABLE cost_entries
  ADD CONSTRAINT cost_entries_quantity_check CHECK (quantity > 0);
