# ERP 1-C2c RG 취소·반품 복귀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 RG 대조에서 입고중으로 설명되지 않는 RG 실재고 증가를, 그 SKU 최근 30일 RG 판매량까지 「취소·반품 복귀」(`adjust`/`rg_return`)로 원장에 더하고, RG 수집기의 「사라지면 취소」 판정을 끈다.

**Architecture:** 순수 판정(`rg-auto.ts` `planRgAuto`)이 SKU마다 입고 이동 → 복귀 → 남는 증가 알림 순으로 나눈다. 복귀 한도는 새 쿼리 모듈(`rg-return-room.ts`)이 계산한다. 실행기(`rg-auto-run.ts`)는 SKU 잠금·savepoint 안에서 이동 뒤 원장을 다시 읽어 복귀 수량을 재계산하고 `postLotCreate`로 기록한다. 설계: `docs/superpowers/specs/2026-10-05-erp-phase1c2c-rg-returns-design.md`.

**Tech Stack:** Next.js App Router · TypeScript · vitest · PostgreSQL(Supabase, `pg` 풀) · 마이그레이션은 `node scripts/apply-migration.mjs <번호>`.

**작업 위치:** worktree `~/dev/smart_seller_studio/.worktrees/erp-1c2c` (브랜치 `feat/erp-1c2c`). 🔴 **`next build`·`.next` 삭제 금지**(메인 작업 폴더에서 dev 서버가 돈다). 검사는 `npx vitest run <경로>`와 `npx tsc --noEmit -p .`만.

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `supabase/migrations/125_erp_rg_returns.sql` | 사유 `rg_return` 허용 · 스냅샷 칸 2개 | 생성 |
| `src/lib/erp/ledger/plan.ts` | `Reason` 타입에 `'rg_return'` | 수정 |
| `src/lib/erp/stock/rg-auto.ts` | 판정(복귀 한도·`returns`·`return_no_cost` 알림) · `RgAutoLast` 칸 | 수정 |
| `src/lib/erp/stock/rg-return-room.ts` | 복귀 한도 쿼리(sold30 − returned30) | 생성 |
| `src/lib/erp/stock/rg-auto-run.ts` | 이동+복귀 기록 · 스냅샷 · 요약 | 수정 |
| `src/app/api/cron/rg-reconcile/route.ts` | 텔레그램 머리줄에 복귀 | 수정 |
| `src/app/api/erp/stock/rg-auto/route.ts` · `src/components/erp/stock/RgAutoPanel.tsx` | 복귀 칸 표시 | 수정 |
| `src/lib/erp/orders/adapters/coupang-rg.ts` | `absenceMeansCancel: false` · 주석 | 수정 |
| 테스트 | `src/__tests__/lib/erp/stock/rg-auto.test.ts` · `rg-auto-run.test.ts` · `rg-return-room.test.ts`(생성) · `src/__tests__/lib/erp/orders/adapters.test.ts` | 수정·생성 |

---

### Task 1: 마이그레이션 125 · `Reason` 타입

**Files:**
- Create: `supabase/migrations/125_erp_rg_returns.sql`
- Modify: `src/lib/erp/ledger/plan.ts:8`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 125_erp_rg_returns.sql
-- ERP 1-C2c. RG 취소·반품 복귀 — RG API로는 취소·반품을 알 수 없어(2026-10-05 실측) 매일 RG 대조가
-- 입고중으로 설명되지 않는 증가를 최근 30일 RG 판매량까지 복귀(adjust/rg_return)로 더한다.
-- 1) 원장 사유에 rg_return 추가(115의 목록 + rg_return)
alter table erp.stock_ledger drop constraint if exists stock_ledger_reason_chk;
alter table erp.stock_ledger add constraint stock_ledger_reason_chk check (
  reason is null or reason in ('opening', 'count_diff', 'damage', 'loss', 'sample', 'return_in', 'other', 'rg_reconcile', 'rg_return')
);
-- 2) 대조 기록 — planned_return = 복귀 판정 · returned = 실제 기록(자동 이동이 켜져 있을 때만)
alter table erp.rg_recon_snapshots add column if not exists planned_return integer not null default 0 check (planned_return >= 0);
alter table erp.rg_recon_snapshots add column if not exists returned integer not null default 0 check (returned >= 0);
```

- [ ] **Step 2: `Reason` 타입 수정** — `src/lib/erp/ledger/plan.ts` 8행을 다음으로 바꾼다.

```ts
export type Reason = 'opening' | 'count_diff' | 'damage' | 'loss' | 'sample' | 'return_in' | 'other' | 'rg_reconcile' | 'rg_return';
```

- [ ] **Step 3: 타입 검사** — Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: 작업 전과 같은 수(새 오류 없음). 작업 전 수는 Step 1 전에 한 번 재어 둔다.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/125_erp_rg_returns.sql src/lib/erp/ledger/plan.ts
git commit -m "feat(erp): 마이그레이션 125 — 원장 사유 rg_return · 대조 기록 복귀 칸"
```

---

### Task 2: 판정 — 복귀 한도·`returns`·`return_no_cost`

