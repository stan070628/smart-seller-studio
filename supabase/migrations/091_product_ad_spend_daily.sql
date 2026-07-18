-- 091_product_ad_spend_daily.sql
-- 상품별 날짜별 수동 광고비 테이블 (광고비 단일 소스).
-- Render PostgreSQL (SOURCING_DATABASE_URL) 에 적용. user_id 는 FK 없이 uuid
-- (기존 product_ad_spend / product_costs 패턴 동일).

CREATE TABLE IF NOT EXISTS product_ad_spend_daily (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  product_id   UUID NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  ad_date      DATE NOT NULL,
  ad_spend     NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, ad_date)
);

CREATE INDEX IF NOT EXISTS product_ad_spend_daily_user_date_idx
  ON product_ad_spend_daily (user_id, ad_date);

CREATE INDEX IF NOT EXISTS product_ad_spend_daily_user_product_date_idx
  ON product_ad_spend_daily (user_id, product_id, ad_date);

COMMENT ON TABLE product_ad_spend_daily IS '상품별 날짜별 수동 광고비 (광고비 단일 소스). spec 2026-07-18';

CREATE TRIGGER trg_product_ad_spend_daily_updated_at
  BEFORE UPDATE ON product_ad_spend_daily
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 기존 월별 광고비(product_ad_spend) 이관: 월 총액을 그달 1일자 한 건으로.
-- 날짜 정보가 없어 1일로 귀속(정산은 신규 기능이라 실무 영향 없음, 기간 합계 보존).
INSERT INTO product_ad_spend_daily (user_id, product_id, ad_date, ad_spend)
SELECT user_id, product_id, (year_month || '-01')::date, ad_spend
FROM product_ad_spend
WHERE ad_spend > 0
ON CONFLICT (user_id, product_id, ad_date) DO NOTHING;
