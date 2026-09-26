// scripts/erp/orders-selftest.ts
// 사용법: npx --no-install tsx scripts/erp/orders-selftest.ts
// 운영 DB에서 주문 upsert·옛 장부·판매 차감·역전표·@n·재고 부족·기초 이전·bundle·any_of·사라진 라인을 **한 트랜잭션에서 시험하고 반드시 ROLLBACK**한다.
// 커밋하는 경로가 없으므로 기초재고가 있는 원장에서도 돈다(ledger-selftest.ts와 다르다). 임시 SKU는 status='archived'.
// 주문 시각을 2099년으로 둬 실제 주문과 사라짐 판정 구간이 겹치지 않게 한다. 채널 API는 부르지 않는다.
// 🔴 마이그레이션 119(lease·absent_since·status_unmapped·legacy_voided_at) 적용 뒤에만 돈다.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { postLotCreate } from '@/lib/erp/ledger/store';
import { runDeductions } from '@/lib/erp/orders/deduct';
import { legacyKeyOf } from '@/lib/erp/orders/keys';
import { pickLegacy } from '@/lib/erp/orders/legacy';
import { syncLegacySales } from '@/lib/erp/orders/legacy-store';
import { resolveLine } from '@/lib/erp/orders/resolve';
import { loadLegacyIndex, loadListingIndex, markAbsentCanceled, readCutover, upsertOrderLines, type ResolvedLine } from '@/lib/erp/orders/store';
import type { OrderLine } from '@/lib/erp/orders/types';

loadEnvLocal();

