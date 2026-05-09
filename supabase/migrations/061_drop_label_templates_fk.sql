-- label_templates.user_id FK 제거
-- 앱이 Supabase Auth가 아닌 Render PostgreSQL 자체 auth_users를 사용하므로
-- auth.users 참조 FK가 삽입을 막는 문제 해결
ALTER TABLE label_templates DROP CONSTRAINT IF EXISTS label_templates_user_id_fkey;
