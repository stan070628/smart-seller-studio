-- 발굴 탭이 손익분기를 계산하려면 실효원가(도매가 + 개당 배송비)가 필요하다.
-- 파이프라인은 parseUnitDeliFee로 이미 계산하고 있었으나 저장하지 않았다.
-- 기존 행은 NULL로 남으며, 소비자는 NULL을 0으로 보지 말고 "모름"으로 다뤄야 한다.
ALTER TABLE public.keyword_sourcing_results
  ADD COLUMN IF NOT EXISTS unit_deli_fee integer;

COMMENT ON COLUMN public.keyword_sourcing_results.unit_deli_fee IS
  '개당 배송비 (사입 10개 기준 환산). deli-policy.unitDeliveryFee 결과';
