-- 087_sale_records_sale_amount.sql
-- sale_records에 실매출 총액 컬럼 추가.
--
-- 배경: 081(unit_multiplier)이 quantity를 "단품 개수"(주문수량 × 배수)로
-- 바꿨으나 selling_price는 "팩 단가"로 남아, selling_price × quantity가
-- 실매출의 배수배가 되는 버그가 있다. sale_amount는 채널이 확정한 실매출을
-- 그대로 보관해 매출을 곱으로 유도하지 않게 한다.
--
-- 백필 전제: 현재 unit_multiplier > 1 판매가 존재하지 않으므로
-- selling_price × quantity가 전 행에서 정확하다. multiplier > 1 상품을
-- 도입하려면 이 마이그레이션과 관련 앱 코드가 먼저 배포돼 있어야 한다.

ALTER TABLE sale_records ADD COLUMN IF NOT EXISTS sale_amount int;

UPDATE sale_records
   SET sale_amount = selling_price * quantity
 WHERE sale_amount IS NULL;
