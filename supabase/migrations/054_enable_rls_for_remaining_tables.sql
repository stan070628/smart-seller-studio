-- =============================================
-- Wave 4 보강: public 스키마 RLS 일괄 활성화
-- 대응: Supabase Security Advisor `rls_disabled_in_public` (CRITICAL)
--
-- 정책 원칙
--   * user_id 컬럼 보유 12개 테이블: RLS ON + `auth.uid() = user_id` ALL 정책
--   * 사용자 식별자 없는 공통 테이블(negotiation_logs): RLS ON + 정책 없음
--     → anon/authenticated 직접 접근 차단, 서버 API의 service_role 키만 접근 가능
--
-- 멱등성: ALTER TABLE ... ENABLE RLS는 멱등. CREATE POLICY는 DROP IF EXISTS로 보호.
-- =============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1-A. user_id 가 uuid 타입인 테이블 (11개) — 직접 비교
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'alert_settings',
      'alerts',
      'channel_distribution',
      'cs_inquiries',
      'dashboard_metrics_cache',
      'inbound_returns',
      'keyword_optimizations',
      'review_milestones',
      'sourcing_recommendations',
      'trademark_precheck_logs',
      'winner_history'
    ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "본인 데이터만" ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY "본인 데이터만" ON public.%I
         FOR ALL
         USING (auth.uid() = user_id)
         WITH CHECK (auth.uid() = user_id)',
      tbl
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1-B. user_id 가 text 타입인 테이블 (1개: ad_strategy_cache) — text로 캐스팅
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ad_strategy_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "본인 데이터만" ON public.ad_strategy_cache;
CREATE POLICY "본인 데이터만" ON public.ad_strategy_cache
  FOR ALL
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. 사용자 식별자 없는 공통 테이블 (1개)
--    RLS만 활성화하여 anon/authenticated 차단. service_role 키는 RLS 우회하므로
--    서버 API는 정상 동작.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.negotiation_logs ENABLE ROW LEVEL SECURITY;
