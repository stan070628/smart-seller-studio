-- ═══════════════════════════════════════════════════════════════════════════
-- 095_costco_price_watches.sql
-- [Render PostgreSQL] Supabase 마이그레이션이 아니다. SOURCING_DATABASE_URL로
-- 접속하는 Render DB 전용 테이블이며, Supabase 프로젝트에는 적용되지 않는다.
--
-- 코스트코 매입가 감시 — 세일을 놓치지 않기 위한 임계가 알림 대상.
--
-- 왜 필요한가:
--   코스트코 정품 리셀링은 쿠팡에 시장가가 형성되어 있어 판매가를 올릴 수 없다.
--   마진을 개선할 수 있는 변수는 매입가 하나뿐인데, 세일은 예고 없이 시작하고
--   끝난다. 극세사 타월은 최저 18,799원과 현재 23,990원 사이에 봉지당 1,442원
--   차이가 있고, 이는 월 25만원 규모다.
--
--   로켓그로스 보관비가 개당 10~20원이라 절약액의 1% 미만이므로, 세일 시
--   대량 매입에는 실질 비용이 없다. 감지만 되면 바로 실행할 수 있다.
--
-- 적용: node scripts/migrate-sourcing.mjs 095
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.costco_price_watches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code         text    NOT NULL,
  label                text    NOT NULL,
  threshold_price      integer NOT NULL
    CONSTRAINT costco_price_watches_threshold_check CHECK (threshold_price > 0),
  chat_id              text    NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,

  -- 재알림 억제용. 같은 세일에 매일 알림이 오면 알림 자체를 무시하게 된다.
  last_notified_at     timestamptz,
  last_notified_price  integer,

  memo                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT costco_price_watches_code_chat_key UNIQUE (product_code, chat_id)
);

COMMENT ON TABLE public.costco_price_watches IS
  '코스트코 매입가 감시 대상. 임계가 이하로 내려가면 텔레그램으로 알린다 — 정품 리셀링은 매입가가 유일한 마진 통제 변수다.';

COMMENT ON COLUMN public.costco_price_watches.threshold_price IS
  '이 가격 이하일 때 알린다. 목표 마진율에서 역산한다: 판매가 − 수수료 − 물류비 − 목표마진';
COMMENT ON COLUMN public.costco_price_watches.last_notified_price IS
  '마지막 알림 시점의 가격. 더 싸질 때만 재알림하고, 임계가 위로 오르면 NULL로 리셋한다';

CREATE INDEX IF NOT EXISTS idx_costco_price_watches_active
  ON public.costco_price_watches (product_code)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_costco_price_watches_updated_at ON public.costco_price_watches;
CREATE TRIGGER trg_costco_price_watches_updated_at
  BEFORE UPDATE ON public.costco_price_watches
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- 초기 감시 대상: 커클랜드 다용도타월 36장 (극세사 타월 소분 원본)
--
-- 임계가 21,000원 산출 근거 (2026-07-31 실측):
--   판매가 12,828 − 수수료 1,385(10.8%) − 물류비 1,725 − 목표마진 3,885(30%)
--     = 봉지당 5,833원 → 36장 팩 환산 21,000원
--   현재 23,990원 / 역대 최저 19,990원 / 마진율 20% 붕괴선 25,747원
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.costco_price_watches (product_code, label, threshold_price, chat_id, memo)
VALUES (
  '713160',
  '커클랜드 다용도타월 36장 (극세사 타월 소분 원본)',
  21000,
  '8989165721',
  '봉지당 5,833원 = 마진율 30% 지점. 20% 붕괴선은 25,747원'
)
ON CONFLICT (product_code, chat_id) DO NOTHING;
