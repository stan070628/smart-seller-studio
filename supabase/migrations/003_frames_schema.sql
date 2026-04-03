-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 003_frames_schema.sql
-- 13-Frame Detail Page System
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. frame_type ENUM
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE public.frame_type AS ENUM (
  'hero',
  'pain_point',
  'solution',
  'usp',
  'detail_1',
  'detail_2',
  'how_to_use',
  'before_after',
  'target',
  'spec',
  'faq',
  'social_proof',
  'cta'
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. project_frames (프레임별 캔버스 상태)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.project_frames (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  frame_type    frame_type    NOT NULL,
  sort_order    smallint      NOT NULL DEFAULT 0,
  canvas_state  jsonb,
  thumbnail_url text,
  is_enabled    boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),

  UNIQUE (project_id, frame_type)
);

CREATE INDEX idx_project_frames_project_id ON public.project_frames(project_id);
CREATE INDEX idx_project_frames_sort ON public.project_frames(project_id, sort_order);

CREATE TRIGGER trg_project_frames_updated_at
  BEFORE UPDATE ON public.project_frames
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.project_frames ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_frames_owner_all"
  ON public.project_frames
  FOR ALL
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 3. frame_copies (프레임별 AI 생성 카피)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.frame_copies (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  frame_id      uuid          NOT NULL REFERENCES public.project_frames(id) ON DELETE CASCADE,
  project_id    uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version       smallint      NOT NULL DEFAULT 1,
  headline      text          NOT NULL,
  subheadline   text,
  body_text     text,
  cta_text      text,
  metadata      jsonb         NOT NULL DEFAULT '{}',
  is_selected   boolean       NOT NULL DEFAULT false,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_frame_copies_frame_id ON public.frame_copies(frame_id);
CREATE INDEX idx_frame_copies_project_id ON public.frame_copies(project_id);

ALTER TABLE public.frame_copies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "frame_copies_owner_all"
  ON public.frame_copies
  FOR ALL
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );
