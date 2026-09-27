-- 120_erp_order_lines_manual_sku.sql
-- ERP 1-C2b ①. 사람이 대기열 화면에서 「이 주문만 연결」한 SKU. 연결 판정기(resolve.ts applyManualSku)가 이 값을 먼저 본다 —
-- 다음 수집의 upsert가 판정 결과를 다시 써도 사람이 정한 SKU가 유지된다. 당근 수동 판매(③)도 이 칸으로 SKU를 확정한다.
alter table erp.order_lines
  add column if not exists manual_sku_id bigint references erp.skus(id);

create index if not exists order_lines_unattributed_idx on erp.order_lines (channel, product_id)
  where attribution = 'unattributed';

comment on column erp.order_lines.manual_sku_id is '사람이 정한 SKU(대기열 「이 주문만 연결」·당근). 연결 판정보다 우선한다';
