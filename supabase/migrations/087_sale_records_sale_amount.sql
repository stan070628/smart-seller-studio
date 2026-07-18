-- 087_sale_records_sale_amount.sql
-- sale_records에 실매출 총액 컬럼 추가.
--
-- 배경: 081(unit_multiplier)이 quantity를 "단품 개수"(주문수량 × 배수)로
-- 바꿨으나 selling_price는 "팩 단가"로 남아, selling_price × quantity가
-- 실매출의 배수배가 되는 버그가 있다. sale_amount는 채널이 확정한 실매출을
-- 그대로 보관해 매출을 곱으로 유도하지 않게 한다.
--
-- 백필: 실제 DB에 배수>1 옵션(다슈 왁스 2·3개입, LABNOSH 7개입)의 판매가
-- 존재함이 확인됨(67건). 따라서 단순 selling_price × quantity 백필은 이들을
-- 배수배로 부풀린다. 아래 2단계로 배수 인지(multiplier-aware) 백필한다:
--   1) 전 행을 배수 1 가정으로 백필 (수동·네이버·단일옵션에 정확)
--   2) coupang_order_item_id 끝자리(vendorItemId)가 배수>1 옵션에 매칭되는
--      행만 selling_price × quantity / multiplier 로 교정
-- 드라이런에서 67건 전부 배수로 나누어떨어짐(나머지 0) 확인 — 정수 손실 없음.

ALTER TABLE sale_records ADD COLUMN IF NOT EXISTS sale_amount int;

-- 1단계: 배수 1 가정 백필 (아직 미설정 행만)
UPDATE sale_records
   SET sale_amount = selling_price * quantity
 WHERE sale_amount IS NULL;

-- 2단계: 배수>1 옵션에서 임포트된 행 교정.
-- coupang_order_item_id 형식: 'wing-{orderId}-{vid}', '{orderId}-{vid}',
-- 'rg-{orderId}-{vid}' → 끝자리 = vendorItemId. 'naver-{id}'·수동(NULL)은
-- external_id에 매칭되지 않아 1단계 값(배수 1)을 유지한다.
-- 이 UPDATE는 매칭 행을 무조건 덮으므로, 잘못된 selling_price × quantity가
-- 이미 들어간 상태에서 재실행해도 교정된다(멱등적 교정).
UPDATE sale_records sr
   SET sale_amount = sr.selling_price * sr.quantity / m.unit_multiplier
  FROM (
    SELECT external_id::text AS ext, unit_multiplier
    FROM product_cost_channels
    WHERE unit_multiplier > 1
  ) m
 WHERE sr.coupang_order_item_id IS NOT NULL
   AND split_part(
         sr.coupang_order_item_id, '-',
         array_length(string_to_array(sr.coupang_order_item_id, '-'), 1)
       ) = m.ext;
