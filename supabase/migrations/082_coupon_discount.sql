BEGIN;

ALTER TABLE sale_records
  ADD COLUMN coupon_discount INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_costs
  ADD COLUMN download_coupon_policy JSONB;

COMMENT ON COLUMN sale_records.coupon_discount IS
  '임포트 시점 계산된 쿠폰 할인 합계(원). 즉시할인쿠폰 + 다운로드쿠폰. effective_price = selling_price - coupon_discount.';

COMMENT ON COLUMN product_costs.download_coupon_policy IS
  '다운로드쿠폰 정책: {"rate": 0.10, "max_discount": 1000, "min_price": 30000}. null이면 쿠폰 없음.';

COMMIT;
