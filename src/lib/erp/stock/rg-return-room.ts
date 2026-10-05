// src/lib/erp/stock/rg-return-room.ts
// (1-C2c) RG 취소·반품 복귀 한도 = 최근 30일 RG 판매 수량 − 최근 30일 rg_return 원장 수량(0 미만은 0).
// 팔린 적 없는 수량은 돌아올 수 없다 — 한도를 넘는 증가는 「보낸 기록 없는 증가」로 남긴다(입고 기록 누락을 계속 잡는다).
// 판매는 상태 무관: RG 주문 API는 취소 표시가 없고 취소분도 응답에 남는다(2026-10-05 실측).
// 판매는 판매 차감과 같은 기준인 order_lines.alloc(구성 SKU별 수량)을 펼쳐 센다 — 묶음 줄도 구성 SKU마다 잡힌다.
// 두 30일 창은 서로 독립이다: 판매가 창 밖으로 밀려나도 그 복귀는 창 안에 남아 한도를 더 깎을 수 있다 — 한도를 작게 잡는 쪽(보수적)이라 받아들인다.
import type { Db } from '@/lib/erp/ledger/store';

export const RETURN_WINDOW_DAYS = 30;

export async function returnRoomBySku(db: Pick<Db, 'query'>, at: string, skuIds?: number[]): Promise<Map<number, number>> {
  const { rows } = await db.query(
    `with s as (
       select (a->>'skuId')::bigint as sku_id, sum((a->>'qty')::int)::int as q
         from erp.order_lines l cross join lateral jsonb_array_elements(l.alloc) a
        where l.channel = 'coupang_rg'
          and coalesce(l.paid_at, l.ordered_at) > $1::timestamptz - make_interval(days => $3)
          and coalesce(l.paid_at, l.ordered_at) <= $1::timestamptz
          and ($2::bigint[] is null or (a->>'skuId')::bigint = any($2::bigint[]))
        group by 1
     ), r as (
       select l.sku_id, sum(l.qty)::int as q from erp.stock_ledger l
        where l.reason = 'rg_return' and l.reverses_id is null
          and l.occurred_at > $1::timestamptz - make_interval(days => $3)
          and l.occurred_at <= $1::timestamptz
          and not exists (select 1 from erp.stock_ledger x where x.reverses_id = l.id)
          and ($2::bigint[] is null or l.sku_id = any($2::bigint[]))
        group by l.sku_id
     )
     select s.sku_id, greatest(0, s.q - coalesce(r.q, 0)) as room from s left join r on r.sku_id = s.sku_id`,
    [at, skuIds ?? null, RETURN_WINDOW_DAYS],
  );
  return new Map(rows.map((r) => [Number(r.sku_id), Number(r.room)]));
}
