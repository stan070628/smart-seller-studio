-- coupang_drafts, coupang_registered_products, generated_assets:
-- user_id FK를 auth.users에서 제거
--
-- 이 앱은 Render PostgreSQL의 auth_users 테이블로 인증하며 Supabase Auth를 사용하지 않음.
-- user_id는 Render DB UUID라 Supabase auth.users에 존재하지 않아 FK 위반 발생.
-- auth_users는 Render DB에 있으므로 Supabase에서 크로스-DB FK 불가 → 제약 제거.
-- (보안: service role key + .eq('user_id', userId) 필터로 격리 보장)

ALTER TABLE coupang_drafts
  DROP CONSTRAINT IF EXISTS coupang_drafts_user_id_fkey;

ALTER TABLE coupang_registered_products
  DROP CONSTRAINT IF EXISTS coupang_registered_products_user_id_fkey;

ALTER TABLE generated_assets
  DROP CONSTRAINT IF EXISTS generated_assets_user_id_fkey;
