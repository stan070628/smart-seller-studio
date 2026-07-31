-- ═══════════════════════════════════════════════════════════════════════════
-- 094_sourcing_shortlist.sql
-- 소싱 쇼트리스트 — 검증을 통과한 후보를 담아두고 상태를 추적한다.
--
-- sourcing_items(45만건 수집 풀)와 분리하는 이유:
--   1. 수명주기가 다르다. 수집 풀은 매일 갱신되지만 쇼트리스트는 직접 고른 수십 건이다.
--   2. 도매꾹에서 삭제된 상품도 리스트에는 남아야 한다. 왜 탈락했는지 기록이 없으면
--      같은 후보를 다시 뽑는다.
--
-- 적용: node scripts/migrate-sourcing.mjs 094
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sourcing_shortlist (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_no            integer NOT NULL UNIQUE,
  title              text    NOT NULL,
  memo               text,
  added_at           timestamptz NOT NULL DEFAULT now(),

  -- 도매꾹 실시간 스냅샷
  dome_status        text,
  dome_price         integer,
  dome_inventory     integer,
  dome_moq           integer,

  -- 배송비 정책 (deli 필드 파싱 결과)
  deli_is_free       boolean,
  deli_type          text,
  deli_unit_qty      integer,
  deli_fee           integer,

  -- 쿠팡 시세 추정
  coupang_p25        integer,
  coupang_sample_n   smallint,

  -- 판정
  order_qty          integer NOT NULL DEFAULT 10,
  unit_deli_fee      integer,
  effective_cost     integer,
  logistics_size     text    NOT NULL DEFAULT 'xsmall',
  break_even_price   integer,
  margin             integer,
  margin_rate        numeric(5,1),
  verdict            text,
  verified_at        timestamptz,

  is_archived        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.sourcing_shortlist.order_qty      IS '검증 사입 수량. 개당 배송비 환산 기준';
COMMENT ON COLUMN public.sourcing_shortlist.unit_deli_fee  IS '개당 배송비 (order_qty 기준 파생값)';
COMMENT ON COLUMN public.sourcing_shortlist.effective_cost IS '도매가 + 개당 배송비';
COMMENT ON COLUMN public.sourcing_shortlist.verdict        IS 'pass|fail|dead|unknown. unknown은 표본부족으로 판정 불가';

CREATE INDEX IF NOT EXISTS idx_shortlist_verdict  ON public.sourcing_shortlist(verdict);
CREATE INDEX IF NOT EXISTS idx_shortlist_archived ON public.sourcing_shortlist(is_archived);

-- updated_at 자동 갱신 (001_initial_schema.sql에서 만든 함수 재사용)
DROP TRIGGER IF EXISTS trg_sourcing_shortlist_updated_at ON public.sourcing_shortlist;
CREATE TRIGGER trg_sourcing_shortlist_updated_at
  BEFORE UPDATE ON public.sourcing_shortlist
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
