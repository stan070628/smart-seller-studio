// scripts/erp/ledger-selftest.ts
// 사용법: npx --no-install tsx scripts/erp/ledger-selftest.ts
// 운영 DB에서 원장 트리거·제약·뷰가 설계대로 동작하는지 시험한다. 전부 한 트랜잭션 안에서 하고 끝에 ROLLBACK — 아무것도 남기지 않는다.
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
  console.table(results.map((r) => ({ 점검: r.check, 결과: r.ok ? '✅' : '❌', 내용: r.ok ? '' : (r.detail ?? '') })));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
})();
