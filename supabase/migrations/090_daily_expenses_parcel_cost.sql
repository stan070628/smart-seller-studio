-- 090_daily_expenses_parcel_cost.sql
-- daily_expenses에 일별 택배비 컬럼 추가.
-- 정산 탭 택배비를 sale_records.shipping_fee 자동 집계에서 수동 입력으로 전환한다.
-- 기존 parcel_adjustment는 이 전환으로 미사용 처리(스키마엔 잔존).

ALTER TABLE daily_expenses ADD COLUMN IF NOT EXISTS parcel_cost int NOT NULL DEFAULT 0;
COMMENT ON COLUMN daily_expenses.parcel_cost IS '일별 택배비 총액(실제 청구 기준, 수동 입력).';
