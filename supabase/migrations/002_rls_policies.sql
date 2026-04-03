-- =============================================
-- RLS 정책 정의
-- Wave 4: 다중 사용자 데이터 격리 보안 강화
-- Supabase Dashboard SQL Editor에서 실행
-- =============================================

-- profiles 테이블 RLS 정책
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- projects 테이블 RLS 정책
CREATE POLICY "projects_select_own" ON public.projects
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "projects_insert_own" ON public.projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "projects_delete_own" ON public.projects
  FOR DELETE USING (auth.uid() = user_id);

-- assets 테이블 RLS 정책
CREATE POLICY "assets_select_own" ON public.assets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "assets_insert_own" ON public.assets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "assets_delete_own" ON public.assets
  FOR DELETE USING (auth.uid() = user_id);

-- ai_results 테이블: 프로젝트 소유자만 접근
CREATE POLICY "ai_results_select_own" ON public.ai_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = ai_results.project_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_results_insert_own" ON public.ai_results
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = ai_results.project_id
      AND p.user_id = auth.uid()
    )
  );
