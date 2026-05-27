-- 074_product_ad_spend.sql
-- 상품별 월별 수동 광고비 테이블
-- product_costs 와 동일하게 Render PostgreSQL (SOURCING_DATABASE_URL) 에 적용
-- user_id 는 FK 없이 uuid 로만 관리 (기존 product_costs 패턴 동일)

CREATE TABLE IF NOT EXISTS product_ad_spend (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  product_id   UUID NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  year_month   CHAR(7) NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),
  ad_spend     NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, year_month)
);

CREATE INDEX IF NOT EXISTS product_ad_spend_user_product_idx
  ON product_ad_spend (user_id, product_id);

CREATE INDEX IF NOT EXISTS product_ad_spend_user_month_idx
  ON product_ad_spend (user_id, year_month);

COMMENT ON TABLE product_ad_spend IS '상품별 월별 수동 광고비 입력 이력';
COMMENT ON COLUMN product_ad_spend.year_month IS 'YYYY-MM 형식, 예: 2026-05';

CREATE TRIGGER trg_product_ad_spend_updated_at
  BEFORE UPDATE ON product_ad_spend
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
