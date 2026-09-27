// scripts/erp/probe-discounts.ts
// (1-C2b ② 실측, 읽기 전용) 채널별 할인 칸의 이름·값을 본다. 🔴 구매자 칸은 출력하지 않는다 — 숫자·코드 칸만.
// 쿠팡·토스는 고정 IP 프록시가 필요하다: 운영 환경변수를 임시 파일로 받아 PROXY_URL·PROXY_SECRET만 읽고 바로 지운다.
//   cd ~/dev/smart_seller_studio && vercel env pull /tmp/<scratch>/prod.env --environment=production --yes
//   PROBE_PROXY_ENV=/tmp/<scratch>/prod.env npx --no-install tsx scripts/erp/probe-discounts.ts ; rm /tmp/<scratch>/prod.env
import { readFileSync } from 'fs';
import { Client } from 'pg';

const load = (f: string, only?: string[]) => {
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && (!only || only.includes(m[1]))) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\\$/g, '$');
  }
};
load('.env.local');
if (process.env.PROBE_PROXY_ENV) load(process.env.PROBE_PROXY_ENV, ['PROXY_URL', 'PROXY_SECRET']);

const NUMERIC = /price|Price|discount|Discount|amount|Amount|coupon|Coupon|quantity|Quantity/;
const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => NUMERIC.test(k) && (typeof v === 'number' || typeof v === 'string')));

(async () => {
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  // 기준 주문: 극세사 타월 RG 옐로우 9/25(Wing 기준 쿠폰 840) 1건 + 최근 RG·판매자배송 각 2건
  const { rows } = await db.query(
    `(select l.channel, o.external_order_id, l.amount, l.order_qty from erp.order_lines l join erp.orders o on o.id = l.order_id
       where l.product_id = '95373359497' and (l.paid_at at time zone 'Asia/Seoul')::date = '2026-09-25' limit 1)
     union all (select l.channel, o.external_order_id, l.amount, l.order_qty from erp.order_lines l join erp.orders o on o.id = l.order_id
       where l.channel = 'coupang_rg' order by l.paid_at desc limit 2)
     union all (select l.channel, o.external_order_id, l.amount, l.order_qty from erp.order_lines l join erp.orders o on o.id = l.order_id
       where l.channel = 'coupang_wing' order by l.paid_at desc limit 2)`,
  );
  const naverIds = (await db.query(`select external_line_id from erp.order_lines where channel = 'naver' order by paid_at desc limit 3`)).rows.map((r) => String(r.external_line_id));
  await db.end();

  const { getCoupangClient } = await import('../../src/lib/listing/coupang-client');
  const cp = getCoupangClient();
  for (const r of rows) {
    try {
      const entries = await cp.getOrderCoupons(String(r.external_order_id));
      console.log('쿠팡', r.channel, '주문금액', r.amount, '수량', r.order_qty, '| 쿠폰', entries.length, '건');
      for (const e of entries) console.log('   칸', Object.keys(e).sort().join(','), '| 값', JSON.stringify(pick(e)), '| type', e.type, '| status', e.status);
    } catch (e) { console.log('쿠팡', r.channel, '조회 실패', String((e as Error).message).slice(0, 120)); }
  }

  const { getNaverCommerceClient } = await import('../../src/lib/listing/naver-commerce-client');
  const items = (await getNaverCommerceClient().queryProductOrders(naverIds)) as unknown as { productOrder: Record<string, unknown> }[];
  for (const it of items) console.log('네이버', JSON.stringify(pick(it.productOrder)));

  const { TossShoppingClient } = await import('../../src/lib/listing/toss-shopping-client');
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const from = new Date(Date.now() + 9 * 3600e3 - 29 * 86400e3).toISOString().slice(0, 10);
  const page = await new TossShoppingClient().getOrdersPage({ startDate: from, endDate: today });
  for (const o of page.results.slice(0, 5)) {
    console.log('토스 칸', Object.keys(o).filter((k) => NUMERIC.test(k)).sort().join(','), '| 값', JSON.stringify(pick(o as unknown as Record<string, unknown>)));
  }
})().catch((e) => { console.log('실패', String((e as Error).message).slice(0, 200)); process.exit(1); });
