-- 089_daily_expenses.sql
-- 일별 수동 비용 (광고비·박스비·택배비 정산차). 하루 한 행 × 항목별 컬럼.
-- user_id 는 FK 없이 uuid (기존 커스텀 auth_users 패턴, product_ad_spend와 동일).

CREATE TABLE IF NOT EXISTS daily_expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  expense_date      DATE NOT NULL,
  ad_spend          INT NOT NULL DEFAULT 0,
  box_cost          INT NOT NULL DEFAULT 0,
  box_memo          TEXT,
  parcel_adjustment INT NOT NULL DEFAULT 0,
  memo              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, expense_date)
);

CREATE INDEX IF NOT EXISTS daily_expenses_user_date_idx
  ON daily_expenses (user_id, expense_date DESC);

COMMENT ON TABLE daily_expenses IS '일별 수동 비용 (광고비·박스비·택배비 정산차). spec 2026-07-17';
COMMENT ON COLUMN daily_expenses.box_cost IS '박스 구매액. 구매한 날에만 값(구매 시점 일괄 비용).';
COMMENT ON COLUMN daily_expenses.parcel_adjustment IS '실제 택배 청구서와의 차액. 음수 허용.';

CREATE TRIGGER trg_daily_expenses_updated_at
  BEFORE UPDATE ON daily_expenses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: 활성화하되 정책 없음. 서버 API는 owner 연결로 우회, Supabase 클라이언트
-- 직접 접근만 차단(054 negotiation_logs 원칙).
ALTER TABLE daily_expenses ENABLE ROW LEVEL SECURITY;
