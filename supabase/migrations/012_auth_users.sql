-- auth_users 테이블: Render PostgreSQL 자체 인증용
-- Supabase Auth를 대체하며 이메일/비밀번호 기반 로그인을 지원

CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users (email);
