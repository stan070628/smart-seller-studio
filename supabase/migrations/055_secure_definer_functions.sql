-- =============================================
-- 트리거 함수 보안 강화
-- 대응: Supabase Security Advisor warn 항목
--   * function_search_path_mutable (handle_updated_at)
--   * anon_security_definer_function_executable (handle_new_user)
--   * authenticated_security_definer_function_executable (handle_new_user)
--
-- 원칙
--   * 두 함수는 트리거 본체로만 호출되며 PostgREST RPC로 노출될 필요가 없음
--   * search_path 를 명시적으로 고정해 객체 해석 우회 차단
--   * anon / authenticated / PUBLIC 의 EXECUTE 권한 회수, service_role+postgres만 유지
-- =============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. handle_updated_at: search_path 고정
-- ─────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. EXECUTE 권한 회수 (트리거 함수는 RPC 노출 불필요)
-- ─────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()   FROM PUBLIC, anon, authenticated;
