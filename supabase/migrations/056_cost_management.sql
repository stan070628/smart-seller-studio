-- =============================================
-- 원가관리 3테이블 추가
-- spec 2026-05-09 §3
--
-- 테이블 생성 순서 (FK 의존성 고려)
--   1. shipping_groups  — cost_entries FK 대상이므로 먼저 생성
--   2. product_costs    — cost_entries FK 대상이므로 먼저 생성
--   3. cost_entries     — 위 두 테이블 모두 참조
--
-- 참고: user_id 는 커스텀 auth_users 테이블 기반 (Supabase auth.users 아님)
--       FK 제약 없이 uuid 컬럼으로만 관리 (기존 패턴 동일)
-- =============================================

-- 배송비 그룹 (로켓그로스 공동 배분) — cost_entries FK 대상이므로 먼저 생성
CREATE TABLE IF NOT EXISTS shipping_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  name              text,
  total_shipping_fee int NOT NULL CHECK (total_shipping_fee >= 0),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_groups_user
  ON shipping_groups (user_id, created_at DESC);

-- 상품 마스터
CREATE TABLE IF NOT EXISTS product_costs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  seller_product_id bigint,
  product_name      text NOT NULL,
  platform          text DEFAULT 'coupang',
  platform_fee_rate numeric(5,4) DEFAULT 0.1080 CHECK (platform_fee_rate > 0 AND platform_fee_rate < 1),
  current_stock     int DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_costs_user
  ON product_costs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_costs_seller_product
  ON product_costs (user_id, seller_product_id) WHERE seller_product_id IS NOT NULL;

-- 건별 입고 내역
CREATE TABLE IF NOT EXISTS cost_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  product_cost_id   uuid REFERENCES product_costs(id) ON DELETE CASCADE,
  received_at       date NOT NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_cost         int NOT NULL CHECK (unit_cost >= 0),
  unit_shipping_fee int NOT NULL DEFAULT 0,
  selling_price     int NOT NULL CHECK (selling_price > 0),
  shipping_group_id uuid REFERENCES shipping_groups(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_entries_product
  ON cost_entries (product_cost_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_entries_group
  ON cost_entries (shipping_group_id) WHERE shipping_group_id IS NOT NULL;

COMMENT ON TABLE shipping_groups IS '로켓그로스 배송비 공동 배분 그룹. spec 2026-05-09 §3';
COMMENT ON TABLE product_costs IS '원가관리 상품 마스터. spec 2026-05-09 §3';
COMMENT ON TABLE cost_entries IS '건별 입고 이력. 가중평균 계산 기준. spec 2026-05-09 §3';
