-- 105_stock_sync_links.sql
-- 쿠팡 Wing 옵션 ↔ 네이버·토스 옵션 연결. 쿠팡에서 못 파는 옵션을 다른 채널에서 품절 처리한다.
--
-- product_cost_channels(079)를 쓰지 않는 이유: 그 표는 상품 단위이고 토스가 없으며,
-- 네이버는 수정 API에 필요한 originProductNo 대신 channel_product_no를 담는다.
-- 품절은 옵션 단위로 일어나므로 옵션 단위 표가 필요하다.
--
-- 옵션명이 채널마다 달라(`105(L) 블랙` / `105(L)` / `그레이 / 105(L) / 1개`) 자동 매칭하지 않고
-- 사람이 확인한 연결만 넣는다.

CREATE TABLE IF NOT EXISTS stock_sync_links (
  id                      BIGSERIAL PRIMARY KEY,
  coupang_vendor_item_id  BIGINT      NOT NULL,
  channel                 TEXT        NOT NULL CHECK (channel IN ('naver', 'toss')),
  product_id              BIGINT      NOT NULL,
  option_key              TEXT        NOT NULL DEFAULT '',
  label                   TEXT,
  zeroed_at               TIMESTAMPTZ,
  last_error              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 채널 옵션 하나에 쿠팡 옵션 여러 개가 붙을 수 있다(네이버 단일상품 ↔ 쿠팡 M·L).
  -- 그 경우 연결된 쿠팡 옵션이 전부 판매 불가일 때만 품절 처리한다
  UNIQUE (channel, product_id, option_key, coupang_vendor_item_id)
);

-- RLS: 활성화하되 정책 없음. cron은 owner 연결로 우회한다 (101 receipt_drafts와 동일)
ALTER TABLE stock_sync_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS stock_sync_links_vendor_item_idx ON stock_sync_links (coupang_vendor_item_id);

COMMENT ON COLUMN stock_sync_links.product_id IS '네이버 originProductNo / 토스 productId';
COMMENT ON COLUMN stock_sync_links.option_key IS '네이버 optionCombination id(단일상품은 빈 문자열) / 토스 옵션 valueName을 " / "로 이은 값';
COMMENT ON COLUMN stock_sync_links.zeroed_at  IS '동기화가 0으로 내린 시각. NULL이 아니면 쿠팡이 판매 가능해질 때 되살린다. 사용자가 직접 내린 옵션은 NULL이라 되살리지 않는다';
