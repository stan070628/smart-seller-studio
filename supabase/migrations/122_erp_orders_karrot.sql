-- 122_erp_orders_karrot.sql
-- ERP 1-C2b ③. 당근 직거래 수동 판매를 주문·주문 줄로 저장한다(채널 'karrot'). 수집기는 이 채널을 돌지 않는다.
alter table erp.orders drop constraint if exists orders_channel_check;
alter table erp.orders add constraint orders_channel_check
  check (channel in ('coupang_wing', 'coupang_rg', 'naver', 'toss', 'karrot'));
alter table erp.order_lines drop constraint if exists order_lines_channel_check;
alter table erp.order_lines add constraint order_lines_channel_check
  check (channel in ('coupang_wing', 'coupang_rg', 'naver', 'toss', 'karrot'));
