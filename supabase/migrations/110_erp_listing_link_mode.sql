-- 110_erp_listing_link_mode.sql
-- ERP 1-A 코드 리뷰 반영: channel_listings ↔ listing_skus 연결의 의미를 명시한다.
-- 지금까지 listing_skus에 SKU가 여러 개 붙으면 "번들(전부 소비)"로 읽혔는데,
-- 네이버 단일상품에 쿠팡 옵션 여러 개가 붙는 실제 사례(컬럼비아 9개)는
-- "그중 하나를 판다(any_of)"다. 의미를 컬럼으로 고정해 적재·조회 코드가 구분하게 한다.
alter table erp.channel_listings
  add column if not exists link_mode text not null default 'single'
    check (link_mode in ('single', 'bundle', 'any_of'));

comment on column erp.channel_listings.link_mode is
  'single=SKU 1개. bundle=연결된 SKU 전부를 소비한다(세트). any_of=연결된 SKU 중 하나를 판다 — 판매 SKU는 주문 옵션으로 가리고(1-C), 재고 전송은 연결 SKU들의 가용 합계를 쓴다(1-D).';
