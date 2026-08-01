-- ═══════════════════════════════════════════════════════════════════════════
-- 099_order_qty_default_30.sql
-- [Render PostgreSQL] Supabase 마이그레이션이 아니다. SOURCING_DATABASE_URL로
-- 접속하는 Render DB 전용이며, Supabase 프로젝트에는 적용되지 않는다.
--
-- 사입 수량 기본값 10 → 30.
--
-- 개당 배송비 환산 기준이다. 1688에서 2개만 샘플로 사서 붙여넣어도 배송비는
-- 실제 사입 예정 수량으로 나눠야 하는데, 10개 기준이면 국제배송비 최소
-- 구간(0.5kg·4,180원)이 소수에 얹혀 개당 원가가 뻥튀기된다.
--
-- 기존 행도 함께 올린다. 사입 수량이 바뀌면 개당 배송비·실효원가·손익분기가
-- 전부 달라지므로 verified_at을 비워 재검증 큐 앞으로 보낸다 —
-- 낡은 판정을 그대로 두면 화면이 조용히 틀린 값을 보여준다.
--
-- 적용: node scripts/migrate-sourcing.mjs 099
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sourcing_shortlist
  ALTER COLUMN order_qty SET DEFAULT 30;

UPDATE public.sourcing_shortlist
   SET order_qty = 30,
       verified_at = NULL
 WHERE order_qty = 10;

COMMENT ON COLUMN public.sourcing_shortlist.order_qty IS
  '검증 사입 수량. 개당 배송비 환산 기준. 기본 30 (코드의 DEFAULT_ORDER_QTY와 같다)';