**Files:**
- Modify: `src/lib/erp/stock/rg-auto.ts`
- Test: `src/__tests__/lib/erp/stock/rg-auto.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가** — `rg-auto.test.ts`의 `row` 기본값에 `returnRoom: 0`을 넣고(6행), 파일 끝에 추가한다.

```ts
const row = (o: Partial<RgAutoRow>): RgAutoRow => ({ skuId: 72, ledger: 100, actual: 100, inbound: 0, returnRoom: 0, prevDiff: null, inflows: [], ...o });
```

```ts
describe('planRgAuto — (1-C2c) 취소·반품 복귀', () => {
  const IN5 = [{ qty: 5, occurredAt: '2026-10-03T00:00:00Z' }];

  it('입고중이 없으면 증가를 복귀 한도까지 복귀로 · 넘는 수량은 보낸 기록 없는 증가', () => {
    const p = planRgAuto([row({ actual: 104, returnRoom: 3 })], [], NOW);
    expect(p.moves).toEqual([]);
    expect(p.returns).toEqual([{ skuId: 72, qty: 3 }]);
    expect(p.alerts).toEqual([{ kind: 'unsent_increase', skuId: 72, qty: 1 }]);
  });

  it('입고중을 먼저 옮기고 남은 증가만 복귀로', () => {
    const p = planRgAuto([row({ actual: 108, inbound: 5, returnRoom: 10, inflows: IN5 })], [], NOW);
    expect(p.moves).toEqual([{ skuId: 72, qty: 5 }]);
    expect(p.returns).toEqual([{ skuId: 72, qty: 3 }]);
    expect(p.alerts).toEqual([]);
  });

  it('한도가 0이면 복귀 없이 전부 알림(지금과 같다)', () => {
    const p = planRgAuto([row({ actual: 103, returnRoom: 0 })], [], NOW);
    expect(p.returns).toEqual([]);
    expect(p.alerts).toEqual([{ kind: 'unsent_increase', skuId: 72, qty: 3 }]);
  });

  it('음수 한도는 0으로 본다 · 감소에는 복귀가 없다', () => {
    expect(planRgAuto([row({ actual: 102, returnRoom: -4 })], [], NOW).returns).toEqual([]);
    const d = planRgAuto([row({ actual: 97, returnRoom: 9, prevDiff: -1 })], [], NOW);
    expect(d.returns).toEqual([]);
    expect(d.alerts).toEqual([{ kind: 'decrease', skuId: 72, qty: 3 }]);
  });

  it('return_no_cost 알림 — 문구·고정 키', () => {
    const a = { kind: 'return_no_cost' as const, skuId: 72, qty: 2 };
    expect(alertText(a, () => '수건')).toBe('수건 RG 복귀 2개 보류(단가 없음)');
    expect(alertKey(a)).toBe('return_no_cost:72');
    expect(stripAlertKeys(`return_no_cost:72|수건 RG 복귀 2개 보류(단가 없음)`)).toBe('수건 RG 복귀 2개 보류(단가 없음)');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/stock/rg-auto.test.ts` · Expected: FAIL(`returns` undefined, `returnRoom` 타입 오류는 vitest가 무시하므로 값 비교로 실패).

- [ ] **Step 3: 구현** — `src/lib/erp/stock/rg-auto.ts`를 고친다.

머리 주석 2~3행을 다음으로 바꾼다.

```ts
// (1-C2b ④ · 1-C2c) 매일 RG 대조의 판정(순수). 설계 결정 2: 입고 완료만 자동 — RG 실재고가 원장보다 많고 그 SKU에 입고중(rg_inbound)이 있으면
// min(차이, 입고중)만큼 입고중 → RG. (1-C2c) 남은 증가는 복귀 한도(최근 30일 RG 판매 − 최근 30일 복귀)까지 「취소·반품 복귀」 — RG API는 취소·반품을
// 주지 않아 실재고로만 보인다(2026-10-05 실측). 그 밖은 알림만: 한도를 넘는 증가 · 2회 연속 감소(분실·파손 의심) · 입고중 7일 초과 · 연결 안 된 RG 번호.
```

`RgAutoRow`에 칸 추가(`inbound` 다음):

```ts
  /** (1-C2c) 복귀 한도 = 최근 30일 RG 판매 수량 − 최근 30일 rg_return 수량(rg-return-room.ts). 음수는 0으로 본다 */
  returnRoom: number;
```

`RgAlert` 유니온에 추가(`move_failed` 다음):

```ts
  /** (1-C2c) 복귀할 수량이 있으나 원장·옛 원가 어디에도 단가가 없어 기록하지 않았다 */
  | { kind: 'return_no_cost'; skuId: number; qty: number };
```

`planRgAuto`를 다음으로 바꾼다.

```ts
export function planRgAuto(
  rows: RgAutoRow[],
  unmapped: { vid: string; qty: number }[],
  now: Date,
): { moves: { skuId: number; qty: number }[]; returns: { skuId: number; qty: number }[]; alerts: RgAlert[] } {
  const moves: { skuId: number; qty: number }[] = [];
  const returns: { skuId: number; qty: number }[] = [];
  const alerts: RgAlert[] = [];
  for (const r of [...rows].sort((a, b) => a.skuId - b.skuId)) {
    const d = r.actual - r.ledger;
    let move = 0;
    if (d > 0) {
      move = Math.min(d, Math.max(0, r.inbound));
      if (move > 0) moves.push({ skuId: r.skuId, qty: move });
      const ret = Math.min(d - move, Math.max(0, r.returnRoom));
      if (ret > 0) returns.push({ skuId: r.skuId, qty: ret });
      if (d - move - ret > 0) alerts.push({ kind: 'unsent_increase', skuId: r.skuId, qty: d - move - ret });
    } else if (d < 0 && r.prevDiff !== null && r.prevDiff < 0) {
      alerts.push({ kind: 'decrease', skuId: r.skuId, qty: -d });
    }
    if (r.inbound - move > 0) {
      const since = oldestWaiting(r.inflows, move);
      if (since) {
        const days = Math.floor((now.getTime() - Date.parse(since)) / 86_400_000);
        if (days > STALE_DAYS) alerts.push({ kind: 'inbound_stale', skuId: r.skuId, since, days });
      }
    }
  }
  for (const u of unmapped) if (u.qty > 0) alerts.push({ kind: 'unmapped_vid', vid: u.vid, qty: u.qty });
  return { moves, returns, alerts };
}
```

`KEY_PREFIX`에 `return_no_cost`를 넣는다.

```ts
const KEY_PREFIX = /^(?:unsent_increase|decrease|inbound_stale|unmapped_vid|inactive_sku|move_failed|return_no_cost):[^|]*\|/;
```

`alertText`의 switch에 추가(`move_failed` 다음):

```ts
    case 'return_no_cost': return `${name(a.skuId)} RG 복귀 ${a.qty}개 보류(단가 없음)`;
```

(`alertKey`는 `default: ${a.kind}:${a.skuId}`라 그대로 `return_no_cost:72`가 된다.)

`RgAutoLast.rows` 항목 타입에 `plannedReturn: number; returned: number;`를 `moved` 다음에 추가한다.

```ts
  rows: { skuId: number | null; vid: string | null; label: string; ledger: number; actual: number; inbound: number; planned: number; moved: number; plannedReturn: number; returned: number; alert: string | null }[];
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/stock/rg-auto.test.ts` · Expected: PASS(기존 포함 전부).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/stock/rg-auto.ts src/__tests__/lib/erp/stock/rg-auto.test.ts
git commit -m "feat(erp): RG 대조 판정 — 입고 뒤 남는 증가를 복귀 한도까지 취소·반품 복귀로"
```

---

### Task 3: 복귀 한도 쿼리

**Files:**
- Create: `src/lib/erp/stock/rg-return-room.ts`
- Test: `src/__tests__/lib/erp/stock/rg-return-room.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/erp/stock/rg-return-room.test.ts
import { describe, it, expect, vi } from 'vitest';
import { returnRoomBySku, RETURN_WINDOW_DAYS } from '@/lib/erp/stock/rg-return-room';

describe('returnRoomBySku — 최근 30일 RG 판매 − 최근 30일 rg_return', () => {
  it('SKU별 한도를 돌려주고, 판매 기준 시각·SKU 필터를 넘긴다', async () => {
    const query = vi.fn(async () => ({ rows: [{ sku_id: '72', room: 37 }, { sku_id: '80', room: 0 }] }));
    const m = await returnRoomBySku({ query }, '2026-10-05T00:37:00.000Z', [72, 80]);
    expect([...m]).toEqual([[72, 37], [80, 0]]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(['2026-10-05T00:37:00.000Z', [72, 80], RETURN_WINDOW_DAYS]);
    expect(RETURN_WINDOW_DAYS).toBe(30);
    // 판매는 RG 채널·상태 무관(취소 표시가 없다) · 복귀는 rg_return 원 줄만(역전표·되돌린 원 줄 제외)
    expect(sql).toContain("channel = 'coupang_rg'");
    expect(sql).toContain("reason = 'rg_return'");
    expect(sql).toContain('reverses_id is null');
    expect(sql).toContain('not exists (select 1 from erp.stock_ledger x where x.reverses_id = l.id)');
    expect(sql).not.toContain('status');
  });

  it('SKU 필터를 생략하면 null을 넘긴다(전 SKU)', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect((await returnRoomBySku({ query }, '2026-10-05T00:37:00.000Z')).size).toBe(0);
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1][1]).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/stock/rg-return-room.test.ts` · Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현**

```ts
// src/lib/erp/stock/rg-return-room.ts
// (1-C2c) RG 취소·반품 복귀 한도 = 최근 30일 RG 판매 수량 − 최근 30일 rg_return 원장 수량(0 미만은 0).
// 팔린 적 없는 수량은 돌아올 수 없다 — 한도를 넘는 증가는 「보낸 기록 없는 증가」로 남긴다(입고 기록 누락을 계속 잡는다).
// 판매는 상태 무관: RG 주문 API는 취소 표시가 없고 취소분도 응답에 남는다(2026-10-05 실측).
import type { Db } from '@/lib/erp/ledger/store';

export const RETURN_WINDOW_DAYS = 30;

export async function returnRoomBySku(db: Pick<Db, 'query'>, at: string, skuIds?: number[]): Promise<Map<number, number>> {
  const { rows } = await db.query(
    `with s as (
       select sku_id, sum(sku_qty)::int as q from erp.order_lines
        where channel = 'coupang_rg' and sku_id is not null
          and coalesce(paid_at, ordered_at) > $1::timestamptz - make_interval(days => $3)
          and coalesce(paid_at, ordered_at) <= $1::timestamptz
          and ($2::bigint[] is null or sku_id = any($2::bigint[]))
        group by sku_id
     ), r as (
       select l.sku_id, sum(l.qty)::int as q from erp.stock_ledger l
        where l.reason = 'rg_return' and l.reverses_id is null
          and l.occurred_at > $1::timestamptz - make_interval(days => $3)
          and not exists (select 1 from erp.stock_ledger x where x.reverses_id = l.id)
          and ($2::bigint[] is null or l.sku_id = any($2::bigint[]))
        group by l.sku_id
     )
     select s.sku_id, greatest(0, s.q - coalesce(r.q, 0)) as room from s left join r on r.sku_id = s.sku_id`,
    [at, skuIds ?? null, RETURN_WINDOW_DAYS],
  );
  return new Map(rows.map((r) => [Number(r.sku_id), Number(r.room)]));
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/stock/rg-return-room.test.ts` · Expected: PASS.

- [ ] **Step 5: 운영 DB에서 쿼리만 검증(읽기 전용)** — 메인 폴더의 `.env.local`로 실행한다.

```bash
U=$(grep "^SUPABASE_DB_URL=" ../../.env.local | cut -d= -f2- | tr -d '"')
psql "$U" -c "with s as (select sku_id, sum(sku_qty)::int q from erp.order_lines where channel='coupang_rg' and sku_id is not null and coalesce(paid_at, ordered_at) > now() - make_interval(days => 30) and coalesce(paid_at, ordered_at) <= now() group by sku_id), r as (select l.sku_id, sum(l.qty)::int q from erp.stock_ledger l where l.reason='rg_return' and l.reverses_id is null and l.occurred_at > now() - make_interval(days => 30) and not exists (select 1 from erp.stock_ledger x where x.reverses_id = l.id) group by l.sku_id) select s.sku_id, greatest(0, s.q - coalesce(r.q,0)) room from s left join r on r.sku_id = s.sku_id order by room desc limit 5"
```

Expected: 오류 없이 SKU별 한도(극세사 타월 SKU가 가장 크다). `rg_return` 줄은 아직 0건이라 room = 판매량.

- [ ] **Step 6: Commit**

```bash
git add src/lib/erp/stock/rg-return-room.ts src/__tests__/lib/erp/stock/rg-return-room.test.ts
git commit -m "feat(erp): RG 복귀 한도 쿼리 — 최근 30일 RG 판매 − 최근 30일 복귀"
```

---

### Task 4: 실행기 — 이동+복귀 기록·스냅샷·요약

**Files:**
- Modify: `src/lib/erp/stock/rg-auto-run.ts`
- Test: `src/__tests__/lib/erp/stock/rg-auto-run.test.ts`

- [ ] **Step 1: 테스트 준비 수정** — `rg-auto-run.test.ts` 상단 mock을 다음으로 바꾼다(`postLotCreate`·단가 함수 mock, 잠금 뒤 원장이 이동을 반영하도록 상태를 둔다).

```ts
const m = vi.hoisted(() => ({
  postTransfer: vi.fn(), lockSku: vi.fn(), postLotCreate: vi.fn(), latestLotCost: vi.fn(), legacyUnitCost: vi.fn(),
}));
vi.mock('@/lib/erp/ledger/store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/ledger/store')>('@/lib/erp/ledger/store');
  return { ...actual, postTransfer: m.postTransfer, lockSku: m.lockSku, postLotCreate: m.postLotCreate };
});
vi.mock('@/lib/erp/ledger/adjust-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/ledger/adjust-store')>('@/lib/erp/ledger/adjust-store');
  return { ...actual, latestLotCost: m.latestLotCost, legacyUnitCost: m.legacyUnitCost };
});
```

`client(opts)`에 `room?: Record<number, number>` 옵션을 추가하고, 라우터 맨 앞(`deduct_enabled` 검사 앞)에 넣는다.

```ts
      if (sql.includes("reason = 'rg_return'")) {
        const ids = (params[1] as number[] | null) ?? skus.map((s) => s.id);
        return rows(ids.filter((id) => opts.room?.[id] !== undefined).map((id) => ({ sku_id: String(id), room: opts.room![id] })));
      }
```

잠금 뒤 다시 읽는 분기를, 이동 전표가 반영되도록 바꾼다(`moved` 상태를 더한다).

```ts
      if (sql.includes('stock_on_hand where sku_id = $1')) {
        const s = skus.find((k) => k.id === params[0])!;
        const l = opts.locked?.[s.id] ?? { rg: s.ledger, rg_inbound: s.inbound };
        const mv = transferred.get(s.id) ?? 0;
        return rows([{ location: 'rg', qty: l.rg + mv }, { location: 'rg_inbound', qty: l.rg_inbound - mv }]);
      }
```

파일 상단 `let calls`·`let order` 옆에 `let transferred: Map<number, number>;`를 두고, `snapsOf`를 다음으로 바꾸고 `retsOf`를 추가한다.

```ts
const snapsOf = () => calls.filter((x) => x.sql.startsWith('insert into erp.rg_recon_snapshots'))
  // [0]run_id [1]run_at [2]sku_id [3]vid [4]ledger [5]actual [6]inbound [7]planned [8]moved [9]alert [10]planned_return [11]returned
  .map((s) => s.params.slice(2, 10));
const retsOf = () => calls.filter((x) => x.sql.startsWith('insert into erp.rg_recon_snapshots')).map((s) => [s.params[2], ...s.params.slice(10, 12)]);
```

`beforeEach`를 다음으로 바꾼다.

```ts
beforeEach(() => {
  calls = []; order = []; transferred = new Map(); vi.clearAllMocks();
  m.postTransfer.mockImplementation(async (_db: unknown, p: { skuId: number; qty: number }) => {
    transferred.set(p.skuId, (transferred.get(p.skuId) ?? 0) + p.qty);
    return { posted: true, ids: [1, 2] };
  });
  m.postLotCreate.mockResolvedValue({ posted: true, ids: [9] });
  m.latestLotCost.mockResolvedValue(1200);
  m.legacyUnitCost.mockResolvedValue(null);
});
```

(기존 「한 SKU 전표가 실패해도…」 테스트는 `m.postTransfer.mockImplementation`을 덮어쓰므로 그대로 둔다.)

- [ ] **Step 2: 실패하는 테스트 추가** — 파일 끝에 추가한다. S90은 입고중 0인 SKU.

```ts
describe('runRgAuto — (1-C2c) 취소·반품 복귀', () => {
  const S90: Sku = { id: 90, name: '비누', option: null, vid: '95400000090', ledger: 20, inbound: 0 };
  const stock90 = (qty: number) => [{ vid: '95400000090', qty }];

  it('자동 이동 꺼짐 — 복귀 예정만 기록(planned_return), 전표 없음', async () => {
    const c = client({ deduct: true, auto: false, skus: [S90], room: { 90: 5 } });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, stock90(22)) });
    expect(r.returns).toEqual([{ skuId: 90, qty: 2 }]);
    expect(r.returned).toEqual([]);
    expect(r.alerts).toEqual([]);
    expect(m.postLotCreate).not.toHaveBeenCalled();
    expect(retsOf()).toEqual([[90, 2, 0]]);
  });

  it('자동 이동 켜짐 — 잠금 뒤 adjust/rg_return 전표(멱등키 rg-return:<sku>:<KST 날짜>, 원장 최근 단가)', async () => {
    const c = client({ deduct: true, auto: true, skus: [S90], room: { 90: 5 } });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, stock90(22)) });
    expect(m.lockSku).toHaveBeenCalledWith(c, 90);
    expect(m.postLotCreate).toHaveBeenCalledWith(c, expect.objectContaining({
      skuId: 90, location: 'rg', qty: 2, unitCost: 1200, kind: 'adjust', reason: 'rg_return',
      idemKey: 'rg-return:90:2026-10-05', refType: 'rg_auto',
    }));
    expect(r.returned).toEqual([{ skuId: 90, qty: 2 }]);
    expect(retsOf()).toEqual([[90, 2, 2]]);
  });

  it('같은 날 이미 기록됐으면(posted false) returned에 넣지 않는다', async () => {
    m.postLotCreate.mockResolvedValue({ posted: false, ids: [] });
    const c = client({ deduct: true, auto: true, skus: [S90], room: { 90: 5 } });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, stock90(22)) });
    expect(r.returned).toEqual([]);
    expect(retsOf()).toEqual([[90, 2, 0]]);
  });

  it('잠금 뒤 한도를 다시 읽는다 — 그 사이 한도가 1로 줄면 1만', async () => {
    const c = client({ deduct: true, auto: true, skus: [S90], room: { 90: 5 } });
    let n = 0;
    const q0 = c.query.getMockImplementation()!;
    c.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("reason = 'rg_return'") && n++ > 0) return { rows: [{ sku_id: '90', room: 1 }], rowCount: 1 };
      return q0(sql, params);
    });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, stock90(22)) });
    expect(m.postLotCreate).toHaveBeenCalledWith(c, expect.objectContaining({ skuId: 90, qty: 1 }));
    expect(r.returned).toEqual([{ skuId: 90, qty: 1 }]);
  });

  it('입고 이동 뒤 원장을 다시 읽어 남은 차이만 복귀(S72: +8 = 입고 5 + 복귀 3)', async () => {
    const c = client({ deduct: true, auto: true, room: { 72: 10 } });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c) });
    expect(r.moved).toEqual([{ skuId: 72, qty: 5 }]);
    expect(m.postLotCreate).toHaveBeenCalledWith(c, expect.objectContaining({ skuId: 72, qty: 3 }));
    expect(r.alerts).toEqual([UNMAPPED]);
  });

  it('단가가 원장·옛 원가 모두 없으면 기록하지 않고 return_no_cost 알림', async () => {
    m.latestLotCost.mockResolvedValue(null);
    m.legacyUnitCost.mockResolvedValue(null);
    const c = client({ deduct: true, auto: true, skus: [S90], room: { 90: 5 } });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, stock90(22)) });
    expect(m.postLotCreate).not.toHaveBeenCalled();
    expect(r.alerts).toEqual(['비누 RG 복귀 2개 보류(단가 없음)']);
    expect(snapsOf()[0][7]).toBe('return_no_cost:90|비누 RG 복귀 2개 보류(단가 없음)');
  });

  it('원장 단가가 없으면 옛 원가 단가를 쓴다', async () => {
    m.latestLotCost.mockResolvedValue(null);
    m.legacyUnitCost.mockResolvedValue(1691);
    const c = client({ deduct: true, auto: true, skus: [S90], room: { 90: 5 } });
    await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, stock90(22)) });
    expect(m.postLotCreate).toHaveBeenCalledWith(c, expect.objectContaining({ unitCost: 1691 }));
  });

  it('returnsChanged — 직전 실행의 planned_return과 비교', async () => {
    const c = client({ deduct: true, auto: false, skus: [S90], room: { 90: 5 },
      prevRun: [{ sku_id: '90', vid: null, planned_move: 0, planned_return: 2, alert: null } as never] });
    expect((await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, stock90(22)) })).returnsChanged).toBe(false);
  });
});
```

`client`의 `prevRun` 타입에 `planned_return?: number`를 추가한다.

```ts
  prevRun?: { sku_id: string | null; vid: string | null; planned_move: number; planned_return?: number; alert: string | null }[];
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/stock/rg-auto-run.test.ts` · Expected: 새 테스트 FAIL, 기존 테스트 PASS.

- [ ] **Step 4: 구현** — `src/lib/erp/stock/rg-auto-run.ts`.

import 추가:

```ts
import { lockSku, postLotCreate, postTransfer } from '@/lib/erp/ledger/store';
import { latestLotCost, legacyUnitCost } from '@/lib/erp/ledger/adjust-store';
import { kstDay } from '@/lib/erp/orders/window';
import { returnRoomBySku } from './rg-return-room';
```

(기존 `import { lockSku, postTransfer } ...` 줄은 위 줄로 바꾼다.)

머리 주석 끝에 한 줄 추가:

```ts
// (1-C2c) 같은 SKU 잠금·savepoint 안에서 입고 이동 뒤 원장을 다시 읽어 min(실재고 − 원장 RG, 복귀 한도)만큼 취소·반품 복귀(adjust/rg_return, 멱등키
// rg-return:<sku>:<KST 날짜>)를 기록한다. 단가는 원장 최근 lot → 옛 원가 → 없으면 기록하지 않고 return_no_cost 알림.
```

`RgAutoSummary`에 칸 추가(`movesChanged` 다음):

```ts
  /** (1-C2c) 복귀 판정 */
  returns: { skuId: number; qty: number }[];
  /** 실제로 기록한 복귀(자동 이동 켜짐 · 같은 날 이미 기록됐으면 빠진다) */
  returned: { skuId: number; qty: number }[];
  /** 복귀 예정 집합이 직전 실행과 다르다 */
  returnsChanged: boolean;
```

`skipped` 객체에 `returns: [], returned: [], returnsChanged: false`를 더한다.

`SNAP_SQL`을 다음으로 바꾼다.

```ts
const SNAP_SQL = `insert into erp.rg_recon_snapshots (run_id, run_at, sku_id, vid, ledger, actual, inbound, planned_move, moved, alert, planned_return, returned)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
```

직전 실행 쿼리(`with last as`)의 select에 `s.planned_return`을 더한다.

```ts
       select s.sku_id, s.vid, s.planned_move, s.planned_return, s.alert from erp.rg_recon_snapshots s join last on last.run_id = s.run_id`,
```

`planRgAuto` 호출 직전에 한도를 읽고, 행에 넣는다.

```ts
    const room = await returnRoomBySku(c, at, skuIds);
    const plan = planRgAuto(skuIds.map((skuId) => ({
      skuId, ledger: ledger.get(skuId) ?? 0, actual: actual.bySku.get(skuId) ?? 0, inbound: inbound.get(skuId) ?? 0,
      returnRoom: room.get(skuId) ?? 0, prevDiff: prev.get(skuId) ?? null, inflows: inflows.get(skuId) ?? [],
    })), unmapped, p.now);
```

(`skuIds`를 쓰므로 `room` 줄은 `skuIds`·`inactive` 계산 뒤에 둔다 — 지금 `plan` 바로 위.)

`moveOf` 선언 아래에 추가:

```ts
    const retOf = new Map(plan.returns.map((r) => [r.skuId, r.qty]));
    const returnedOf = new Map<number, number>();
    const day = kstDay(p.now);
```

`if (autoMove) { ... }` 블록 전체를 다음으로 바꾼다.

```ts
      if (autoMove) {
        const work = [...new Set([...plan.moves.map((x) => x.skuId), ...plan.returns.map((x) => x.skuId)])].sort((a, b) => a - b);
        for (const [n, skuId] of work.entries()) {
          await lockSku(c, skuId);
          await c.query(`savepoint rgauto_${n}`);
          try {
            // 읽은 뒤 잠금 전에 바뀌었을 수 있다(사람의 입고 완료·역전표·판매 차감) — 잠금 뒤 값으로 다시 잰다
            const read = async () => {
              const { rows: now } = await c.query(
                `select location, qty from erp.stock_on_hand where sku_id = $1 and location in ('rg', 'rg_inbound')`, [skuId],
              );
              return (loc: string) => Number(now.find((r) => r.location === loc)?.qty ?? 0);
            };
            const act = actual.bySku.get(skuId) ?? 0;
            let onHand = await read();
            if (moveOf.has(skuId)) {
              const qty = Math.min(act - onHand('rg'), onHand('rg_inbound'));
              if (qty > 0) {
                await postTransfer(c, {
                  skuId, from: 'rg_inbound', to: 'rg', qty, occurredAt: at,
                  idemKey: `rgauto:${runId}:${skuId}`, refType: 'rg_auto', refId: runId, note: 'RG 입고 완료(자동 대조)',
                });
                movedOf.set(skuId, qty);
                onHand = await read();
              }
            }
            if (retOf.has(skuId)) {
              const roomNow = (await returnRoomBySku(c, at, [skuId])).get(skuId) ?? 0;
              const qty = Math.min(act - onHand('rg'), roomNow);
              if (qty > 0) {
                const unitCost = (await latestLotCost(c, skuId)) ?? (await legacyUnitCost(c, skuId));
                if (unitCost === null) {
                  alerts.push({ kind: 'return_no_cost', skuId, qty });
                } else {
                  const r = await postLotCreate(c, {
                    skuId, location: 'rg', qty, unitCost, kind: 'adjust', reason: 'rg_return', occurredAt: at,
                    idemKey: `rg-return:${skuId}:${day}`, refType: 'rg_auto', refId: runId, note: 'RG 취소·반품 복귀(자동 대조)',
                  });
                  if (r.posted) returnedOf.set(skuId, qty);
                }
              }
            }
            await c.query(`release savepoint rgauto_${n}`);
          } catch (e) {
            await c.query(`rollback to savepoint rgauto_${n}`);
            movedOf.delete(skuId);
            returnedOf.delete(skuId);
            alerts.push({ kind: 'move_failed', skuId, error: maskPII(e instanceof Error ? e.message : String(e)) });
          }
        }
      }
```

스냅샷 기록 두 줄을 칸에 맞게 바꾼다.

```ts
      for (const skuId of [...skuIds, ...inactive]) {
        await c.query(SNAP_SQL, [runId, at, skuId, null, ledger.get(skuId) ?? 0, actual.bySku.get(skuId) ?? 0, inbound.get(skuId) ?? 0,
          moveOf.get(skuId) ?? 0, movedOf.get(skuId) ?? 0, joined(`s:${skuId}`), retOf.get(skuId) ?? 0, returnedOf.get(skuId) ?? 0]);
      }
      for (const u of unmapped) {
        await c.query(SNAP_SQL, [runId, at, null, u.vid, 0, u.qty, 0, 0, 0, joined(`v:${u.vid}`), 0, 0]);
      }
```

반환문 앞에 직전 복귀 예정을 만들고, 반환 객체에 칸을 더한다.

```ts
    const prevReturns = lastRun.filter((r) => r.sku_id != null && Number(r.planned_return ?? 0) > 0).map((r) => ({ skuId: Number(r.sku_id), qty: Number(r.planned_return) }));
    return {
      skipped: null, autoMove, runId, skus: skuIds.length, moves: plan.moves,
      moved: [...movedOf].map(([skuId, qty]) => ({ skuId, qty })), failed: alerts.filter((a) => a.kind === 'move_failed').length,
      alerts: texts, newAlerts, movesChanged: moveKey(plan.moves) !== moveKey(prevMoves),
      returns: plan.returns, returned: [...returnedOf].map(([skuId, qty]) => ({ skuId, qty })),
      returnsChanged: moveKey(plan.returns) !== moveKey(prevReturns),
    };
```

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/stock/` · Expected: PASS(기존 포함 전부). 기존 「잠금 뒤 다시 읽는다」 두 테스트가 `savepoint` 위치 변경으로 깨지면, `savepoint`가 이제 잠금 직후·읽기 전에 오는 것이 의도이므로 기대값이 아니라 위 구현을 다시 확인한다(기존 기대는 `toContain`이라 위치 무관).

- [ ] **Step 6: 타입 검사** — Run: `npx tsc --noEmit -p . 2>&1 | grep -E "rg-auto|rg-return" ` · Expected: 출력 없음.

- [ ] **Step 7: Commit**

```bash
git add src/lib/erp/stock/rg-auto-run.ts src/__tests__/lib/erp/stock/rg-auto-run.test.ts
git commit -m "feat(erp): RG 대조 실행기 — 입고 뒤 취소·반품 복귀 기록(잠금 뒤 재계산·단가 없음 보류)"
```

---

### Task 5: 크론 라우트 — 텔레그램에 복귀

**Files:**
- Modify: `src/app/api/cron/rg-reconcile/route.ts`

- [ ] **Step 1: counts·머리줄 수정** — `counts`에 `returns: r.returns.length, returned_qty: r.returned.reduce((a, x) => a + x.qty, 0)`을 더하고, `head` 계산을 다음으로 바꾼다.

```ts
    const sum = (xs: { qty: number }[]) => xs.reduce((a, x) => a + x.qty, 0);
    const moveHead = s.autoMove
      ? (s.moved.length > 0 ? `✅ RG 입고 완료 자동 ${s.moved.length}건${s.failed > 0 ? ` · 실패 ${s.failed}건` : ''}` : null)
      : (s.movesChanged && s.moves.length > 0 ? `🟡 RG 대조 — 옮길 예정 ${s.moves.length}건(자동 이동 꺼짐)` : null);
    // (1-C2c) 복귀 — 실제로 기록했으면 늘, 꺼져 있으면 예정이 직전과 달라졌을 때만
    const retHead = s.autoMove
      ? (s.returned.length > 0 ? `🔵 RG 취소·반품 복귀 ${s.returned.length}건 ${sum(s.returned)}개` : null)
      : (s.returnsChanged && s.returns.length > 0 ? `🔵 RG 취소·반품 복귀 예정 ${s.returns.length}건 ${sum(s.returns)}개(자동 이동 꺼짐)` : null);
    const head = [moveHead, retHead].filter(Boolean).join('\n') || null;
```

(뒤의 `if (chatId && !s.skipped && (head || s.newAlerts.length > 0))`와 `text` 조립은 그대로.)

- [ ] **Step 2: 타입 검사** — Run: `npx tsc --noEmit -p . 2>&1 | grep rg-reconcile` · Expected: 출력 없음.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/rg-reconcile/route.ts
git commit -m "feat(erp): RG 대조 텔레그램 — 취소·반품 복귀 머리줄"
```

---

### Task 6: 마지막 결과 API·화면 — 복귀 칸

**Files:**
- Modify: `src/app/api/erp/stock/rg-auto/route.ts`
- Modify: `src/components/erp/stock/RgAutoPanel.tsx:27-29`

- [ ] **Step 1: API** — select에 `s.planned_return, s.returned`를 더하고, where를 `where s.planned_move > 0 or s.moved > 0 or s.planned_return > 0 or s.returned > 0 or s.alert is not null`로, 행 매핑에 `plannedReturn: Number(r.planned_return), returned: Number(r.returned),`를 `moved` 다음에 더한다.

- [ ] **Step 2: 화면** — `RgAutoPanel.tsx` 29행 다음에 두 줄을 더한다.

```tsx
          {r.returned > 0 && <span style={{ color: E.profit }}> · 취소·반품 복귀 {r.returned}</span>}
          {r.returned === 0 && r.plannedReturn > 0 && <span style={{ color: E.warn }}> · 복귀 예정 {r.plannedReturn}</span>}
```

- [ ] **Step 3: 관련 테스트·타입** — Run: `npx vitest run src/__tests__/components/erp-rg-auto-panel.test.tsx && npx tsc --noEmit -p . 2>&1 | grep -E "rg-auto|RgAutoPanel"` · Expected: 테스트 PASS, 타입 출력 없음. 그 테스트의 행 픽스처가 타입에서 깨지면 픽스처에 `plannedReturn: 0, returned: 0`을 더한다.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/erp/stock/rg-auto/route.ts src/components/erp/stock/RgAutoPanel.tsx
git commit -m "feat(erp): RG 대조 마지막 결과에 복귀 예정·복귀 칸"
```

---

### Task 7: RG 어댑터 — 「사라지면 취소」 끄기

**Files:**
- Modify: `src/lib/erp/orders/adapters/coupang-rg.ts:3,104`
- Test: `src/__tests__/lib/erp/orders/adapters.test.ts:93`

- [ ] **Step 1: 테스트 기대 수정** — `adapters.test.ts` 93행(쿠팡 RG 어댑터 첫 테스트)을 바꾼다.

```ts
    // (1-C2c) RG API는 취소분을 응답에서 빼지 않는다(2026-10-05 실측) — 사라짐 판정을 하지 않는다
    expect(r.absenceMeansCancel).toBe(false);
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/orders/adapters.test.ts` · Expected: FAIL(true ≠ false).

- [ ] **Step 3: 구현** — 3행 주석을 다음으로 바꾸고, 104행을 `absenceMeansCancel: false,`로 바꾼다.

```ts
// RG API에는 취소·반품 표시가 없고 취소된 주문도 응답에 그대로 남는다(2026-10-05 실측 — 09-29~10-04 ERP와 날짜별 동일, Wing 판매분석보다 매일 1건 안팎 많다).
// 그래서 사라짐으로 취소를 판정하지 않는다(absenceMeansCancel false) — 취소·반품은 매일 RG 대조가 실재고로 복귀시킨다(1-C2c).
// paidDateFrom/To는 UTC 날짜로 거른다(KST 09시 이전 주문은 전날 조회에 든다). 같은 주문의 같은 vid 품목은 합친다(옛 불러오기와 같다).
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/orders/` · Expected: PASS(수집기 테스트에 RG 사라짐을 기대하는 것이 있으면 그 기대를 `false` 동작으로 고친다 — 사라짐 표시가 생기지 않아야 한다).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/orders/adapters/coupang-rg.ts src/__tests__/lib/erp/orders/adapters.test.ts
git commit -m "fix(erp): RG 어댑터 — 취소분이 응답에 남으므로 사라짐 취소 판정을 끈다"
```

---

### Task 8: 전체 검증·실행 기록

**Files:**
- Modify: `docs/superpowers/plans/2026-10-05-erp-phase1c2c-rg-returns.md`(이 파일 끝 「실행 기록」)

- [ ] **Step 1: 전체 ERP 테스트** — Run: `npx vitest run src/__tests__/lib/erp src/__tests__/components` · Expected: PASS. 실패가 있으면 이 작업이 만든 것인지 `git stash`로 비교해 가른다.

- [ ] **Step 2: 타입 전체** — Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: Task 1 Step 3에서 잰 작업 전 수와 같다.

- [ ] **Step 3: 마이그레이션 SQL을 운영 DB에서 트랜잭션으로 검증하고 롤백**

```bash
U=$(grep "^SUPABASE_DB_URL=" ../../.env.local | cut -d= -f2- | tr -d '"')
( echo 'begin;'; cat supabase/migrations/125_erp_rg_returns.sql; echo "select count(*) from erp.rg_recon_snapshots where planned_return <> 0 or returned <> 0;"; echo 'rollback;' ) | psql "$U" -v ON_ERROR_STOP=1
```

Expected: `ALTER TABLE` 4회 · count 0 · `ROLLBACK`.

- [ ] **Step 4: 실행 기록 작성** — 이 파일 끝에 「## 실행 기록」 절을 만들고 테스트 수·커밋·검증 결과를 적는다.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-10-05-erp-phase1c2c-rg-returns.md
git commit -m "docs(erp): 1-C2c 실행 기록"
```

---

## 병합 뒤 운영 순서 (사용자 게이트 — 이 계획의 범위 밖, 컨트롤러가 사용자에게 묻는다)

1. PR 병합(사용자 승인) → `node scripts/apply-migration.mjs 125`로 적용. 차감 꺼짐이라 대조는 건너뜀.
2. **게이트 ②** 차감 켜기(사용자 승인).
3. 사용자가 재고현황 「RG 실재고 대조」에서 8개 「반영」.
4. 자동 이동 꺼진 채 3회 「입고 예정·복귀 예정」 보고 → 사용자 승인으로 `rg_auto_arrive_enabled` 켜기.

## 실행 기록 (2026-10-05)

- 서브에이전트 구현 + 묶음마다 설계 대조·코드 품질 리뷰(묶음 A: 작업 1~3 · B: 4 · C: 5~7 · D: 8은 컨트롤러).
- 커밋: 05810336 · c32cbba4 · 38c2581d · cc57b534(사유 라벨·모킹 타입) · 49c13b80(리뷰: alloc 전개·복귀 창 상한·NaN 방어) · 4fac778f · cc94ce6d(리뷰: 잠금 뒤 재계산은 판정을 넘지 않는다·return_failed·dry 단가 확인) · 766a1ae6(설계: 재고 API 지연은 게이트 4에서 측정) · d71fcbf0 · 1a2f1930 · 7e3eb089.
- 🔴 리뷰가 잡은 것: ① 잠금 뒤 재계산이 판정보다 커질 수 있었다 — 쿠팡 재고를 트랜잭션 전에 읽어 그 사이 판매 차감이 「실재고 − 원장」을 부풀린다(옛 입고 이동에도 있던 결함). ② 복귀 한도가 묶음 줄을 빠뜨린다(지금 RG 묶음 0줄). ③ 한도 누락 시 NaN이 「보낸 기록 없는 증가」 알림을 지운다.
- 테스트: `src/__tests__/lib/erp` 전부 통과. 실패 7파일(cleanup-image-region · costco-naver-compare-handler · analyze-detail-images · keyword-discover · keyword-suggest-with-evaluate · assets-tab · detail-maker-thumbnail-panel)은 **main(96ab81c3)에서도 같은 파일이 실패** — 이 브랜치가 만든 실패 0.
- `tsc --noEmit` 오류 0.
- 마이그레이션 125를 운영 DB에서 트랜잭션으로 실행 → 기존 사유 38줄 제약 통과 · 새 칸 0 → ROLLBACK(칸 없음 확인).
- 복귀 한도 읽기 전용 실측: SKU 72 = 284 · 73 = 223 · 74 = 58 · 88 = 25 · 70 = 10(복귀 0).
- RG `absent_since` 남은 줄 0 — 사라짐 판정을 꺼도 정리할 데이터 없음.
- 남긴 Minor(후속): 텔레그램 복귀 줄에 SKU명 · 수동 dry 라벨 「(자동 이동 꺼짐)」 부정확 · 실패 줄 매일 반복(의도 — 실패는 숨기지 않는다).
