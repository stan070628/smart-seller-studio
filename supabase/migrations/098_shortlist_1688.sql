-- ═══════════════════════════════════════════════════════════════════════════
-- 098_shortlist_1688.sql
-- [Render PostgreSQL] Supabase 마이그레이션이 아니다. SOURCING_DATABASE_URL로
-- 접속하는 Render DB 전용이며, Supabase 프로젝트에는 적용되지 않는다.
--
-- 1688 사입 원가. 붙여넣기로 받은 입력값만 저장하고 원가는 조회 시 계산한다.
-- 파생값을 저장하면 관세율 같은 정책값이 바뀔 때 조용히 낡는다.
--
-- 적용: node scripts/migrate-sourcing.mjs 098
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sourcing_shortlist
  ADD COLUMN IF NOT EXISTS buy_krw_total       integer,
  ADD COLUMN IF NOT EXISTS buy_cny_total       numeric(10,2),
  ADD COLUMN IF NOT EXISTS order_qty_1688      integer,
  ADD COLUMN IF NOT EXISTS exchange_rate_1688  numeric(8,2),
  ADD COLUMN IF NOT EXISTS intl_ship_per_unit  integer,
  ADD COLUMN IF NOT EXISTS pasted_at_1688      timestamptz;

COMMENT ON COLUMN public.sourcing_shortlist.buy_krw_total IS
  '1688 결제 확인 화면의 원화 합계. 중국 내 배송비 포함';
COMMENT ON COLUMN public.sourcing_shortlist.buy_cny_total IS
  '1688 결제 확인 화면의 위안화 合计. 표시·감사용';
COMMENT ON COLUMN public.sourcing_shortlist.order_qty_1688 IS
  '1688 주문 총 수량. 도매꾹 기준 order_qty와 별개다';
COMMENT ON COLUMN public.sourcing_shortlist.exchange_rate_1688 IS
  '그 주문에 실제 적용된 환율(₩ ÷ ¥合计). 계산에 쓰지 않고 표시·감사용';
COMMENT ON COLUMN public.sourcing_shortlist.intl_ship_per_unit IS
  '개당 국제배송비 — 배대지 → 한국. 사용자가 직접 입력한다';
COMMENT ON COLUMN public.sourcing_shortlist.pasted_at_1688 IS
  '1688 결제 화면을 마지막으로 붙여넣은 시각';
