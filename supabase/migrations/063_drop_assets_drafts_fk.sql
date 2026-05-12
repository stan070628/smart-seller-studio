-- assets_drafts.user_id FK 제거
-- 앱이 Supabase Auth가 아닌 Render PostgreSQL 자체 auth_users를 사용하므로
-- auth.users 참조 FK가 삽입을 막는 문제 해결 (label_templates의 061 마이그레이션과 동일한 패턴)
ALTER TABLE assets_drafts DROP CONSTRAINT IF EXISTS assets_drafts_user_id_fkey;
