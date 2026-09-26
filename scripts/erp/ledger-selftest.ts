// scripts/erp/ledger-selftest.ts
// 사용법: npx --no-install tsx scripts/erp/ledger-selftest.ts
// 운영 DB에서 원장 트리거·제약·뷰가 설계대로 동작하는지 시험한다. 대부분은 한 트랜잭션 안에서 하고 끝에 ROLLBACK한다.
// 예외: 동시성 시험(concurrency)은 두 접속이 서로의 커밋을 봐야 하므로 임시 SKU·lot을 커밋했다가 곧바로 지운다
// (원장은 삭제를 막으므로 한 트랜잭션 안에서만 guard 트리거를 끄고 지운다 — ALTER TABLE도 트랜잭션이라 밖에서는 보이지 않는다).
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { postConsume, postLotCreate, postTransfer, reverse } from '@/lib/erp/ledger/store';

loadEnvLocal();

const results: { check: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push({ check: name, ok, detail });

async function expectError(c: pg.Client, name: string, fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await c.query('savepoint t');
  try {
    await fn();
    check(name, false, '오류가 나지 않았다');
  } catch (e) {
    check(name, pattern.test((e as Error).message), (e as Error).message);
  }
  await c.query('rollback to savepoint t');
}

(async () => {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN');
    const sku = Number((await c.query(
      `insert into erp.skus (key, name, origin) values ($1, '자가시험', 'manual') returning id`, [`selftest:${Date.now()}`],
    )).rows[0].id);
    const onHand = async (loc: string) =>
      (await c.query('select qty, value from erp.stock_on_hand where sku_id = $1 and location = $2', [sku, loc])).rows[0] ?? { qty: 0, value: 0 };

    await postLotCreate(c, { skuId: sku, location: 'self', qty: 10, unitCost: 1000, kind: 'receipt', occurredAt: '2026-01-01T00:00:00Z', idemKey: `st:${sku}:r1` });
    await postLotCreate(c, { skuId: sku, location: 'self', qty: 5, unitCost: 1200, kind: 'receipt', occurredAt: '2026-01-02T00:00:00Z', idemKey: `st:${sku}:r2` });
    await postConsume(c, { skuId: sku, location: 'self', qty: 12, kind: 'sale', occurredAt: '2026-01-03T00:00:00Z', idemKey: `st:${sku}:s1` });
    let h = await onHand('self');
    check('FIFO 소진 후 self 3개 · 3,600원', Number(h.qty) === 3 && Number(h.value) === 3600, JSON.stringify(h));

    await postTransfer(c, { skuId: sku, from: 'self', to: 'rg_inbound', qty: 2, occurredAt: '2026-01-04T00:00:00Z', idemKey: `st:${sku}:t1` });
    h = await onHand('rg_inbound');
    check('이동 후 rg_inbound 2개 · 2,400원(lot 단가 유지)', Number(h.qty) === 2 && Number(h.value) === 2400, JSON.stringify(h));

    const again = await postConsume(c, { skuId: sku, location: 'self', qty: 1, kind: 'sale', occurredAt: '2026-01-05T00:00:00Z', idemKey: `st:${sku}:s1` });
    check('같은 멱등키 재기록은 무시', again.posted === false);

    await reverse(c, `st:${sku}:s1`, { occurredAt: '2026-01-06T00:00:00Z', note: '자가시험' });
    h = await onHand('self');
    check('판매 역전표 후 self 13개', Number(h.qty) === 13, JSON.stringify(h));

    await expectError(c, 'UPDATE 금지', () => c.query('update erp.stock_ledger set qty = 99 where sku_id = $1', [sku]), /고치거나 지우지 않는다/);
    await expectError(c, 'DELETE 금지', () => c.query('delete from erp.stock_ledger where sku_id = $1', [sku]), /고치거나 지우지 않는다/);

    const lot1 = Number((await c.query(`select id from erp.stock_ledger where idem_key = $1`, [`st:${sku}:r1`])).rows[0].id);
    await expectError(c, '음수 재고 금지(커밋 시점 검사)', async () => {
      await c.query(
        `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, occurred_at, idem_key) values ($1, 'rg', -1, 'sale', $2, now(), $3)`,
        [sku, lot1, `st:${sku}:neg`],
      );
      await c.query('set constraints all immediate');
    }, /음수가 된다/);

    const other = Number((await c.query(`insert into erp.skus (key, name, origin) values ($1, '자가시험2', 'manual') returning id`, [`selftest2:${Date.now()}`])).rows[0].id);
    await expectError(c, '다른 SKU의 lot 참조 금지', () => c.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, occurred_at, idem_key) values ($1, 'self', 1, 'return', $2, now(), $3)`,
      [other, lot1, `st:${sku}:cross`],
    ), /lot 생성 전표가 아니다/);

    await expectError(c, '소진된 lot 생성 전표의 역전표는 호출에서 거부', async () => {
      await postConsume(c, { skuId: sku, location: 'self', qty: 1, kind: 'sale', occurredAt: '2026-01-07T00:00:00Z', idemKey: `st:${sku}:s2` });
      await reverse(c, `st:${sku}:r1`, { occurredAt: '2026-01-08T00:00:00Z' });
    }, /음수가 된다/);

    await expectError(c, "멱등키에 '#'는 RangeError", async () => {
      try {
        await postConsume(c, { skuId: sku, location: 'self', qty: 1, kind: 'sale', occurredAt: '2026-01-07T00:00:00Z', idemKey: `st:${sku}:bad#1` });
      } catch (e) {
        throw new Error(`${(e as Error).name}: ${(e as Error).message}`);
      }
    }, /^RangeError:/);

    await expectError(c, '양수 sale 금지(부호 검사)', () => c.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, occurred_at, idem_key) values ($1, 'self', 1, 'sale', $2, now(), $3)`,
      [sku, lot1, `st:${sku}:possale`],
    ), /check constraint/);

    await expectError(c, '원 전표를 비추지 않는 역전표 금지', () => c.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, occurred_at, reverses_id, idem_key) values ($1, 'self', -5, 'reversal', $2, now(), $2, $3)`,
      [sku, lot1, `st:${sku}:badrev`],
    ), /정확히 상쇄하지 않는다/);

    await expectError(c, 'lot 생성 전표는 단가 필수', () => c.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, occurred_at, idem_key) values ($1, 'self', 1, 'receipt', now(), $2)`,
      [sku, `st:${sku}:nocost`],
    ), /check constraint/);
  } catch (e) {
    check('예상 못 한 오류', false, (e as Error).message);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
  await concurrency().catch((e) => check('동시성 시험 예상 못 한 오류', false, (e as Error).message));
  console.table(results.map((r) => ({ 점검: r.check, 결과: r.ok ? '✅' : '❌', 내용: r.ok ? '' : (r.detail ?? '') })));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})();

/**
 * store.ts를 거치지 않은 두 접속이 같은 lot(수량 1)을 동시에 1개씩 차감한다.
 * 먼저 커밋한 쪽은 통과하고, 나중에 커밋한 쪽은 트리거의 SKU 잠금 뒤 새 스냅샷에서 먼저 커밋된 차감을 보고 실패해야 한다.
 */
async function concurrency(): Promise<void> {
  const connect = async () => {
    const x = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await x.connect();
    return x;
  };
  const a = await connect();
  const b = await connect();
  let sku: number | null = null;
  try {
    await a.query('BEGIN');
    sku = Number((await a.query(
      `insert into erp.skus (key, name, origin) values ($1, '자가시험-동시성', 'manual') returning id`, [`selftest:conc:${Date.now()}`],
    )).rows[0].id);
    const lot = await postLotCreate(a, { skuId: sku, location: 'self', qty: 1, unitCost: 100, kind: 'receipt', occurredAt: '2026-01-01T00:00:00Z', idemKey: `st:${sku}:conc-lot` });
    await a.query('COMMIT');
    const lotId = lot.ids[0];
    const rawSale = (x: pg.Client, tag: string) => x.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, occurred_at, idem_key) values ($1, 'self', -1, 'sale', $2, now(), $3)`,
      [sku, lotId, `st:${sku}:conc-${tag}`],
    );

    await a.query('BEGIN');
    await rawSale(a, 'a');
    await b.query('BEGIN');
    await rawSale(b, 'b');
    // 둘 다 삽입은 통과한다(검사는 커밋 시점). A를 먼저 커밋하고 끝난 뒤 B를 커밋한다 — B가 A를 기다리며 멈추지 않게.
    let aErr: string | null = null;
    await a.query('COMMIT').catch((e) => { aErr = (e as Error).message; });
    check('동시 차감: 먼저 커밋한 A는 통과', aErr === null, aErr ?? '');
    let bErr: string | null = null;
    await b.query('COMMIT').catch((e) => { bErr = (e as Error).message; });
    check('동시 차감: 나중에 커밋한 B는 음수로 실패', bErr !== null && /음수가 된다/.test(bErr), bErr ?? '오류가 나지 않았다');

    // 커밋을 동시에 던진다. 트리거의 SKU 잠금이 없으면 두 검사가 서로의 미커밋 차감을 못 보고 둘 다 통과할 수 있다.
    // 잠금이 있으면 한쪽이 기다렸다가 새 스냅샷에서 먼저 커밋된 차감을 보고 실패한다 — 정확히 하나만 실패해야 한다.
    const lot2 = await postLotCreate(a, { skuId: sku, location: 'self', qty: 1, unitCost: 100, kind: 'receipt', occurredAt: '2026-01-02T00:00:00Z', idemKey: `st:${sku}:conc-lot2` });
    const rawSale2 = (x: pg.Client, tag: string) => x.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, occurred_at, idem_key) values ($1, 'self', -1, 'sale', $2, now(), $3)`,
      [sku, lot2.ids[0], `st:${sku}:conc2-${tag}`],
    );
    await a.query('BEGIN');
    await rawSale2(a, 'a');
    await b.query('BEGIN');
    await rawSale2(b, 'b');
    const both = await Promise.allSettled([a.query('COMMIT'), b.query('COMMIT')]);
    const fails = both.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as Error).message);
    check('동시 커밋: 정확히 하나만 음수로 실패', fails.length === 1 && /음수가 된다/.test(fails[0]), JSON.stringify(fails));
  } finally {
    await a.query('ROLLBACK').catch(() => {});
    await b.query('ROLLBACK').catch(() => {});
    if (sku !== null) {
      try {
        await a.query('BEGIN');
        await a.query('alter table erp.stock_ledger disable trigger stock_ledger_guard');
        await a.query('delete from erp.stock_ledger where sku_id = $1', [sku]);
        await a.query('alter table erp.stock_ledger enable trigger stock_ledger_guard');
        await a.query('delete from erp.skus where id = $1', [sku]);
        await a.query('COMMIT');
      } catch (e) {
        await a.query('ROLLBACK').catch(() => {});
        check('동시성 시험 정리', false, (e as Error).message);
      }
      const left = (await a.query(
        'select (select count(*) from erp.stock_ledger where sku_id = $1)::int ledger, (select count(*) from erp.skus where id = $1)::int skus', [sku],
      )).rows[0];
      check('동시성 시험 흔적 없음', left.ledger === 0 && left.skus === 0, JSON.stringify(left));
    }
    await a.end();
    await b.end();
  }
}
