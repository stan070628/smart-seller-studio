-- 플랫폼 등록 실패 시 임시저장 테이블
CREATE TABLE IF NOT EXISTS public.listing_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      text NOT NULL CHECK (platform IN ('naver', 'coupang')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'registered', 'failed')),
  product_name  text,
  payload       jsonb NOT NULL,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_drafts_platform_status_idx ON public.listing_drafts (platform, status);

ALTER TABLE public.listing_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON public.listing_drafts USING (true) WITH CHECK (true);
