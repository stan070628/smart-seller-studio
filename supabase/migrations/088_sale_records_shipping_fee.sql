-- 088_sale_records_shipping_fee.sql
-- sale_records.shipping_fee 복구.
-- 이 컬럼은 2026-06-21-sale-shipping-fee 스펙에서 도입돼 운영 DB에 수동 적용됐으나
-- 마이그레이션 파일이 저장소에 누락돼 있었다(신선 DB 재현 불가). 이를 복구한다.
-- 라이브 정의: integer NOT NULL DEFAULT 0. 신규 행의 채널별 값(쿠팡/네이버 3500,
-- RG 0)은 앱의 resolveSaleShippingFee가 설정하므로 백필 UPDATE는 두지 않는다.
-- IF NOT EXISTS라 컬럼이 이미 있는 운영 DB에는 무해.

ALTER TABLE sale_records ADD COLUMN IF NOT EXISTS shipping_fee int NOT NULL DEFAULT 0;
