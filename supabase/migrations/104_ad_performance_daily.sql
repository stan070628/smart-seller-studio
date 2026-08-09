-- 104_ad_performance_daily.sql
-- 광고 성과 지표를 광고비와 같은 행에 담는다.
--
-- 지금까지 product_ad_spend_daily 는 집행 광고비만 남겼다. 광고비만으로는
-- "이 상품 광고를 계속할지" 판단할 수 없다 — 광고비가 큰 게 문제인지, 클릭이
-- 안 붙는 게 문제인지(노출 대비 클릭률), 클릭은 오는데 안 사는 게 문제인지
-- (클릭 대비 전환율)를 구분해야 개선점이 나온다.
--
-- 열을 따로 떼지 않고 같은 행에 붙이는 이유: 광고비와 성과는 늘 같은 표에서
-- 같이 들어오고, ROAS = 전환매출 / 광고비 처럼 함께 있어야 계산된다.
-- 나뉘어 있으면 한쪽만 채워진 상태가 생긴다.
--
-- 값은 모두 nullable 이다. NULL 은 "그날 지표를 수집하지 않았다"(예전 수기
-- 입력분)이고 0 은 "광고를 돌렸는데 노출이 0이었다"라 뜻이 다르다.

ALTER TABLE product_ad_spend_daily
  ADD COLUMN IF NOT EXISTS impressions  INTEGER,
  ADD COLUMN IF NOT EXISTS clicks       INTEGER,
  ADD COLUMN IF NOT EXISTS ad_orders    INTEGER,
  ADD COLUMN IF NOT EXISTS ad_revenue   NUMERIC(12,2);

COMMENT ON COLUMN product_ad_spend_daily.impressions IS '노출수. NULL이면 미수집';
COMMENT ON COLUMN product_ad_spend_daily.clicks      IS '클릭수. NULL이면 미수집';
COMMENT ON COLUMN product_ad_spend_daily.ad_orders   IS '광고 전환 판매수. NULL이면 미수집';
COMMENT ON COLUMN product_ad_spend_daily.ad_revenue  IS '광고 전환 매출(원). NULL이면 미수집';

COMMENT ON TABLE product_ad_spend_daily IS
  '상품별 날짜별 광고 실적 (광고비 단일 소스 + 성과 지표). spec 2026-07-18, 지표 확장 2026-08-09';