const results: { check: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push({ check: name, ok, detail });

(async () => {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const T = Date.now();
  const tag = `selftest-orders:${T}`;
  try {
    await c.query('BEGIN');
    const cutover = await readCutover(c);
    const now = () => new Date().toISOString();

    // 임시 옛 상품 · SKU 둘 · 리스팅 셋(single · bundle · any_of) — 전부 롤백된다
    const pc = String((await c.query(`insert into product_costs (product_name) values ($1) returning id`, [`${tag} 옛 상품`])).rows[0].id);
    const mkSku = async (suffix: string, legacy: string[]) => Number((await c.query(
      `insert into erp.skus (key, name, origin, status, legacy_product_cost_ids) values ($1, '주문 자가시험', 'manual', 'archived', $2::uuid[]) returning id`,
      [`${tag}:${suffix}`, legacy],
    )).rows[0].id);
    const s1 = await mkSku('a', [pc]);
    const s2 = await mkSku('b', []);
    const mkListing = async (vid: string, mode: string, links: [number, number][]) => {
      const id = Number((await c.query(
        `insert into erp.channel_listings (channel, external_product_id, external_option_key, label, active, link_mode, origin)
         values ('coupang_wing', $1, '', $2, true, $3, 'manual') returning id`,
        [vid, tag, mode],
      )).rows[0].id);
      for (const [skuId, mul] of links) {
        await c.query(`insert into erp.listing_skus (listing_id, sku_id, multiplier, origin) values ($1, $2, $3, 'manual')`, [id, skuId, mul]);
      }
    };
    const vSingle = `9${T}1`;
    const vBundle = `9${T}2`;
    const vAny = `9${T}3`;
    await mkListing(vSingle, 'single', [[s1, 1]]);
    await mkListing(vBundle, 'bundle', [[s1, 1], [s2, 2]]);
    await mkListing(vAny, 'any_of', [[s1, 1], [s2, 1]]);
    await postLotCreate(c, { skuId: s1, location: 'self', qty: 5, unitCost: 1000, kind: 'receipt', occurredAt: now(), idemKey: `${tag}:r1` });

    const selfQty = async (s: number) =>
      Number((await c.query(`select coalesce(sum(qty), 0)::int q from erp.stock_ledger where sku_id = $1 and location = 'self'`, [s])).rows[0].q);
    const AT = '2099-01-01T01:00:00.000Z';
    const mk = (n: number, o: Partial<OrderLine> = {}): OrderLine => ({
      channel: 'coupang_wing', externalOrderId: `st${T}o${n}`, externalLineId: `st${T}b${n}:${o.productId ?? vSingle}`,
      orderedAt: AT, paidAt: AT, rawStatus: 'ACCEPT', status: 'paid', productId: vSingle, optionKey: '', altProductId: null,
      productLabel: tag, qty: 1, unitPrice: 1000, amount: 1000, ...o,
    });
    const collect = async (lines: OrderLine[]) => {
      const index = await loadListingIndex(c);
      const lidx = await loadLegacyIndex(c);
      const resolved: ResolvedLine[] = lines.map((l) => {
        const resolution = resolveLine(l, index);
        return { ...l, resolution, legacyKey: legacyKeyOf(l), legacy: pickLegacy(l, resolution, lidx) };
      });
      const up = await upsertOrderLines(c, resolved);
      await syncLegacySales(c, resolved.map((r) => r.legacyKey));
      await runDeductions(c, { enabled: true, cutover, lineIds: up.ids, channel: 'coupang_wing', at: now(), includeOpen: false });
      return up.ids;
    };
    const lineRow = async (id: number) => (await c.query(
      `select status, raw_status, deduction_state, deduction_note, ledger_version, posted from erp.order_lines where id = $1`, [id],
    )).rows[0];
    const sale = async (key: string) => (await c.query(`select quantity, voided_at from sale_records where coupang_order_item_id = $1`, [key])).rows[0];

    // 1. 결제 → 차감
    const A = mk(1, { qty: 2 });
    const [a] = await collect([A]);
    let r = await lineRow(a);
    check('결제 라인 → 집 2 차감 · posted · 버전 1', r.deduction_state === 'posted' && r.ledger_version === 1 && (await selfQty(s1)) === 3, JSON.stringify(r));
    const key1 = String(r.posted[0]?.idemKey);
    check('판매 전표 키 = sale:coupang_wing:<라인키>:s<sku>', key1 === `sale:coupang_wing:${A.externalLineId}:s${s1}`, key1);
    const led = (await c.query(`select kind, ref_type, note from erp.stock_ledger where idem_key like $1 order by id limit 1`, [`${key1}#%`])).rows[0];
    check('판매 전표 kind sale · ref_type order_line · 메모에 채널·주문번호', led?.kind === 'sale' && led?.ref_type === 'order_line' && led?.note === `쿠팡 판매자배송 주문 ${A.externalOrderId}`, JSON.stringify(led));
    const lk = `wing-${A.externalOrderId}-${vSingle}`;
    let sr = await sale(lk);
    check('옛 장부 한 행(수량 2 · 무효 아님)', !!sr && Number(sr.quantity) === 2 && sr.voided_at === null, JSON.stringify(sr));

    // 2. 취소 → 역전표
    await collect([{ ...A, status: 'canceled', rawStatus: 'ACCEPT/CANCELED' }]);
    r = await lineRow(a);
    sr = await sale(lk);
    check('취소 → 역전표 · reversed · 집 5 · 옛 장부 무효', r.deduction_state === 'reversed' && (await selfQty(s1)) === 5 && sr?.voided_at !== null, JSON.stringify({ r, sr }));

    // 3. 다시 결제 → @2
    await collect([A]);
    r = await lineRow(a);
    sr = await sale(lk);
    check('되살아나면 @2로 다시 차감 · 집 3 · 옛 장부 무효 해제',
      r.posted[0]?.idemKey === `${key1}@2` && r.ledger_version === 2 && (await selfQty(s1)) === 3 && sr?.voided_at === null, JSON.stringify({ r, sr }));

    // 4. 재고 부족
    const [b] = await collect([mk(2, { qty: 10 })]);
    r = await lineRow(b);
    check('재고 부족 → skipped_short · 원장 그대로(집 3)', r.deduction_state === 'skipped_short' && /재고 부족/.test(r.deduction_note ?? '') && (await selfQty(s1)) === 3, JSON.stringify(r));

    // 5. 기초재고 이전 결제
    const [pre] = await collect([mk(3, { orderedAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T00:00:00.000Z' })]);
    r = await lineRow(pre);
    check('기초재고 이전 결제 → none(pre_cutover)', r.deduction_state === 'none' && r.deduction_note === 'pre_cutover', JSON.stringify(r));

    // 6. bundle
    await postLotCreate(c, { skuId: s2, location: 'self', qty: 10, unitCost: 500, kind: 'receipt', occurredAt: now(), idemKey: `${tag}:r2` });
    const B = mk(4, { productId: vBundle, qty: 2 });
    const [bd] = await collect([B]);
    r = await lineRow(bd);
    check('bundle → SKU마다 한 전표(s1 −2 · s2 −4)', r.deduction_state === 'posted' && r.posted.length === 2 && (await selfQty(s1)) === 1 && (await selfQty(s2)) === 6, JSON.stringify(r));

    // 7. any_of
    const AN = mk(5, { productId: vAny });
    const [an] = await collect([AN]);
    r = await lineRow(an);
    check('any_of → 미귀속 · none(unattributed)', r.deduction_state === 'none' && r.deduction_note === 'unattributed', JSON.stringify(r));

    // 8. 응답에서 사라진 라인 = 취소 — 두 번 연속 사라져야 취소(설계 해석 #24). 수집 시작 시각은 먼 미래(이 트랜잭션의 라인이 모두 그 전에 처음 보였다)
    const cover8 = { field: 'ordered_at' as const, from: '2099-01-01T00:00:00.000Z', to: '2099-01-02T00:00:00.000Z' };
    const STARTED = '2100-01-01T00:00:00.000Z';
    const ab1 = await markAbsentCanceled(c, 'coupang_wing', cover8, [A, B, AN], STARTED);
    const rb1 = await lineRow(b);
    check('처음 사라지면 absent_since만(상태 그대로)', ab1.ids.length === 0 && ab1.marked === 1 && ab1.refused === null && rb1.status === 'paid',
      JSON.stringify({ ab1, rb1 }));
    const ab = await markAbsentCanceled(c, 'coupang_wing', cover8, [A, B, AN], STARTED);
    await runDeductions(c, { enabled: true, cutover, lineIds: ab.ids, channel: 'coupang_wing', at: now(), includeOpen: false });
    const rb = await lineRow(b);
    check('두 번째로 사라진 라인 1건 → canceled(ABSENT) · 부족 라인은 대상에서 빠진다(none · voided)',
      ab.ids.length === 1 && rb.status === 'canceled' && rb.raw_status === 'ABSENT' && rb.deduction_state === 'none' && rb.deduction_note === 'voided', JSON.stringify({ ab, rb }));
    const empty = await markAbsentCanceled(c, 'coupang_wing', cover8, [], STARTED);
    check('받은 라인 0건이면 사라짐 판정 거절(empty_fetch)', empty.refused?.reason === 'empty_fetch' && empty.ids.length === 0, JSON.stringify(empty));
  } catch (e) {
    check('예상 못 한 오류', false, (e as Error).message);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
  }
  const left = (await c.query(`select count(*)::int n from erp.skus where key like 'selftest-orders:%'`)).rows[0].n;
  check('롤백 뒤 흔적 없음', left === 0, String(left));
  await c.end();
  for (const x of results) console.log(`${x.ok ? '✅' : '❌'} ${x.check}${x.ok || !x.detail ? '' : ` — ${x.detail}`}`);
  if (results.some((x) => !x.ok)) process.exitCode = 1;
})();
