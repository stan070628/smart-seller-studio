-- 066_sourcing_url_dead.sql
-- [Render PostgreSQL] product_sourcing.product_name 컬럼은 Render DB에 직접 적용됨
-- (이 파일의 Supabase 적용 범위: alerts 테이블만)

-- alerts.type CHECK 제약 확장 (sourcing_url_dead 추가)
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check CHECK (type IN (
  'roas_low', 'stock_low', 'negative_review',
  'winner_lost', 'sourcing_recommendation', 'review_milestone',
  'inbound_return_warning', 'channel_distribution',
  'sourcing_url_dead'
));
