-- selling_price 제약 완화: > 0 → >= 0 (판매가 미설정 입고 허용)
ALTER TABLE cost_entries DROP CONSTRAINT IF EXISTS cost_entries_selling_price_check;
ALTER TABLE cost_entries ADD CONSTRAINT cost_entries_selling_price_check CHECK (selling_price >= 0);
