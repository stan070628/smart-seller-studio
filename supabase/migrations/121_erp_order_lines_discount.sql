-- 121_erp_order_lines_discount.sql
-- ERP 1-C2b ②. 판매자 부담 즉시할인. amount(판매가 × 수량)는 그대로 두고 따로 적는다 — 실매출 = amount − discount_amount.
--   discount_source     coupang_fms(주문별 즉시할인 쿠폰 조회) · coupang_fms_error(조회 3회 실패로 닫음 — 할인 모름)
--                       · naver_seller(상품주문의 판매자 부담 할인)
--   discount_checked_at 할인을 확인한 시각. null = 아직 모른다(쿠팡은 수집 뒤 따로 조회한다 — 이 칸이 null인 줄만 조회)
--   discount_attempts   쿠팡 쿠폰 조회 실패 횟수. 3회째 실패면 coupang_fms_error로 닫는다(2026-09-27 실측: 계속 500인 주문이 있다)
alter table erp.order_lines
  add column if not exists discount_amount     integer not null default 0 check (discount_amount >= 0),
  add column if not exists discount_source     text,
  add column if not exists discount_checked_at timestamptz,
  add column if not exists discount_attempts   integer not null default 0;

create index if not exists order_lines_discount_todo_idx on erp.order_lines (paid_at desc)
  where discount_checked_at is null and discount_attempts < 3 and channel in ('coupang_wing', 'coupang_rg');

comment on column erp.order_lines.discount_amount is '판매자 부담 즉시할인(원, 줄 합계). amount는 할인 전';
comment on column erp.order_lines.discount_checked_at is '할인 확인 시각. null = 아직 모름';
comment on column erp.order_lines.discount_attempts is '쿠팡 쿠폰 조회 실패 횟수. 3회째 실패면 coupang_fms_error로 닫는다';
