-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Seller Studio - Initial Schema Migration
-- 파일: supabase/migrations/001_initial_schema.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- [적용 방법 A] Supabase Dashboard SQL Editor
--   1. https://app.supabase.com 접속 → 프로젝트 선택
--   2. 좌측 메뉴 'SQL Editor' 클릭
--   3. 이 파일 내용을 붙여넣고 'Run' 실행
--
-- [적용 방법 B] Supabase CLI
--   1. npm install -g supabase
--   2. supabase login
--   3. supabase link --project-ref <YOUR_PROJECT_REF>
--   4. supabase db push
--      (또는 supabase migration up)
--
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 0. 공통 유틸리티: updated_at 자동 갱신 트리거 함수
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 1. profiles (auth.users 확장)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- updated_at 자동 갱신 트리거
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- auth.users 생성 시 profiles 레코드 자동 생성
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    -- raw_user_meta_data에 full_name 또는 name이 있으면 사용, 없으면 NULL
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name'
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- RLS 활성화 (정책은 Wave 4에서 추가 예정)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. projects
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.projects (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text        NOT NULL DEFAULT '새 프로젝트',
  canvas_state  jsonb,                    -- Fabric.js toJSON() 결과
  thumbnail_url text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- updated_at 자동 갱신 트리거
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 인덱스
CREATE INDEX idx_projects_user_id ON public.projects(user_id);

-- RLS 활성화
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. assets (업로드된 이미지 메타데이터)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.assets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text        NOT NULL,
  public_url   text        NOT NULL,
  file_name    text,
  mime_type    text,
  file_size    integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 인덱스
CREATE INDEX idx_assets_project_id ON public.assets(project_id);
CREATE INDEX idx_assets_user_id    ON public.assets(user_id);

-- RLS 활성화
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. ai_results (AI 분석 결과 캐시)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.ai_results (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  result_type text        NOT NULL CHECK (result_type IN ('copy', 'image_analysis')),
  result_data jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 인덱스
CREATE INDEX idx_ai_results_project_id ON public.ai_results(project_id);

-- RLS 활성화
ALTER TABLE public.ai_results ENABLE ROW LEVEL SECURITY;
