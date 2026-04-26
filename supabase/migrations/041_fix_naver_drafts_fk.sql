-- naver_drafts: user_id FK를 auth.users에서 제거
--
-- 039_fix_coupang_fk_to_auth_users.sql와 동일한 이유.
-- 이 앱은 Render PostgreSQL의 auth_users로 인증하며 Supabase Auth 미사용.
-- user_id는 Render DB UUID라 Supabase auth.users에 없어 FK 위반 발생.

ALTER TABLE naver_drafts
  DROP CONSTRAINT IF EXISTS naver_drafts_user_id_fkey;
