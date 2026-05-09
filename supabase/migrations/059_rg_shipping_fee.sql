-- supabase/migrations/059_rg_shipping_fee.sql
-- cost_entries 테이블에 로켓그로스 입고 배송비(단위당) 컬럼 추가
BEGIN;
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS unit_rg_shipping_fee integer NOT NULL DEFAULT 0;
COMMIT;
