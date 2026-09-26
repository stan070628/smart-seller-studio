# ERP 1-B — 재고 원장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SKU별·위치별 재고와 FIFO 원가를 담는 `erp.stock_ledger`를 세우고, 전환일 기초재고(RG = 쿠팡 실재고 · 자체보관 = 실사)를 적재해 **원장 RG 재고 = 쿠팡 RG 실재고**를 확인한다.

**Architecture:** 원장은 insert-only 전표 테이블이다. 수정·삭제는 트리거가 막고, 음수 재고는 지연 제약 트리거가 커밋 시점에 막는다. lot은 「lot을 만든 전표의 id」로 식별하고, 차감·이동 전표는 그 id를 `lot_id`로 가리킨다. 재고는 저장하지 않고 뷰(`stock_lots`·`stock_on_hand`)로 계산한다. FIFO 배분·전표 계획은 DB 없는 순수 함수(`fifo.ts`·`plan.ts`)이고, DB 쓰기(`store.ts`)는 SKU 단위 advisory lock과 멱등키로 감싼다.

**Tech Stack:** Postgres 17(Supabase) · `pg` · TypeScript · vitest · tsx 스크립트

---

## 사전 정보 (실행자는 반드시 읽는다)

- 작업 폴더: `~/dev/smart_seller_studio/.worktrees/erp-restructure` (브랜치 `feature/erp-restructure`, `origin/main` 6857146e 기준). 모든 명령은 여기서.
- **기존 실패 테스트 13건**(ERP 무관)이 있다. 합격 기준 = 새 테스트 전부 통과 + 전체 실패 13 이하 + `npx tsc --noEmit` 0 오류.
- DB: `.env.local`의 `SUPABASE_DB_URL`. 비밀값 출력 금지. 마이그레이션 적용은 `node scripts/apply-migration.mjs <번호>`(트랜잭션으로 감싼다 — 파일 안에 BEGIN/COMMIT 금지).
- 스크립트 실행: `npx --no-install tsx scripts/erp/<파일>.ts`. 첫 줄에서 `loadEnvLocal()`(`scripts/erp/_env.ts`)을 부른다. 스크립트는 풀이 아니라 `new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })`로 접속한다(`scripts/erp/sku-apply.ts` 참고).
- 쿠팡 API는 로컬에서 직접 호출된다(집 IP가 허용 목록에 있다). RG 재고: `getCoupangClient().getRocketGrowthInventories({ nextToken })` → `{ items: [{ vendorItemId, totalOrderableQuantity, externalSkuId }], nextToken }` (`src/lib/listing/coupang-client.ts:828`). **이 응답에는 입고중·검수중 수량이 없다**(공식 문서 확인 2026-09-26) — 판매 가능 수량뿐이다.
- 🔴 **구매자 개인정보를 파일·로그에 쓰지 않는다.** 이 계획이 읽는 판매 데이터는 수량 합계뿐이다.
- 🔴 **사용자 확인 게이트**(Task 10)에서 멈춘다. 기초재고 적재(Task 11 `--apply`)는 사용자가 실사표를 채운 뒤에만.
- **erp 스키마 접근 경로(P4 결정):** 서버 코드는 `pg`로 직접 접속한다(`src/lib/jobs/run-log.ts`의 `getSourcingPool()` 방식). supabase-js로 `erp`를 읽으려면 grant와 스키마 노출이 필요하므로 쓰지 않는다.
- **SKU 키 동결(P5):** 1-A 이후 `erp.skus.key`는 바꾸지 않는다. 원장은 `sku_id`만 참조한다. Task 7이 「재고가 있는 SKU의 보관」을 막는다.

## 사용자 결정 (2026-09-26)

| 항목 | 결정 | 근거 |
|---|---|---|
| 기초재고 방식 | **전환일 기초재고** — RG는 쿠팡 RG 실재고 API 값, 자체보관은 실사. 실사표는 기존 계산값(입고 − 판매 − RG 실재고)을 미리 채워 틀린 칸만 고친다. lot 단가는 최근 입고부터 거슬러 가중평균. 과거 판매·입고는 옛 테이블에 둔다 | 과거 기록에는 재고 위치가 없다 — 영수증 입고는 항상 `wing`, RG 입고 처리는 `channel='rg'`를 찍지 않고, `rg_shipment_events`는 3건뿐이며 트랜잭션 밖에서 쓰인다. 전부 재생하면 차이가 전부 의미 없는 조정 전표가 된다 |
| RG 입고 추적 | RG 입고 API는 없다. 원장 위치에 **`rg_inbound`(입고중)**를 두고, 1-C에서 「RG 판매 가능 수량이 원장 RG보다 늘어난 만큼 `rg_inbound → rg`」로 입고 완료를 처리한다 | 2026-09-26 사용자 제안(「RG 입고 API가 있으면 재고 관리가 잘 될 것」) → 공식 문서 확인 결과 없음 → 재고 API를 입고 확인 신호로 쓴다 |

## 조사 사실 (2026-09-26 읽기 전용 조사)

| 사실 | 계획에 주는 영향 |
|---|---|
| `cost_entries` 345행: `quantity`는 **판매 단위(소분 후 팩 수)**, `unit_cost`는 그 단위의 원가(소분 모드는 `calculateSubdivision`이 팩 단가로 환산). 소수 수량 0건 | 원장 수량은 정수. lot 단가 = `unit_cost`(기존 FIFO `stock_value`와 같은 정의 — 배송비·RG 물류비는 넣지 않는다) |
| `sale_records.quantity`는 배수가 이미 곱해진 SKU 기준 단위 | 추정치 계산에 그대로 쓴다 |
| `sale_records` RG 무효 1,062건이 가져오기 날짜별로 몰려 있다(「이번 응답에 없는 키는 무효」 로직 의심). Wing은 가져오기 경로마다 키가 달라(`wing-…`/`…`) 중복 가능 | 자체보관 추정치를 믿을 수 없다 → 실사표에 무효 수량을 함께 보여준다. 원인 수정은 1-C |
| `product_costs.current_stock` 전부 0 — 저장 재고는 없다 | 기초재고의 유일한 출처는 RG API + 실사 |
| `purchase_units` 0행 | 1-C(입고 전표)에서 적재 |

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/111_erp_origin.sql` | skus·channel_listings·listing_skus에 `origin`(draft/manual) |
| `supabase/migrations/112_erp_origin_default_manual.sql` | `origin` 기본값을 manual로(적재 스크립트만 draft를 명시) — Task 1 리뷰 |
| `scripts/erp/sku-apply.ts` (수정) | 보관·비활성화·연결 재작성을 `origin='draft'`로 한정 · 재고 있는 SKU 보관 거부 |
| `src/lib/erp/sku/draft.ts` (수정) | P1 — seller_product_id 2차 연결 |
| `supabase/migrations/113_erp_stock_ledger.sql` | 원장 테이블·트리거·뷰·`sync_cursors` |
| `src/lib/erp/ledger/fifo.ts` | 위치 타입 · FIFO 배분 |
| `src/lib/erp/ledger/plan.ts` | 전표 계획(lot 생성·차감·이동·역전표) — 순수 함수 |
| `src/lib/erp/ledger/store.ts` | 잠금·멱등·lot 조회·전표 기록 |
| `src/lib/erp/ledger/opening.ts` | 기초재고: RG 수량 환산 · 그룹 · 추정 · 단가 · CSV · 대조 |
| `scripts/erp/ledger-selftest.ts` | 실제 DB에서 트리거·제약을 롤백 트랜잭션으로 시험 |
| `scripts/erp/opening-collect.ts` | 실사표 CSV + 점검 보고서 생성(읽기 전용) |
| `scripts/erp/opening-apply.ts` | 기초재고 적재 (점검 / `--apply` / `--verify`) |
| `scripts/erp/rg-reconcile.ts` | 원장 RG ↔ 쿠팡 RG 실재고 대조(1-C에서 매일 재사용) |
| `src/__tests__/lib/erp/ledger/*.test.ts` | 단위 테스트 |

---

### Task 1: 행 출처(origin) — 적재 스크립트가 손으로 만든 행을 건드리지 않게

**Files:**
- Create: `supabase/migrations/111_erp_origin.sql`
- Modify: `scripts/erp/sku-apply.ts`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 111_erp_origin.sql
-- ERP 1-B 선행(P2): 행 출처. 'draft' = sku-apply가 초안에서 적재한 행, 'manual' = 1-B 이후 화면·스크립트가 만든 행.
-- sku-apply는 「초안이 전부」라 가정하고 초안에 없는 행을 보관·비활성화·삭제한다 — 그 범위를 draft로 한정한다.
alter table erp.skus
  add column if not exists origin text not null default 'draft' check (origin in ('draft', 'manual'));
alter table erp.channel_listings
  add column if not exists origin text not null default 'draft' check (origin in ('draft', 'manual'));
alter table erp.listing_skus
  add column if not exists origin text not null default 'draft' check (origin in ('draft', 'manual'));
```

- [ ] **Step 2: 적용**

Run: `node scripts/apply-migration.mjs 111`
Expected: 성공 메시지, exit 0

- [ ] **Step 3: `sku-apply.ts`의 쓰기를 draft로 한정**

`apply()` 안의 다섯 곳을 아래처럼 바꾼다.

SKU upsert — manual 행은 덮어쓰지 않는다:
```ts
         on conflict (key) do update set name = excluded.name, option_label = excluded.option_label,
           base_unit_label = excluded.base_unit_label, status = excluded.status,
           legacy_product_cost_ids = excluded.legacy_product_cost_ids, updated_at = now()
         where erp.skus.origin = 'draft'
         returning id`,
```
🔴 `where`가 걸려 갱신되지 않은 행은 `returning`이 빈 배열을 준다. 바로 다음 줄을 이렇게 바꾼다:
```ts
      if (rows.length === 0) throw new Error(`초안 키 ${s.key}가 manual SKU와 겹친다 — 초안을 고친다`);
      skuId.set(s.key, Number(rows[0].id));
```

SKU 보관:
```ts
      `update erp.skus set status = 'archived', updated_at = now()
        where status <> 'archived' and origin = 'draft' and not (key = any($1::text[]))`,
```

리스팅 upsert:
```ts
         on conflict (channel, external_product_id, external_option_key) do update
           set alt_product_id = excluded.alt_product_id, label = excluded.label, link_mode = excluded.link_mode, active = true
         where erp.channel_listings.origin = 'draft'
         returning id`,
```
다음 줄:
```ts
      if (rows.length === 0) throw new Error(`초안 리스팅 ${l.key}가 manual 리스팅과 겹친다 — 초안을 고친다`);
      listingId.set(l.key, Number(rows[0].id));
```

리스팅 비활성화:
```ts
      `update erp.channel_listings set active = false where active and origin = 'draft' and not (id = any($1::bigint[]))`,
```

연결 재작성:
```ts
    await c.query(`delete from erp.listing_skus where origin = 'draft'`);
    for (const k of d.links) {
      const lid = listingId.get(k.listingKey);
      const sid = skuId.get(k.skuKey);
      if (!lid || !sid) throw new Error(`연결 대상 누락: ${k.listingKey} → ${k.skuKey}`);
      await c.query(
        `insert into erp.listing_skus (listing_id, sku_id, multiplier) values ($1, $2, $3)
         on conflict (listing_id, sku_id) do nothing`,
        [lid, sid, k.multiplier],
      );
    }
```

`dryRun()`의 조회 두 줄도 draft만 비교하도록 바꾼다:
```ts
    const dbSkus = (await c.query(`select key, name, option_label, base_unit_label, status, legacy_product_cost_ids::text[] as legacy from erp.skus where origin = 'draft'`)).rows;
    const dbListings = (await c.query(`select id, channel, external_product_id, external_option_key, alt_product_id, label, link_mode, active from erp.channel_listings where origin = 'draft'`)).rows;
```
그리고 `dbLinks` 조회의 `from erp.listing_skus x` 뒤에 `where x.origin = 'draft'`를 넣는다(조인 뒤, 기존 쿼리 끝에 `where x.origin = 'draft'` 추가).

파일 머리 주석의 `--apply` 설명에 한 줄을 더한다:
```ts
//           보관·비활성화·연결 삭제는 origin='draft' 행에만 한다 — 1-B 이후 손으로 만든 행(manual)은 건드리지 않는다.
```

- [ ] **Step 4: 점검 모드로 변화 0 확인**

Run: `npx --no-install tsx scripts/erp/sku-apply.ts`
Expected: SKU·리스팅 모두 `삽입 0 · 갱신 0 · 보관(비활성화) 0`(나머지는 전부 「동일」), `연결 … 신규 0 · 배수변경 0 · 삭제 0`. 하나라도 0이 아니면 멈추고 보고한다.

- [ ] **Step 5: 타입 검사와 커밋**

Run: `npx tsc --noEmit` → 0 오류
```bash
git add supabase/migrations/111_erp_origin.sql scripts/erp/sku-apply.ts
git commit -m "feat(erp): 행 출처 origin — sku-apply가 손으로 만든 행을 건드리지 않게(P2)"
```

---

### Task 2: 옛 원가 행의 2차 연결 (P1)

**Files:**
- Modify: `src/lib/erp/sku/draft.ts` (legacy vendorItemId 루프 바로 뒤, `legacy_spans_skus` 루프 바로 앞 — 현재 267~272행 사이)
- Test: `src/__tests__/lib/erp/sku/draft.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (`describe('buildDraft', …)` 블록 안 끝에 추가)

```ts
  it('vid로 어느 SKU에도 닿지 않은 옛 원가 행은 같은 seller_product_id의 SKU 전부에 잇는다(P1)', () => {
    const d = buildDraft({
      ...base,
      legacyProductCosts: [...base.legacyProductCosts, { id: 'pc-orphan', productName: '왜건 옛 행', sellerProductId: 200, vendorItemId: null }],
    });
    const wagon = d.skus.filter((s) => s.key.startsWith('cp:200:'));
    expect(wagon).toHaveLength(2);
    for (const s of wagon) expect(s.legacyProductCostIds).toContain('pc-orphan');
    expect(d.issues).toContainEqual(expect.objectContaining({ kind: 'legacy_spans_skus', ref: 'pc-orphan' }));
  });

  it('쿠팡 상품이 없거나 가상 seller_product_id(음수)인 옛 원가 행은 잇지 않는다', () => {
    const d = buildDraft({
      ...base,
      legacyProductCosts: [
        ...base.legacyProductCosts,
        { id: 'pc-lost', productName: '사라진 상품', sellerProductId: 999, vendorItemId: null },
        { id: 'pc-virtual', productName: '가상', sellerProductId: -3, vendorItemId: null },
      ],
    });
    for (const s of d.skus) {
      expect(s.legacyProductCostIds).not.toContain('pc-lost');
      expect(s.legacyProductCostIds).not.toContain('pc-virtual');
    }
  });

  it('vid로 이미 닿은 옛 원가 행은 2차 연결로 늘리지 않는다', () => {
    const d = buildDraft(base);
    const withWagon = d.skus.filter((s) => s.legacyProductCostIds.includes('pc-wagon')).map((s) => s.key).sort();
    expect(withWagon).toEqual(['cp:200:레드', 'cp:200:블랙']);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/sku/draft.test.ts`
Expected: 첫 테스트 FAIL(`pc-orphan` 없음). 나머지 둘은 통과할 수 있다(회귀 방지용).

- [ ] **Step 3: 구현** — `for (const pc of input.legacyProductCosts) { if (pc.vendorItemId && …) note(…) }` 루프 바로 뒤에:

```ts
  // P1: vid로 어느 SKU에도 닿지 않은 옛 원가 행(pcc·vendor_item_id 없음)은 같은 seller_product_id의 SKU 전부에 잇는다.
  //     원가·입고 이력이 SKU에서 끊기면 기초재고 단가를 못 찾는다. 여러 SKU면 아래에서 legacy_spans_skus로 올라간다.
  const skuKeysBySpid = new Map<number, string[]>();
  for (const k of skus.keys()) {
    const m = /^cp:(\d+):/.exec(k);
    if (m) skuKeysBySpid.set(Number(m[1]), [...(skuKeysBySpid.get(Number(m[1])) ?? []), k]);
  }
  for (const pc of input.legacyProductCosts) {
    if (pcSkus.has(pc.id) || pc.sellerProductId <= 0) continue;
    for (const k of skuKeysBySpid.get(pc.sellerProductId) ?? []) note(pc.id, k);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/sku`
Expected: 전부 PASS (기존 72 + 새 3)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/sku/draft.ts src/__tests__/lib/erp/sku/draft.test.ts
git commit -m "feat(erp): 옛 원가 행을 seller_product_id로 2차 연결(P1)"
```

---

### Task 3: P1 재적재

**Files:**
- Regenerate: `docs/erp/sku-draft-<오늘>.json`, `docs/erp/sku-review-<오늘>.md`

- [ ] **Step 1: 초안 재생성** (DB 읽기 전용 + 쿠팡 GET만)

Run: `npx --no-install tsx scripts/erp/sku-collect.ts`
Expected: `coupangFetchFailed` 0건. 실패가 있으면 다시 돌린다.

- [ ] **Step 2: 점검 모드로 차이 확인**

Run: `npx --no-install tsx scripts/erp/sku-apply.ts`
Expected: **SKU 갱신 N(옛 원가 연결이 늘어난 SKU) · 삽입 0 · 보관 0**, 리스팅 **삽입 0 · 갱신 0 · 비활성화 0**, 연결 **신규 0 · 배수변경 0 · 삭제 0**.
🔴 리스팅·연결에 변화가 있거나 SKU 삽입·보관이 있으면 **적재하지 말고 멈춰 보고한다** — 1-A 이후 쿠팡 상품이 바뀐 것이고, 그 판단은 사용자 몫이다.

- [ ] **Step 3: 적재와 검증**

Run: `npx --no-install tsx scripts/erp/sku-apply.ts --apply && npx --no-install tsx scripts/erp/sku-apply.ts --verify`
Expected: `✅ 적재 완료`, verify에서 `listing without sku 0`, `sync link unmapped 0`.

그리고 끊긴 옛 원가 행이 0인지 확인한다:
```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const r=await c.query(\"select count(*)::int n from product_costs pc where not exists (select 1 from erp.skus s where pc.id = any(s.legacy_product_cost_ids)) and pc.seller_product_id > 0\");
console.log('SKU에 닿지 않은 옛 원가 행:', r.rows[0].n);await c.end()})()"
```
Expected: 0 (P1 이전 28). 0이 아니면 남은 행의 `product_name`·`seller_product_id`를 보고한다(쿠팡에서 사라진 상품일 수 있다).

- [ ] **Step 4: 커밋**

```bash
git add docs/erp/
git commit -m "chore(erp): P1 반영 초안 재생성·재적재"
```

---

### Task 4: 원장 스키마

**Files:**
- Create: `supabase/migrations/113_erp_stock_ledger.sql`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 113_erp_stock_ledger.sql
-- ERP 1-B: 재고 원장. 재고는 저장하지 않고 전표 합계로 계산한다.
--
-- lot: 「lot을 만든 전표」(기초·입고·양수 조정, lot_id null)의 id가 곧 lot 번호다.
--      차감·이동·반품·역전표는 lot_id로 그 전표를 가리킨다. lot 단가는 lot을 만든 전표에만 있다.
-- 위치: self(자체보관) · rg_inbound(RG로 보냈으나 아직 판매 가능 수량에 안 잡힘) · rg(RG 판매 가능).
--      RG 입고 API는 없다(2026-09-26 공식 문서 확인) — rg_inbound → rg 이동은 1-C가 RG 재고 증가로 처리한다.
-- 불변: 수정·삭제·truncate 금지(트리거). 틀린 전표는 역전표(kind='reversal')로 상쇄한다.
-- 음수 금지: (SKU·위치·lot) 합계가 음수가 되면 커밋 시점에 실패한다(지연 제약 트리거).

create table if not exists erp.stock_ledger (
  id           bigserial   primary key,
  sku_id       bigint      not null references erp.skus(id),
  location     text        not null check (location in ('self', 'rg_inbound', 'rg')),
  qty          integer     not null check (qty <> 0),
  kind         text        not null check (kind in ('opening', 'receipt', 'transfer', 'sale', 'return', 'adjust', 'reversal')),
  lot_id       bigint      references erp.stock_ledger(id),
  unit_cost    integer     check (unit_cost >= 0),
  occurred_at  timestamptz not null,
  ref_type     text,
  ref_id       text,
  reverses_id  bigint      unique references erp.stock_ledger(id),
  idem_key     text        not null unique,
  note         text,
  created_at   timestamptz not null default now(),
  check ((lot_id is null) = (unit_cost is not null)),
  check (lot_id is not null or (qty > 0 and kind in ('opening', 'receipt', 'adjust'))),
  check ((kind = 'reversal') = (reverses_id is not null))
);

create index if not exists stock_ledger_lot_idx on erp.stock_ledger (sku_id, location, (coalesce(lot_id, id)));
create index if not exists stock_ledger_ref_idx on erp.stock_ledger (ref_type, ref_id);
create index if not exists stock_ledger_idem_prefix_idx on erp.stock_ledger (idem_key text_pattern_ops);

create or replace function erp.stock_ledger_guard() returns trigger language plpgsql as $$
declare
  lot_row erp.stock_ledger%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'erp.stock_ledger는 고치거나 지우지 않는다 — 역전표로 상쇄한다 (%)', tg_op;
  end if;
  if new.lot_id is not null then
    select * into lot_row from erp.stock_ledger where id = new.lot_id;
    if lot_row.id is null or lot_row.lot_id is not null or lot_row.sku_id <> new.sku_id then
      raise exception 'lot_id %는 같은 SKU의 lot 생성 전표가 아니다', new.lot_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists stock_ledger_guard on erp.stock_ledger;
create trigger stock_ledger_guard before insert or update or delete on erp.stock_ledger
  for each row execute function erp.stock_ledger_guard();
drop trigger if exists stock_ledger_no_truncate on erp.stock_ledger;
create trigger stock_ledger_no_truncate before truncate on erp.stock_ledger
  for each statement execute function erp.stock_ledger_guard();

create or replace function erp.stock_ledger_balance() returns trigger language plpgsql as $$
declare
  bal bigint;
begin
  select coalesce(sum(qty), 0) into bal from erp.stock_ledger
   where sku_id = new.sku_id and location = new.location and coalesce(lot_id, id) = coalesce(new.lot_id, new.id);
  if bal < 0 then
    raise exception 'SKU % · % · lot %의 재고가 음수가 된다 (%)', new.sku_id, new.location, coalesce(new.lot_id, new.id), bal;
  end if;
  return null;
end $$;

drop trigger if exists stock_ledger_balance on erp.stock_ledger;
create constraint trigger stock_ledger_balance after insert on erp.stock_ledger
  deferrable initially deferred for each row execute function erp.stock_ledger_balance();

create or replace view erp.stock_lots with (security_invoker = true) as
select l.sku_id, l.location, coalesce(l.lot_id, l.id) as lot_id, sum(l.qty)::int as qty, h.unit_cost, h.occurred_at as lot_at
  from erp.stock_ledger l
  join erp.stock_ledger h on h.id = coalesce(l.lot_id, l.id)
 group by l.sku_id, l.location, coalesce(l.lot_id, l.id), h.unit_cost, h.occurred_at
having sum(l.qty) <> 0;

create or replace view erp.stock_on_hand with (security_invoker = true) as
select sku_id, location, sum(qty)::int as qty, sum(qty::bigint * unit_cost)::bigint as value
  from erp.stock_lots
 group by sku_id, location;

-- 채널별·작업별 마지막 처리 시각. 'ledger_cutover' = 기초재고 시각(1-C 수집의 시작점).
create table if not exists erp.sync_cursors (
  name        text        primary key,
  cursor_at   timestamptz not null,
  updated_at  timestamptz not null default now()
);

alter table erp.stock_ledger enable row level security;
alter table erp.sync_cursors enable row level security;
```

- [ ] **Step 2: 적용**

Run: `node scripts/apply-migration.mjs 113`
Expected: 성공, exit 0

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/113_erp_stock_ledger.sql
git commit -m "feat(erp): 재고 원장 스키마 — insert-only 전표 · lot · 음수 금지 · 재고 뷰"
```

---

### Task 5: FIFO 배분과 전표 계획 (순수 함수)

**Files:**
- Create: `src/lib/erp/ledger/fifo.ts`, `src/lib/erp/ledger/plan.ts`
- Test: `src/__tests__/lib/erp/ledger/fifo.test.ts`, `src/__tests__/lib/erp/ledger/plan.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/fifo.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { allocateFifo, InsufficientStockError, type LotBalance } from '@/lib/erp/ledger/fifo';

const lots: LotBalance[] = [
  { lotId: 20, qty: 5, unitCost: 1200, lotAt: 2000 },
  { lotId: 10, qty: 10, unitCost: 1000, lotAt: 1000 },
  { lotId: 30, qty: 0, unitCost: 900, lotAt: 500 },
];

describe('allocateFifo', () => {
  it('오래된 lot부터 소진한다', () => {
    expect(allocateFifo(lots, 12)).toEqual([
      { lotId: 10, qty: 10, unitCost: 1000 },
      { lotId: 20, qty: 2, unitCost: 1200 },
    ]);
  });

  it('lot 시각이 같으면 lot 번호 순이다', () => {
    const same: LotBalance[] = [
      { lotId: 7, qty: 1, unitCost: 1, lotAt: 1000 },
      { lotId: 3, qty: 1, unitCost: 2, lotAt: 1000 },
    ];
    expect(allocateFifo(same, 1)).toEqual([{ lotId: 3, qty: 1, unitCost: 2 }]);
  });

  it('잔량 0 lot은 건너뛴다', () => {
    expect(allocateFifo(lots, 1)[0].lotId).toBe(10);
  });

  it('가용보다 많으면 InsufficientStockError(필요·가용)', () => {
    try {
      allocateFifo(lots, 16);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientStockError);
      expect((e as InsufficientStockError).need).toBe(16);
      expect((e as InsufficientStockError).have).toBe(15);
    }
  });

  it.each([0, -1, 1.5, Number.NaN])('수량 %s는 RangeError', (q) => {
    expect(() => allocateFifo(lots, q)).toThrow(RangeError);
  });
});
```

`src/__tests__/lib/erp/ledger/plan.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { planLotCreate, planConsume, planTransfer, planReversal, type StoredRow } from '@/lib/erp/ledger/plan';
import type { LotBalance } from '@/lib/erp/ledger/fifo';

const AT = '2026-09-26T01:00:00.000Z';
const lots: LotBalance[] = [
  { lotId: 10, qty: 10, unitCost: 1000, lotAt: 1000 },
  { lotId: 20, qty: 5, unitCost: 1200, lotAt: 2000 },
];

describe('planLotCreate', () => {
  it('lot_id 없이 단가를 가진 양수 전표 하나', () => {
    expect(planLotCreate({ skuId: 1, location: 'self', qty: 4, unitCost: 500, kind: 'opening', occurredAt: AT, idemKey: 'opening:1:self', refType: 'opening', refId: 'x.csv' }))
      .toEqual([{ skuId: 1, location: 'self', qty: 4, kind: 'opening', lotId: null, unitCost: 500, occurredAt: AT, refType: 'opening', refId: 'x.csv', reversesId: null, idemKey: 'opening:1:self', note: null }]);
  });

  it.each([-1, 1.5])('단가 %s는 RangeError', (u) => {
    expect(() => planLotCreate({ skuId: 1, location: 'self', qty: 1, unitCost: u, kind: 'receipt', occurredAt: AT, idemKey: 'k' })).toThrow(RangeError);
  });
});

describe('planConsume', () => {
  it('lot별 음수 전표, 멱등키에 순번', () => {
    const rows = planConsume({ skuId: 1, location: 'self', qty: 12, kind: 'sale', occurredAt: AT, idemKey: 'sale:A' }, lots);
    expect(rows.map((r) => [r.lotId, r.qty, r.unitCost, r.idemKey])).toEqual([
      [10, -10, null, 'sale:A#0'],
      [20, -2, null, 'sale:A#1'],
    ]);
    expect(rows.every((r) => r.kind === 'sale' && r.location === 'self')).toBe(true);
  });
});

describe('planTransfer', () => {
  it('lot마다 출발지 음수·도착지 양수 쌍, lot 번호 유지', () => {
    const rows = planTransfer({ skuId: 1, from: 'self', to: 'rg_inbound', qty: 11, occurredAt: AT, idemKey: 'tr:1' }, lots);
    expect(rows.map((r) => [r.location, r.lotId, r.qty, r.idemKey])).toEqual([
      ['self', 10, -10, 'tr:1#0:out'],
      ['rg_inbound', 10, 10, 'tr:1#0:in'],
      ['self', 20, -1, 'tr:1#1:out'],
      ['rg_inbound', 20, 1, 'tr:1#1:in'],
    ]);
    expect(rows.every((r) => r.kind === 'transfer' && r.unitCost === null)).toBe(true);
  });

  it('출발지와 도착지가 같으면 RangeError', () => {
    expect(() => planTransfer({ skuId: 1, from: 'rg', to: 'rg', qty: 1, occurredAt: AT, idemKey: 'k' }, lots)).toThrow(RangeError);
  });
});

describe('planReversal', () => {
  const base: StoredRow = { id: 55, skuId: 1, location: 'self', qty: -3, kind: 'sale', lotId: 10, unitCost: null, occurredAt: AT, refType: 'order', refId: 'O1', reversesId: null, idemKey: 'sale:A#0', note: null };

  it('차감 전표는 같은 lot으로 부호만 뒤집는다', () => {
    expect(planReversal(base, { occurredAt: AT, idemKey: 'rev:sale:A#0' })).toMatchObject({
      skuId: 1, location: 'self', qty: 3, kind: 'reversal', lotId: 10, unitCost: null, reversesId: 55, idemKey: 'rev:sale:A#0', refType: 'order', refId: 'O1',
    });
  });

  it('lot 생성 전표를 되돌리면 자기 id를 lot으로 가리킨다', () => {
    const lot: StoredRow = { ...base, id: 10, qty: 10, kind: 'receipt', lotId: null, unitCost: 1000 };
    expect(planReversal(lot, { occurredAt: AT, idemKey: 'rev:r' })).toMatchObject({ qty: -10, lotId: 10, unitCost: null, reversesId: 10 });
  });

  it('역전표는 되돌리지 않는다', () => {
    expect(() => planReversal({ ...base, kind: 'reversal', reversesId: 1 }, { occurredAt: AT, idemKey: 'x' })).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/erp/ledger/fifo.ts`:
```ts
// src/lib/erp/ledger/fifo.ts
// 재고 원장 위치와 FIFO 배분. DB 없는 순수 함수.

/** self = 자체보관 · rg_inbound = RG로 보냈으나 판매 가능 수량에 아직 안 잡힘 · rg = RG 판매 가능 */
export type Location = 'self' | 'rg_inbound' | 'rg';

export interface LotBalance {
  lotId: number;
  qty: number;
  unitCost: number;
  /** lot을 만든 전표의 발생 시각(epoch ms). FIFO 순서의 기준 */
  lotAt: number;
}

export interface Take {
  lotId: number;
  qty: number;
  unitCost: number;
}

export class InsufficientStockError extends Error {
  constructor(public readonly need: number, public readonly have: number) {
    super(`재고 부족 — 필요 ${need}, 가용 ${have}`);
    this.name = 'InsufficientStockError';
  }
}

export function assertQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError(`수량은 양의 정수여야 한다: ${qty}`);
}

/** 오래된 lot부터(같은 시각이면 lot 번호 순) qty만큼 떼어낸다. 모자라면 아무것도 떼지 않고 던진다. */
export function allocateFifo(lots: LotBalance[], qty: number): Take[] {
  assertQty(qty);
  const open = lots
    .filter((l) => l.qty > 0)
    .sort((a, b) => a.lotAt - b.lotAt || a.lotId - b.lotId);
  const have = open.reduce((s, l) => s + l.qty, 0);
  if (have < qty) throw new InsufficientStockError(qty, have);
  const takes: Take[] = [];
  let left = qty;
  for (const l of open) {
    if (left === 0) break;
    const q = Math.min(left, l.qty);
    takes.push({ lotId: l.lotId, qty: q, unitCost: l.unitCost });
    left -= q;
  }
  return takes;
}
```

`src/lib/erp/ledger/plan.ts`:
```ts
// src/lib/erp/ledger/plan.ts
// 전표 계획. 무엇을 기록할지만 정하고 DB는 모른다(store.ts가 기록한다).
import { allocateFifo, assertQty, type Location, type LotBalance } from './fifo';

export type LedgerKind = 'opening' | 'receipt' | 'transfer' | 'sale' | 'return' | 'adjust' | 'reversal';

export interface LedgerRow {
  skuId: number;
  location: Location;
  qty: number;
  kind: LedgerKind;
  /** null = 이 전표가 lot을 만든다 */
  lotId: number | null;
  /** lot을 만드는 전표에만 있다 */
  unitCost: number | null;
  occurredAt: string;
  refType: string | null;
  refId: string | null;
  reversesId: number | null;
  idemKey: string;
  note: string | null;
}

export interface StoredRow extends LedgerRow {
  id: number;
}

export interface RefInput {
  refType?: string;
  refId?: string;
  note?: string;
}

export interface LotCreateInput extends RefInput {
  skuId: number;
  location: Location;
  qty: number;
  unitCost: number;
  kind: 'opening' | 'receipt' | 'adjust';
  occurredAt: string;
  idemKey: string;
}

export interface ConsumeInput extends RefInput {
  skuId: number;
  location: Location;
  qty: number;
  kind: 'sale' | 'adjust';
  occurredAt: string;
  idemKey: string;
}

export interface TransferInput extends RefInput {
  skuId: number;
  from: Location;
  to: Location;
  qty: number;
  occurredAt: string;
  idemKey: string;
}

const refOf = (p: RefInput) => ({ refType: p.refType ?? null, refId: p.refId ?? null, note: p.note ?? null });

export function planLotCreate(p: LotCreateInput): LedgerRow[] {
  assertQty(p.qty);
  if (!Number.isInteger(p.unitCost) || p.unitCost < 0) throw new RangeError(`단가는 0 이상의 정수여야 한다: ${p.unitCost}`);
  return [{
    skuId: p.skuId, location: p.location, qty: p.qty, kind: p.kind, lotId: null, unitCost: p.unitCost,
    occurredAt: p.occurredAt, ...refOf(p), reversesId: null, idemKey: p.idemKey,
  }];
}

/** FIFO로 lot을 골라 lot마다 음수 전표 하나. 멱등키는 `${idemKey}#${순번}` */
export function planConsume(p: ConsumeInput, lots: LotBalance[]): LedgerRow[] {
  return allocateFifo(lots, p.qty).map((t, i) => ({
    skuId: p.skuId, location: p.location, qty: -t.qty, kind: p.kind, lotId: t.lotId, unitCost: null,
    occurredAt: p.occurredAt, ...refOf(p), reversesId: null, idemKey: `${p.idemKey}#${i}`,
  }));
}

/** 출발지 lot을 FIFO로 골라 lot마다 (출발지 −, 도착지 +) 한 쌍. lot 번호와 단가는 그대로 따라간다. */
export function planTransfer(p: TransferInput, fromLots: LotBalance[]): LedgerRow[] {
  if (p.from === p.to) throw new RangeError(`출발지와 도착지가 같다: ${p.from}`);
  return allocateFifo(fromLots, p.qty).flatMap((t, i) => {
    const common = { skuId: p.skuId, kind: 'transfer' as const, lotId: t.lotId, unitCost: null, occurredAt: p.occurredAt, ...refOf(p), reversesId: null };
    return [
      { ...common, location: p.from, qty: -t.qty, idemKey: `${p.idemKey}#${i}:out` },
      { ...common, location: p.to, qty: t.qty, idemKey: `${p.idemKey}#${i}:in` },
    ];
  });
}

/** 전표 하나를 상쇄한다. lot을 만든 전표를 되돌리면 그 전표 자신을 lot으로 가리킨다. */
export function planReversal(orig: StoredRow, p: { occurredAt: string; idemKey: string; note?: string }): LedgerRow {
  if (orig.kind === 'reversal') throw new RangeError('역전표는 되돌리지 않는다 — 원 전표를 다시 기록한다');
  return {
    skuId: orig.skuId, location: orig.location, qty: -orig.qty, kind: 'reversal', lotId: orig.lotId ?? orig.id, unitCost: null,
    occurredAt: p.occurredAt, refType: orig.refType, refId: orig.refId, reversesId: orig.id, idemKey: p.idemKey, note: p.note ?? null,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/ledger/fifo.ts src/lib/erp/ledger/plan.ts src/__tests__/lib/erp/ledger/
git commit -m "feat(erp): 원장 FIFO 배분과 전표 계획(lot 생성·차감·이동·역전표)"
```

---

### Task 6: 전표 기록(store)과 실제 DB 자가시험

**Files:**
- Create: `src/lib/erp/ledger/store.ts`, `scripts/erp/ledger-selftest.ts`
- Test: `src/__tests__/lib/erp/ledger/store.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { postConsume, postLotCreate, postTransfer, reverse, type Db } from '@/lib/erp/ledger/store';

const AT = '2026-09-26T01:00:00.000Z';

/** SQL 앞부분으로 분기하는 가짜 DB. 기록된 질의를 calls에 남긴다. */
function fakeDb(opts: { posted?: boolean; lots?: { lot_id: number; qty: number; unit_cost: number; lot_at: number }[]; stored?: Record<string, unknown>[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: opts.posted ? [{}] : [], rowCount: opts.posted ? 1 : 0 };
      if (sql.startsWith('select coalesce(l.lot_id')) return { rows: opts.lots ?? [], rowCount: (opts.lots ?? []).length };
      if (sql.startsWith('select id, sku_id')) return { rows: opts.stored ?? [], rowCount: (opts.stored ?? []).length };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('store', () => {
  let f: ReturnType<typeof fakeDb>;
  beforeEach(() => { f = fakeDb(); });

  it('잠금 → 멱등 확인 → 기록 순서', async () => {
    const r = await postLotCreate(f.db, { skuId: 7, location: 'self', qty: 3, unitCost: 900, kind: 'opening', occurredAt: AT, idemKey: 'opening:7:self' });
    expect(r).toEqual({ posted: true, ids: [100] });
    expect(f.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(f.calls[0].params).toEqual([7101, 7]);
    expect(f.calls[1].sql).toMatch(/^select 1 from erp\.stock_ledger/);
    expect(f.calls[1].params).toEqual(['opening:7:self', 'opening:7:self#%']);
    expect(f.calls[2].params).toEqual([7, 'self', 3, 'opening', null, 900, AT, null, null, null, 'opening:7:self', null]);
  });

  it('이미 기록된 멱등키면 쓰지 않는다', async () => {
    f = fakeDb({ posted: true });
    const r = await postLotCreate(f.db, { skuId: 7, location: 'self', qty: 3, unitCost: 900, kind: 'opening', occurredAt: AT, idemKey: 'k' });
    expect(r).toEqual({ posted: false, ids: [] });
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });

  it('멱등키의 LIKE 특수문자를 이스케이프한다', async () => {
    await postLotCreate(f.db, { skuId: 1, location: 'rg_inbound', qty: 1, unitCost: 0, kind: 'opening', occurredAt: AT, idemKey: 'opening:1:rg_inbound' });
    expect(f.calls[1].params[1]).toBe('opening:1:rg\\_inbound#%');
  });

  it('차감은 해당 위치의 lot을 FIFO로 소진한다', async () => {
    f = fakeDb({ lots: [{ lot_id: 20, qty: 5, unit_cost: 1200, lot_at: 2000 }, { lot_id: 10, qty: 2, unit_cost: 1000, lot_at: 1000 }] });
    await postConsume(f.db, { skuId: 7, location: 'rg', qty: 3, kind: 'sale', occurredAt: AT, idemKey: 'sale:X' });
    const lotQuery = f.calls.find((c) => c.sql.startsWith('select coalesce(l.lot_id'))!;
    expect(lotQuery.params).toEqual([7, 'rg']);
    const inserts = f.calls.filter((c) => c.sql.startsWith('insert'));
    expect(inserts.map((c) => [c.params[4], c.params[2], c.params[10]])).toEqual([[10, -2, 'sale:X#0'], [20, -1, 'sale:X#1']]);
  });

  it('이동은 출발지 lot을 읽는다', async () => {
    f = fakeDb({ lots: [{ lot_id: 10, qty: 5, unit_cost: 1000, lot_at: 1000 }] });
    await postTransfer(f.db, { skuId: 7, from: 'self', to: 'rg_inbound', qty: 2, occurredAt: AT, idemKey: 'tr:1' });
    expect(f.calls.find((c) => c.sql.startsWith('select coalesce(l.lot_id'))!.params).toEqual([7, 'self']);
    expect(f.calls.filter((c) => c.sql.startsWith('insert')).map((c) => [c.params[1], c.params[2]])).toEqual([['self', -2], ['rg_inbound', 2]]);
  });

  it('reverse는 원 멱등키의 전표 전부를 rev: 키로 상쇄한다', async () => {
    f = fakeDb({ stored: [
      { id: 55, sku_id: 7, location: 'self', qty: -2, kind: 'sale', lot_id: 10, unit_cost: null, occurred_at: AT, ref_type: 'order', ref_id: 'O1', reverses_id: null, idem_key: 'sale:X#0', note: null },
      { id: 56, sku_id: 7, location: 'self', qty: -1, kind: 'sale', lot_id: 20, unit_cost: null, occurred_at: AT, ref_type: 'order', ref_id: 'O1', reverses_id: null, idem_key: 'sale:X#1', note: null },
    ] });
    const r = await reverse(f.db, 'sale:X', { occurredAt: AT, note: '취소' });
    expect(r.posted).toBe(true);
    const inserts = f.calls.filter((c) => c.sql.startsWith('insert'));
    expect(inserts.map((c) => [c.params[2], c.params[3], c.params[4], c.params[9], c.params[10]])).toEqual([
      [2, 'reversal', 10, 55, 'rev:sale:X#0'],
      [1, 'reversal', 20, 56, 'rev:sale:X#1'],
    ]);
  });

  it('reverse할 전표가 없으면 던진다', async () => {
    await expect(reverse(f.db, 'nope', { occurredAt: AT })).rejects.toThrow('되돌릴 전표가 없다');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/store.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/erp/ledger/store.ts`:
```ts
// src/lib/erp/ledger/store.ts
// 원장 기록. 호출자가 트랜잭션(BEGIN … COMMIT)을 연다 — 음수 재고 검사는 COMMIT 시점에 돈다.
// 전표마다 SKU 단위 advisory lock을 잡아 겹친 실행이 같은 lot을 두 번 소진하지 못하게 한다.
import type { Location, LotBalance } from './fifo';
import {
  planConsume, planLotCreate, planReversal, planTransfer,
  type ConsumeInput, type LedgerRow, type LotCreateInput, type StoredRow, type TransferInput,
} from './plan';

export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface PostResult {
  /** false = 같은 멱등키가 이미 있어 아무것도 쓰지 않았다 */
  posted: boolean;
  ids: number[];
}

/** erp.stock_ledger 잠금 네임스페이스(pg_advisory_xact_lock(int, int)의 첫 인자) */
const LOCK_NS = 7101;

const likePrefix = (k: string) => `${k.replace(/[\\%_]/g, '\\$&')}#%`;

export async function lockSku(db: Db, skuId: number): Promise<void> {
  await db.query('select pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NS, skuId]);
}

/** 멱등키 자체 또는 `${키}#…`로 시작하는 전표가 있으면 true */
export async function alreadyPosted(db: Db, idemKey: string): Promise<boolean> {
  const { rows } = await db.query(
    'select 1 from erp.stock_ledger where idem_key = $1 or idem_key like $2 limit 1',
    [idemKey, likePrefix(idemKey)],
  );
  return rows.length > 0;
}

export async function loadLots(db: Db, skuId: number, location: Location): Promise<LotBalance[]> {
  const { rows } = await db.query(
    `select coalesce(l.lot_id, l.id) as lot_id, sum(l.qty)::int as qty, h.unit_cost, extract(epoch from h.occurred_at) * 1000 as lot_at
       from erp.stock_ledger l join erp.stock_ledger h on h.id = coalesce(l.lot_id, l.id)
      where l.sku_id = $1 and l.location = $2
      group by 1, h.unit_cost, h.occurred_at
     having sum(l.qty) <> 0`,
    [skuId, location],
  );
  return rows.map((r) => ({ lotId: Number(r.lot_id), qty: Number(r.qty), unitCost: Number(r.unit_cost), lotAt: Number(r.lot_at) }));
}

export async function insertRows(db: Db, rows: LedgerRow[]): Promise<number[]> {
  const ids: number[] = [];
  for (const r of rows) {
    const { rows: out } = await db.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, unit_cost, occurred_at, ref_type, ref_id, reverses_id, idem_key, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [r.skuId, r.location, r.qty, r.kind, r.lotId, r.unitCost, r.occurredAt, r.refType, r.refId, r.reversesId, r.idemKey, r.note],
    );
    ids.push(Number(out[0].id));
  }
  return ids;
}

async function guarded(db: Db, skuId: number, idemKey: string, build: () => Promise<LedgerRow[]>): Promise<PostResult> {
  await lockSku(db, skuId);
  if (await alreadyPosted(db, idemKey)) return { posted: false, ids: [] };
  return { posted: true, ids: await insertRows(db, await build()) };
}

export function postLotCreate(db: Db, p: LotCreateInput): Promise<PostResult> {
  return guarded(db, p.skuId, p.idemKey, async () => planLotCreate(p));
}

export function postConsume(db: Db, p: ConsumeInput): Promise<PostResult> {
  return guarded(db, p.skuId, p.idemKey, async () => planConsume(p, await loadLots(db, p.skuId, p.location)));
}

export function postTransfer(db: Db, p: TransferInput): Promise<PostResult> {
  return guarded(db, p.skuId, p.idemKey, async () => planTransfer(p, await loadLots(db, p.skuId, p.from)));
}

/** 멱등키 origIdemKey로 기록된 전표 전부(순번 붙은 것 포함)를 `rev:` 키로 상쇄한다. */
export async function reverse(db: Db, origIdemKey: string, p: { occurredAt: string; note?: string }): Promise<PostResult> {
  const { rows } = await db.query(
    `select id, sku_id, location, qty, kind, lot_id, unit_cost, occurred_at, ref_type, ref_id, reverses_id, idem_key, note
       from erp.stock_ledger where idem_key = $1 or idem_key like $2 order by id`,
    [origIdemKey, likePrefix(origIdemKey)],
  );
  if (rows.length === 0) throw new Error(`되돌릴 전표가 없다: ${origIdemKey}`);
  const stored: StoredRow[] = rows.map((r) => ({
    id: Number(r.id), skuId: Number(r.sku_id), location: r.location, qty: Number(r.qty), kind: r.kind,
    lotId: r.lot_id === null ? null : Number(r.lot_id), unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
    occurredAt: String(r.occurred_at), refType: r.ref_type, refId: r.ref_id,
    reversesId: r.reverses_id === null ? null : Number(r.reverses_id), idemKey: r.idem_key, note: r.note,
  }));
  return guarded(db, stored[0].skuId, `rev:${origIdemKey}`, async () =>
    stored.map((s) => planReversal(s, { occurredAt: p.occurredAt, idemKey: `rev:${s.idemKey}`, note: p.note })),
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류

- [ ] **Step 5: 실제 DB 자가시험 스크립트 작성**

`scripts/erp/ledger-selftest.ts` — 운영 DB에서 **롤백 트랜잭션** 안에서만 돈다. 남는 것이 없다.
```ts
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
```

- [ ] **Step 6: 자가시험 실행**

Run: `npx --no-install tsx scripts/erp/ledger-selftest.ts`
Expected: 9행 전부 ✅, exit 0. ❌가 있으면 마이그레이션 113이나 store를 고친다(마이그레이션은 `create or replace`/`drop trigger if exists`라 다시 적용 가능. 테이블 정의를 바꿔야 하면 `114_…`로 alter한다).

그리고 흔적이 없는지 확인한다:
```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
console.log((await c.query(\"select (select count(*) from erp.stock_ledger)::int ledger, (select count(*) from erp.skus where key like 'selftest%')::int skus\")).rows[0]);await c.end()})()"
```
Expected: `{ ledger: 0, skus: 0 }`

- [ ] **Step 7: 커밋**

```bash
git add src/lib/erp/ledger/store.ts src/__tests__/lib/erp/ledger/store.test.ts scripts/erp/ledger-selftest.ts
git commit -m "feat(erp): 원장 기록 — SKU 잠금·멱등·FIFO 차감·이동·역전표, 운영 DB 자가시험"
```

---

### Task 7: 재고가 있는 SKU의 보관 거부 (P5)

**Files:**
- Modify: `scripts/erp/sku-apply.ts` (`apply()` — SKU 보관 update 바로 뒤)

> 🔵 **실행 중 변경(2026-09-26):** 아래 코드는 「초안에서 사라진 키」만 본다. 병합 overrides로 초안 안에서 `archived`가 되는 SKU를 놓치므로, **보관을 반영한 뒤 같은 트랜잭션에서 `status='archived' and origin='draft'`인 SKU의 재고를 검사**하는 것으로 바꿔 구현했다(두 경로를 한 번에 막는다).

- [ ] **Step 1: 보관 전에 재고 확인을 넣는다**

```ts
    // P5: SKU 키는 동결이다. 초안에서 키가 사라져 보관될 SKU에 원장 재고가 있으면 재고가 보이지 않게 된다 — 적재를 멈춘다.
    const stocked = await c.query(
      `select s.key, h.location, h.qty
         from erp.skus s join erp.stock_on_hand h on h.sku_id = s.id
        where s.status <> 'archived' and s.origin = 'draft' and not (s.key = any($1::text[])) and h.qty <> 0`,
      [d.skus.map((s) => s.key)],
    );
    if (stocked.rows.length > 0) {
      throw new Error(`재고가 있는 SKU를 보관하려 한다 — 키가 바뀐 것이다. 초안(overrides)을 고친다:\n  ${stocked.rows.map((r) => `${r.key} ${r.location} ${r.qty}`).join('\n  ')}`);
    }
```

- [ ] **Step 2: 확인**

Run: `npx tsc --noEmit && npx --no-install tsx scripts/erp/sku-apply.ts`
Expected: 0 오류, 점검 모드 결과가 Task 3 직후와 같다(전부 동일).

- [ ] **Step 3: 커밋**

```bash
git add scripts/erp/sku-apply.ts
git commit -m "feat(erp): 재고가 있는 SKU의 보관을 거부(키 동결 P5)"
```

---

### Task 8: 기초재고 계산 (순수 함수)

**Files:**
- Create: `src/lib/erp/ledger/opening.ts`
- Test: `src/__tests__/lib/erp/ledger/opening.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/opening.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  rgQtyBySku, groupSkus, buildCountSheet, openingUnitCost, toCsv, parseCountCsv, reconcileRg,
  type OpeningSku, type LegacyFacts, type CountRow,
} from '@/lib/erp/ledger/opening';

const skus: OpeningSku[] = [
  { id: 1, key: 'cp:100:', name: '다슈', optionLabel: '', legacyProductCostIds: ['pc-a'] },
  { id: 2, key: 'cp:200:블랙', name: '왜건', optionLabel: '블랙', legacyProductCostIds: ['pc-b'] },
  { id: 3, key: 'cp:200:레드', name: '왜건', optionLabel: '레드', legacyProductCostIds: ['pc-b'] },
  { id: 4, key: 'cp:300:', name: '새 상품, "특가"', optionLabel: '', legacyProductCostIds: [] },
];

describe('rgQtyBySku', () => {
  const links = [
    { vid: '21', skuId: 1, multiplier: 2 },
    { vid: '31', skuId: 2, multiplier: 1 },
    { vid: '41', skuId: 2, multiplier: 1 },
    { vid: '41', skuId: 3, multiplier: 1 },
  ];
  it('판매 단위 × 배수로 SKU 수량을 더하고, 못 가르는 것은 이슈로', () => {
    const r = rgQtyBySku(links, [{ vid: '21', qty: 3 }, { vid: '31', qty: 4 }, { vid: '41', qty: 1 }, { vid: '99', qty: 2 }, { vid: '98', qty: 0 }], new Set());
    expect([...r.bySku]).toEqual([[1, 6], [2, 4]]);
    expect(r.issues.map((i) => [i.kind, i.ref])).toEqual([['rg_listing_multi_sku', '41'], ['rg_vid_unmapped', '99']]);
  });
  it('무시 목록의 vid는 건너뛴다', () => {
    expect(rgQtyBySku(links, [{ vid: '99', qty: 2 }], new Set(['99'])).issues).toEqual([]);
  });
});

describe('groupSkus', () => {
  it('옛 원가 행을 공유하는 SKU끼리 묶고, 옛 행이 없는 SKU는 혼자다', () => {
    expect(groupSkus(skus).map((g) => [g.skuIds, g.productCostIds])).toEqual([
      [[1], ['pc-a']],
      [[2, 3], ['pc-b']],
      [[4], []],
    ]);
  });
  it('SKU가 옛 행 두 개를 가지면 두 행의 SKU가 한 그룹이 된다', () => {
    const g = groupSkus([
      { id: 1, key: 'a', name: 'a', optionLabel: '', legacyProductCostIds: ['p1'] },
      { id: 2, key: 'b', name: 'b', optionLabel: '', legacyProductCostIds: ['p1', 'p2'] },
      { id: 3, key: 'c', name: 'c', optionLabel: '', legacyProductCostIds: ['p2'] },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].skuIds).toEqual([1, 2, 3]);
  });
});

describe('openingUnitCost', () => {
  const entries = [
    { receivedAt: '2026-08-01', quantity: 10, unitCost: 1000 },
    { receivedAt: '2026-09-01', quantity: 4, unitCost: 1300 },
  ];
  it('최근 입고부터 거슬러 가중평균(반올림)', () => {
    expect(openingUnitCost(entries, 6)).toEqual({ unitCost: Math.round((4 * 1300 + 2 * 1000) / 6), partial: false });
  });
  it('입고 합계보다 많으면 모자란 만큼 최근 단가로 채우고 partial', () => {
    expect(openingUnitCost(entries, 16)).toEqual({ unitCost: Math.round((4 * 1300 + 10 * 1000 + 2 * 1300) / 16), partial: true });
  });
  it('입고 기록이 없으면 null', () => {
    expect(openingUnitCost([], 3)).toEqual({ unitCost: null, partial: false });
  });
  it('보유 0이면 null(lot을 만들지 않는다)', () => {
    expect(openingUnitCost(entries, 0)).toEqual({ unitCost: null, partial: false });
  });
});

describe('buildCountSheet', () => {
  const legacy: LegacyFacts[] = [
    { productCostId: 'pc-a', entries: [{ receivedAt: '2026-09-01', quantity: 20, unitCost: 5000 }], soldQty: 8, voidedQty: 0 },
    { productCostId: 'pc-b', entries: [{ receivedAt: '2026-09-01', quantity: 10, unitCost: 30000 }], soldQty: 3, voidedQty: 2 },
  ];
  const rg = new Map([[1, 6], [2, 1]]);
  const { rows, issues } = buildCountSheet(skus, groupSkus(skus), rg, legacy);
  const byId = new Map(rows.map((r) => [r.skuId, r]));

  it('SKU 하나짜리 그룹은 추정(입고 − 판매 − RG)을 실사값으로 미리 채운다', () => {
    expect(byId.get(1)).toMatchObject({ rgActual: 6, selfEstimate: 6, selfCount: 6, rgInbound: 0, unitCost: 5000 });
  });
  it('여러 SKU 그룹은 실사값을 비우고 그룹 추정을 보여준다', () => {
    expect(byId.get(2)).toMatchObject({ rgActual: 1, selfEstimate: 6, selfCount: null });
    expect(byId.get(3)).toMatchObject({ rgActual: 0, selfEstimate: 6, selfCount: null });
    expect(byId.get(2)!.note).toContain('옵션별로 나눠');
    expect(byId.get(2)!.note).toContain('무효 판매 2');
    expect(issues).toContainEqual(expect.objectContaining({ kind: 'group_spans_skus' }));
  });
  it('입고 기록이 없는 SKU는 추정 없음 · 실사 0 · 단가 빈칸', () => {
    expect(byId.get(4)).toMatchObject({ selfEstimate: null, selfCount: 0, unitCost: null });
  });
  it('추정이 음수면 실사 0으로 채우고 이슈', () => {
    const r = buildCountSheet(skus.slice(0, 1), groupSkus(skus.slice(0, 1)), new Map([[1, 30]]), legacy);
    expect(r.rows[0]).toMatchObject({ selfEstimate: -18, selfCount: 0 });
    expect(r.issues).toContainEqual(expect.objectContaining({ kind: 'self_estimate_negative', ref: 'cp:100:' }));
  });
  it('확인이 필요한 행(재고 있음·빈칸)이 앞에 온다', () => {
    expect(rows.map((r) => r.skuId)).toEqual([1, 2, 3, 4]);
  });
});

describe('CSV', () => {
  const rows: CountRow[] = [
    { skuId: 4, skuKey: 'cp:300:', name: '새 상품, "특가"', option: '', group: 'g3', rgActual: 0, selfEstimate: null, selfCount: 0, rgInbound: 0, unitCost: null, note: '' },
    { skuId: 2, skuKey: 'cp:200:블랙', name: '왜건', option: '블랙', group: 'g2', rgActual: 1, selfEstimate: 6, selfCount: null, rgInbound: 0, unitCost: 30000, note: 'a, b' },
  ];
  it('쉼표·따옴표가 든 값도 왕복한다(BOM 포함)', () => {
    const text = toCsv(rows);
    expect(text.startsWith('﻿')).toBe(true);
    expect(parseCountCsv(text)).toEqual(rows);
  });
  it('실사값을 사람이 고친 파일을 읽는다', () => {
    const edited = toCsv(rows).replace('cp:200:블랙,왜건,블랙,g2,1,6,,0', 'cp:200:블랙,왜건,블랙,g2,1,6,4,0');
    expect(parseCountCsv(edited)[1].selfCount).toBe(4);
  });
  it('정수가 아닌 값은 던진다', () => {
    const bad = toCsv(rows).replace('cp:200:블랙,왜건,블랙,g2,1,6,,0', 'cp:200:블랙,왜건,블랙,g2,1,6,두개,0');
    expect(() => parseCountCsv(bad)).toThrow(/self_count/);
  });
});

describe('reconcileRg', () => {
  it('원장과 실재고가 다른 SKU만 돌려준다', () => {
    expect(reconcileRg(new Map([[1, 6], [2, 1]]), new Map([[1, 6], [2, 3], [5, 2]]))).toEqual([
      { skuId: 2, ledger: 1, actual: 3, diff: 2 },
      { skuId: 5, ledger: 0, actual: 2, diff: 2 },
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/opening.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/erp/ledger/opening.ts`:
```ts
// src/lib/erp/ledger/opening.ts
// 전환일 기초재고. RG = 쿠팡 RG 실재고 API, 자체보관 = 실사(기존 계산값을 미리 채운 실사표를 사람이 고친다).
// lot 단가 = 옛 입고(cost_entries)를 최근부터 거슬러 보유 수량만큼의 가중평균. 배송비·RG 물류비는 넣지 않는다(기존 FIFO stock_value와 같은 정의).

export interface OpeningSku {
  id: number;
  key: string;
  name: string;
  optionLabel: string;
  legacyProductCostIds: string[];
}

/** RG 리스팅(vendorItemId) ↔ SKU 연결 한 줄. multiplier = 리스팅 1개가 뜻하는 SKU 기준 단위 수 */
export interface RgLink {
  vid: string;
  skuId: number;
  multiplier: number;
}

export interface RgStock {
  vid: string;
  qty: number;
}

export interface LegacyFacts {
  productCostId: string;
  entries: { receivedAt: string; quantity: number; unitCost: number }[];
  /** 무효가 아닌 판매 수량 합계(모든 채널, 배수 적용된 SKU 기준 단위) */
  soldQty: number;
  /** 무효 처리된 판매 수량 합계 — 추정이 부풀었을 수 있다는 신호 */
  voidedQty: number;
}

export type OpeningIssueKind =
  | 'rg_vid_unmapped'
  | 'rg_listing_multi_sku'
  | 'self_estimate_negative'
  | 'group_spans_skus'
  | 'cost_unknown'
  | 'cost_partial';

export interface OpeningIssue {
  kind: OpeningIssueKind;
  ref: string;
  detail: string;
}

export interface SkuGroup {
  id: string;
  skuIds: number[];
  productCostIds: string[];
}

export interface CountRow {
  skuId: number;
  skuKey: string;
  name: string;
  option: string;
  group: string;
  rgActual: number;
  /** 그룹 단위 추정(입고 − 판매 − 그룹 RG). 입고 기록이 없으면 null */
  selfEstimate: number | null;
  /** 사람이 확정하는 자체보관 실사. null = 아직 안 적음 */
  selfCount: number | null;
  /** RG로 보냈으나 아직 판매 가능 수량에 안 잡힌 수량(사람이 적는다) */
  rgInbound: number;
  unitCost: number | null;
  note: string;
}

export function rgQtyBySku(links: RgLink[], stock: RgStock[], ignore: Set<string>): { bySku: Map<number, number>; issues: OpeningIssue[] } {
  const byVid = new Map<string, RgLink[]>();
  for (const l of links) byVid.set(l.vid, [...(byVid.get(l.vid) ?? []), l]);
  const bySku = new Map<number, number>();
  const issues: OpeningIssue[] = [];
  for (const s of stock) {
    if (s.qty === 0 || ignore.has(s.vid)) continue;
    const ls = byVid.get(s.vid) ?? [];
    if (ls.length === 0) {
      issues.push({ kind: 'rg_vid_unmapped', ref: s.vid, detail: `RG 재고 ${s.qty}개인 vendorItemId가 어느 RG 리스팅에도 없다` });
      continue;
    }
    if (ls.length > 1) {
      issues.push({ kind: 'rg_listing_multi_sku', ref: s.vid, detail: `RG 재고 ${s.qty}개 — 리스팅이 SKU ${ls.map((l) => l.skuId).join(', ')}에 걸쳐 나눌 수 없다` });
      continue;
    }
    bySku.set(ls[0].skuId, (bySku.get(ls[0].skuId) ?? 0) + s.qty * ls[0].multiplier);
  }
  return { bySku, issues };
}

/** 옛 원가 행을 공유하는 SKU를 한 그룹으로 묶는다(합집합-찾기). 그룹 순서는 첫 SKU id 순. */
export function groupSkus(skus: OpeningSku[]): SkuGroup[] {
  const parent = new Map<number, number>(skus.map((s) => [s.id, s.id]));
  const find = (x: number): number => {
    while (parent.get(x)! !== x) x = parent.get(x)!;
    return x;
  };
  const firstSkuOfPc = new Map<string, number>();
  for (const s of skus) {
    for (const pc of s.legacyProductCostIds) {
      const other = firstSkuOfPc.get(pc);
      if (other === undefined) firstSkuOfPc.set(pc, s.id);
      else parent.set(find(s.id), find(other));
    }
  }
  const groups = new Map<number, SkuGroup>();
  for (const s of [...skus].sort((a, b) => a.id - b.id)) {
    const root = find(s.id);
    const g = groups.get(root) ?? { id: '', skuIds: [], productCostIds: [] };
    g.skuIds.push(s.id);
    g.productCostIds = [...new Set([...g.productCostIds, ...s.legacyProductCostIds])].sort();
    groups.set(root, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.skuIds[0] - b.skuIds[0])
    .map((g, i) => ({ ...g, id: `g${i + 1}` }));
}

export function openingUnitCost(entries: LegacyFacts['entries'], onHand: number): { unitCost: number | null; partial: boolean } {
  if (onHand <= 0 || entries.length === 0) return { unitCost: null, partial: false };
  const newestFirst = [...entries].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
  let left = onHand;
  let cost = 0;
  for (const e of newestFirst) {
    if (left === 0) break;
    const q = Math.min(left, e.quantity);
    cost += q * e.unitCost;
    left -= q;
  }
  const partial = left > 0;
  if (partial) cost += left * newestFirst[0].unitCost;
  return { unitCost: Math.round(cost / onHand), partial };
}

export function buildCountSheet(
  skus: OpeningSku[],
  groups: SkuGroup[],
  rgBySku: Map<number, number>,
  legacy: LegacyFacts[],
): { rows: CountRow[]; issues: OpeningIssue[] } {
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const facts = new Map(legacy.map((f) => [f.productCostId, f]));
  const rows: CountRow[] = [];
  const issues: OpeningIssue[] = [];
  for (const g of groups) {
    const fs = g.productCostIds.map((pc) => facts.get(pc)).filter((f): f is LegacyFacts => !!f);
    const entries = fs.flatMap((f) => f.entries);
    const rgTotal = g.skuIds.reduce((s, id) => s + (rgBySku.get(id) ?? 0), 0);
    const hasHistory = entries.length > 0;
    const estimate = hasHistory
      ? entries.reduce((s, e) => s + e.quantity, 0) - fs.reduce((s, f) => s + f.soldQty, 0) - rgTotal
      : null;
    const voided = fs.reduce((s, f) => s + f.voidedQty, 0);
    const single = g.skuIds.length === 1;
    const prefill = !hasHistory ? 0 : single ? Math.max(estimate!, 0) : null;
    const cost = openingUnitCost(entries, (prefill ?? Math.max(estimate ?? 0, 0)) + rgTotal);

    const firstKey = skuById.get(g.skuIds[0])!.key;
    if (estimate !== null && estimate < 0) {
      issues.push({ kind: 'self_estimate_negative', ref: firstKey, detail: `자체보관 추정 ${estimate} — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다` });
    }
    if (!single) issues.push({ kind: 'group_spans_skus', ref: g.id, detail: `SKU ${g.skuIds.length}개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다` });
    if (cost.partial) issues.push({ kind: 'cost_partial', ref: g.id, detail: '보유 수량이 옛 입고 합계보다 많아 모자란 만큼 최근 단가로 채웠다' });

    const notes: string[] = [];
    if (!hasHistory) notes.push('입고 기록 없음');
    if (!single) notes.push(`${g.skuIds.length}개 옵션 그룹 — 그룹 추정 ${estimate}을 옵션별로 나눠 적는다`);
    if (voided > 0) notes.push(`무효 판매 ${voided}개 — 추정이 부풀었을 수 있다`);

    for (const id of g.skuIds) {
      const s = skuById.get(id)!;
      const rgActual = rgBySku.get(id) ?? 0;
      if (cost.unitCost === null && rgActual + (prefill ?? 0) > 0) {
        issues.push({ kind: 'cost_unknown', ref: s.key, detail: '재고는 있는데 옛 입고 기록이 없어 단가를 모른다 — 실사표 unit_cost에 적는다' });
      }
      rows.push({
        skuId: id, skuKey: s.key, name: s.name, option: s.optionLabel, group: g.id,
        rgActual, selfEstimate: estimate, selfCount: prefill, rgInbound: 0, unitCost: cost.unitCost, note: notes.join(' · '),
      });
    }
  }
  const needsLook = (r: CountRow) => r.selfCount === null || r.selfCount > 0 || r.rgActual > 0;
  rows.sort((a, b) => Number(needsLook(b)) - Number(needsLook(a)) || a.skuId - b.skuId);
  return { rows, issues };
}

const COLUMNS = ['sku_id', 'sku_key', 'name', 'option', 'group', 'rg_actual', 'self_estimate', 'self_count', 'rg_inbound', 'unit_cost', 'note'] as const;

const cell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: CountRow[]): string {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([r.skuId, r.skuKey, r.name, r.option, r.group, r.rgActual, r.selfEstimate, r.selfCount, r.rgInbound, r.unitCost, r.note].map(cell).join(','));
  }
  return `﻿${lines.join('\n')}\n`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCountCsv(text: string): CountRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]);
  if (header.join(',') !== COLUMNS.join(',')) throw new Error(`실사표 머리글이 다르다: ${header.join(',')}`);
  const int = (v: string, col: string, line: number, nullable: boolean): number | null => {
    const t = v.trim();
    if (t === '') {
      if (nullable) return null;
      throw new Error(`${line}행 ${col}이 비어 있다`);
    }
    if (!/^-?\d+$/.test(t)) throw new Error(`${line}행 ${col} 값 '${t}'은 정수가 아니다`);
    return Number(t);
  };
  return lines.slice(1).map((l, i) => {
    const c = splitCsvLine(l);
    const n = i + 2;
    return {
      skuId: int(c[0], 'sku_id', n, false)!,
      skuKey: c[1], name: c[2], option: c[3], group: c[4],
      rgActual: int(c[5], 'rg_actual', n, false)!,
      selfEstimate: int(c[6], 'self_estimate', n, true),
      selfCount: int(c[7], 'self_count', n, true),
      rgInbound: int(c[8], 'rg_inbound', n, false)!,
      unitCost: int(c[9], 'unit_cost', n, true),
      note: c[10] ?? '',
    };
  });
}

/** 원장 RG와 실재고가 다른 SKU만. 순서는 SKU id 순. */
export function reconcileRg(ledger: Map<number, number>, actual: Map<number, number>): { skuId: number; ledger: number; actual: number; diff: number }[] {
  const ids = [...new Set([...ledger.keys(), ...actual.keys()])].sort((a, b) => a - b);
  return ids
    .map((skuId) => ({ skuId, ledger: ledger.get(skuId) ?? 0, actual: actual.get(skuId) ?? 0 }))
    .filter((r) => r.ledger !== r.actual)
    .map((r) => ({ ...r, diff: r.actual - r.ledger }));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/ledger/opening.ts src/__tests__/lib/erp/ledger/opening.test.ts
git commit -m "feat(erp): 기초재고 계산 — RG 환산·그룹·자체보관 추정·lot 단가·실사표 CSV·RG 대조"
```

---

### Task 9: 실사표 생성 (읽기 전용)

**Files:**
- Create: `scripts/erp/opening-collect.ts`
- Output: `docs/erp/opening-count-<KST날짜>.csv`, `docs/erp/opening-review-<KST날짜>.md`

- [ ] **Step 1: 스크립트 작성**

```ts
// scripts/erp/opening-collect.ts
// 사용법: npx --no-install tsx scripts/erp/opening-collect.ts
// DB(읽기 전용)와 쿠팡 RG 재고 API(GET)로 기초재고 실사표(CSV)와 점검 보고서(MD)를 docs/erp/에 쓴다.
// 구매자 정보는 읽지 않는다 — sale_records에서는 product_cost별 수량 합계만.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import {
  buildCountSheet, groupSkus, rgQtyBySku, toCsv,
  type LegacyFacts, type OpeningSku, type RgLink, type RgStock,
} from '@/lib/erp/ledger/opening';

loadEnvLocal();
const DATE = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', '..', 'docs', 'erp');
const OVERRIDES = path.join(OUT, 'opening-overrides.json');

export interface OpeningOverrides {
  /** 원장에 넣지 않을 RG vendorItemId → 사유(예: 승인 해제된 옵션의 잔여 재고) */
  ignoreRgVids: Record<string, string>;
}

export function loadOverrides(): OpeningOverrides {
  if (!fs.existsSync(OVERRIDES)) return { ignoreRgVids: {} };
  return JSON.parse(fs.readFileSync(OVERRIDES, 'utf-8')) as OpeningOverrides;
}

export async function fetchRgStock(): Promise<RgStock[]> {
  const client = getCoupangClient();
  const out: RgStock[] = [];
  let token: string | null = null;
  do {
    const page = await client.getRocketGrowthInventories(token ? { nextToken: token } : undefined);
    for (const it of page.items) out.push({ vid: String(it.vendorItemId), qty: it.totalOrderableQuantity });
    token = page.nextToken;
  } while (token);
  return out;
}

export async function readDb(c: pg.Client): Promise<{ skus: OpeningSku[]; links: RgLink[]; legacy: LegacyFacts[]; baseUnitMissing: { key: string; name: string; maxMultiplier: number }[] }> {
  const skus = (await c.query(
    `select id, key, name, option_label, legacy_product_cost_ids::text[] as legacy from erp.skus where status = 'active' order by id`,
  )).rows.map((r) => ({ id: Number(r.id), key: r.key, name: r.name, optionLabel: r.option_label, legacyProductCostIds: r.legacy ?? [] }));
  const links = (await c.query(
    `select l.external_product_id as vid, x.sku_id, x.multiplier
       from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id
      where l.channel = 'coupang_rg' and l.active`,
  )).rows.map((r) => ({ vid: String(r.vid), skuId: Number(r.sku_id), multiplier: Number(r.multiplier) }));
  const entries = (await c.query(
    `select product_cost_id, received_at::text as received_at, quantity::int as quantity, unit_cost from cost_entries`,
  )).rows;
  const sales = (await c.query(
    `select product_cost_id,
            coalesce(sum(quantity) filter (where voided_at is null), 0)::int as sold,
            coalesce(sum(quantity) filter (where voided_at is not null), 0)::int as voided
       from sale_records group by product_cost_id`,
  )).rows;
  const byPc = new Map<string, LegacyFacts>();
  const get = (pc: string) => byPc.get(pc) ?? byPc.set(pc, { productCostId: pc, entries: [], soldQty: 0, voidedQty: 0 }).get(pc)!;
  for (const e of entries) get(e.product_cost_id).entries.push({ receivedAt: e.received_at, quantity: Number(e.quantity), unitCost: Number(e.unit_cost) });
  for (const s of sales) Object.assign(get(s.product_cost_id), { soldQty: Number(s.sold), voidedQty: Number(s.voided) });
  const baseUnitMissing = (await c.query(
    `select s.key, s.name, max(x.multiplier)::int as m
       from erp.skus s join erp.listing_skus x on x.sku_id = s.id
      where s.status = 'active' and s.base_unit_label is null
      group by s.key, s.name having max(x.multiplier) > 1 order by s.key`,
  )).rows.map((r) => ({ key: r.key, name: r.name, maxMultiplier: Number(r.m) }));
  return { skus, links, legacy: [...byPc.values()], baseUnitMissing };
}

async function main(): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let db: Awaited<ReturnType<typeof readDb>>;
  try {
    await c.query('BEGIN READ ONLY');
    db = await readDb(c);
    await c.query('COMMIT');
  } finally {
    await c.end();
  }
  const stock = await fetchRgStock();
  const ov = loadOverrides();
  const rg = rgQtyBySku(db.links, stock, new Set(Object.keys(ov.ignoreRgVids)));
  const sheet = buildCountSheet(db.skus, groupSkus(db.skus), rg.bySku, db.legacy);
  const issues = [...rg.issues, ...sheet.issues];

  fs.writeFileSync(path.join(OUT, `opening-count-${DATE}.csv`), toCsv(sheet.rows));

  const sum = (f: (r: (typeof sheet.rows)[number]) => number) => sheet.rows.reduce((s, r) => s + f(r), 0);
  const md = [
    `# 기초재고 실사표 점검 ${DATE}`,
    '',
    `- 활성 SKU ${db.skus.length} · RG 재고 응답 ${stock.length}건(수량>0 ${stock.filter((s) => s.qty > 0).length})`,
    `- RG 실재고 합계 ${sum((r) => r.rgActual)} · 자체보관 미리 채운 합계 ${sum((r) => r.selfCount ?? 0)} · **빈칸(옵션별 실사 필요) ${sheet.rows.filter((r) => r.selfCount === null).length}행**`,
    '',
    '## 채우는 법',
    '',
    `1. \`opening-count-${DATE}.csv\`를 연다(Numbers·엑셀).`,
    '2. `self_count` = **지금 집에 있는 개수**(SKU 기준 단위). 미리 채운 값은 옛 장부 계산이다 — 다르면 고친다. 빈칸은 옵션별로 세서 적는다.',
    '3. `rg_inbound` = RG로 보냈는데 아직 쿠팡 판매 가능 수량에 안 잡힌 개수. 없으면 0.',
    '4. `unit_cost` 빈칸인데 재고가 있으면 개당 매입가를 적는다.',
    '5. `rg_actual`은 적재 때 API로 다시 읽으므로 고치지 않는다.',
    '',
    `## 이슈 ${issues.length}건`,
    '',
    '| 종류 | 대상 | 내용 |',
    '|---|---|---|',
    ...issues.map((i) => `| ${i.kind} | ${i.ref} | ${i.detail.replace(/\|/g, '\\|')} |`),
    '',
    `## 기준 단위 미정 — 배수 > 1인 SKU ${db.baseUnitMissing.length}건`,
    '',
    '배수 1이 무엇인지(예: 「6팩」 「낱포 1개」)를 정해야 실사 개수를 셀 수 있다. 답은 `docs/erp/sku-overrides.json`의 `baseUnit`에 넣는다.',
    '',
    '| SKU | 상품 | 최대 배수 |',
    '|---|---|---|',
    ...db.baseUnitMissing.map((b) => `| ${b.key} | ${b.name} | ${b.maxMultiplier} |`),
    '',
    '`rg_vid_unmapped`·`rg_listing_multi_sku`가 남아 있으면 적재가 멈춘다. 원장에 넣지 않을 vid는 `docs/erp/opening-overrides.json`의 `ignoreRgVids`에 사유와 함께 적는다.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `opening-review-${DATE}.md`), md);
  console.log(`✅ opening-count-${DATE}.csv · opening-review-${DATE}.md — 이슈 ${issues.length}건 · 빈칸 ${sheet.rows.filter((r) => r.selfCount === null).length}행`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`❌ ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: 실행**

Run: `npx tsc --noEmit && npx --no-install tsx scripts/erp/opening-collect.ts`
Expected: `✅ opening-count-<날짜>.csv …`. CSV 첫 줄이 `sku_id,sku_key,…`이고 행 수 = 활성 SKU 수(215 전후).

- [ ] **Step 3: 확인 사항 정리** — 보고서의 이슈 표와 기준 단위 표를 컨트롤러에게 요약해 넘긴다. **CSV를 사람 대신 채우지 않는다.**

- [ ] **Step 4: 커밋**

```bash
git add scripts/erp/opening-collect.ts docs/erp/opening-count-*.csv docs/erp/opening-review-*.md
git commit -m "feat(erp): 기초재고 실사표·점검 보고서 생성(읽기 전용)"
```

---

### Task 10: 🔴 사용자 실사 게이트

- [ ] **Step 1:** 컨트롤러가 사용자에게 보고서 요약(이슈·빈칸 수·기준 단위 미정 목록)을 보여주고 CSV를 연다: `open docs/erp/opening-count-<날짜>.csv`
- [ ] **Step 2:** 사용자가 `self_count`·`rg_inbound`·빈 `unit_cost`를 채우고, 기준 단위 질문에 답하고, 무시할 RG vid를 정한다. **답은 받는 즉시 이 계획서의 「사용자 실사 결정」 절에 적는다.**
- [ ] **Step 3:** 기준 단위 답을 `docs/erp/sku-overrides.json`의 `baseUnit`에 넣고 `sku-apply.ts` 점검 → `--apply`(SKU 갱신만 있어야 한다).
- [ ] **Step 4:** 커밋

```bash
git add docs/erp/ docs/superpowers/plans/2026-09-26-erp-phase1b-stock-ledger.md
git commit -m "docs(erp): 기초재고 실사 결과와 기준 단위(사용자 확인)"
```

---

## 사용자 실사 결정 (Task 10 진행 중 — 2026-09-26)

- 실사표 `docs/erp/opening-count-2026-09-26.csv`(215행 · RG 16 SKU 236개 · 미리 채운 자체보관 35행 891개 · 빈칸 67행 = 옵션 그룹 14개). **사용자는 Numbers로 편집해 `~/Documents/opening-count-2026-09-26.numbers`에 저장한다** — 끝나면 컨트롤러가 Numbers에서 CSV로 내보내 원본 경로에 덮어쓴다(`osascript … export … as CSV`, BOM 없음 — `parseCountCsv`가 둘 다 읽는다). 2번 행(스위퍼 YELLOW) self_count 5→2 수정 확인.
- 2026-09-26 사용자 실사 완료(자체보관 891→237). 밀레 블랙 270은 실사표 6 → **4로 정정**(사용자) — 베이지 240 2와 합쳐 6켤레, 매입 7켤레 이내.
- 대기 중 질문 ① 기준 단위 4건: 다슈 왁스 100ml(최대 배수 3) · 이볼루덤 750ml(2) · 퓨어틴 초코 330ml(2) · 퓨어틴 커피 330ml(2)
- 대기 중 질문 ② 승인 목록에 없는 RG 재고 4건(합계 8개): `95812283106` 1개(마스터버니 얼음주머니 옵션 — 7월 판매 이력) · `95932746388` 1개 · `95833506834` 3개 · `95693450298` 3개(뒤 셋은 DB에 흔적 없음, 쿠팡 RG 승인 상품 102개에도 없음). 원장 제외(`opening-overrides.json`의 `ignoreRgVids`) 또는 SKU 생성 중 택일
- 대기 중 ③ `unit_cost` 빈칸 5건: 쿨매트 핑크 · 쿨매트 블루 구름(베개형) S · 105(L) 블랙 · 화이트+그레이스트라이프 150 · 니트 건조대 2단

### Task 11: 기초재고 적재와 RG 대조

**Files:**
- Create: `scripts/erp/opening-apply.ts`, `scripts/erp/rg-reconcile.ts`

- [ ] **Step 1: 대조 스크립트 작성** (1-C에서 매일 재사용)

```ts
// scripts/erp/rg-reconcile.ts
// 사용법: npx --no-install tsx scripts/erp/rg-reconcile.ts
// 원장 RG 재고(erp.stock_on_hand location='rg') ↔ 쿠팡 RG 판매 가능 수량. 다르면 표로 보이고 exit 1.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { fetchRgStock, loadOverrides } from './opening-collect';
import { reconcileRg, rgQtyBySku } from '@/lib/erp/ledger/opening';

loadEnvLocal();

export async function runReconcile(): Promise<number> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let ledger: Map<number, number>;
  let links: { vid: string; skuId: number; multiplier: number }[];
  let keys: Map<number, string>;
  let cutover: string | null;
  try {
    await c.query('BEGIN READ ONLY');
    ledger = new Map((await c.query(`select sku_id, qty from erp.stock_on_hand where location = 'rg'`)).rows.map((r) => [Number(r.sku_id), Number(r.qty)]));
    links = (await c.query(
      `select l.external_product_id as vid, x.sku_id, x.multiplier
         from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id
        where l.channel = 'coupang_rg' and l.active`,
    )).rows.map((r) => ({ vid: String(r.vid), skuId: Number(r.sku_id), multiplier: Number(r.multiplier) }));
    keys = new Map((await c.query(`select id, key from erp.skus`)).rows.map((r) => [Number(r.id), r.key]));
    cutover = (await c.query(`select cursor_at::text from erp.sync_cursors where name = 'ledger_cutover'`)).rows[0]?.cursor_at ?? null;
    await c.query('COMMIT');
  } finally {
    await c.end();
  }
  const rg = rgQtyBySku(links, await fetchRgStock(), new Set(Object.keys(loadOverrides().ignoreRgVids)));
  const diff = reconcileRg(ledger, rg.bySku);
  console.log(`기초재고 시각: ${cutover ?? '없음'} · 원장 RG SKU ${ledger.size} · 실재고 SKU ${rg.bySku.size} · 불일치 ${diff.length} · 매핑 이슈 ${rg.issues.length}`);
  if (diff.length > 0) console.table(diff.map((d) => ({ SKU: keys.get(d.skuId) ?? d.skuId, 원장: d.ledger, 실재고: d.actual, 차이: d.diff })));
  for (const i of rg.issues) console.log(`  ⚠️ ${i.kind} ${i.ref} — ${i.detail}`);
  return diff.length + rg.issues.length;
}

if (require.main === module) {
  runReconcile()
    .then((n) => { if (n > 0) process.exitCode = 1; else console.log('✅ 원장 RG = 쿠팡 RG 실재고'); })
    .catch((e) => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1; });
}
```

- [ ] **Step 2: 적재 스크립트 작성**

```ts
// scripts/erp/opening-apply.ts
// 사용법: npx --no-install tsx scripts/erp/opening-apply.ts [--apply | --verify]
// 최신 docs/erp/opening-count-*.csv(사람이 채운 실사표) + 지금 읽은 쿠팡 RG 재고 → erp.stock_ledger 기초 전표.
// 기본(점검): 적재할 합계와 멈출 이유만 출력한다.
// --apply : 한 트랜잭션. 기초 전표가 이미 있으면 거부한다(고칠 때는 조정 전표). 끝에 sync_cursors 'ledger_cutover'를 적는다.
// --verify: rg-reconcile과 같다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { fetchRgStock, loadOverrides } from './opening-collect';
import { runReconcile } from './rg-reconcile';
import { parseCountCsv, rgQtyBySku, type CountRow } from '@/lib/erp/ledger/opening';
import { postLotCreate } from '@/lib/erp/ledger/store';
import type { Location } from '@/lib/erp/ledger/fifo';

loadEnvLocal();
const DIR = path.join(__dirname, '..', '..', 'docs', 'erp');
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');

function latestCsv(): { file: string; rows: CountRow[] } {
  const file = fs.readdirSync(DIR).filter((n) => /^opening-count-.*\.csv$/.test(n)).sort().pop();
  if (!file) throw new Error('docs/erp/opening-count-*.csv가 없다 — opening-collect.ts를 먼저 돌린다');
  return { file, rows: parseCountCsv(fs.readFileSync(path.join(DIR, file), 'utf-8')) };
}

interface Plan {
  skuId: number;
  key: string;
  location: Location;
  qty: number;
  unitCost: number;
}

async function main(): Promise<void> {
  if (VERIFY) {
    if ((await runReconcile()) > 0) process.exitCode = 1;
    return;
  }
  const { file, rows } = latestCsv();
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const active = (await c.query(`select id, key from erp.skus where status = 'active'`)).rows.map((r) => ({ id: Number(r.id), key: r.key as string }));
    const links = (await c.query(
      `select l.external_product_id as vid, x.sku_id, x.multiplier
         from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id
        where l.channel = 'coupang_rg' and l.active`,
    )).rows.map((r) => ({ vid: String(r.vid), skuId: Number(r.sku_id), multiplier: Number(r.multiplier) }));
    const existing = Number((await c.query(`select count(*) from erp.stock_ledger where kind = 'opening'`)).rows[0].count);
    await c.query('COMMIT');

    const errs: string[] = [];
    if (existing > 0) errs.push(`기초 전표가 이미 ${existing}건 있다 — 다시 적재하지 않는다. 고칠 것은 조정 전표로`);
    const bySku = new Map(rows.map((r) => [r.skuId, r]));
    for (const s of active) if (!bySku.has(s.id)) errs.push(`실사표에 없는 활성 SKU: ${s.key}`);
    for (const r of rows) {
      const s = active.find((a) => a.id === r.skuId);
      if (!s) errs.push(`실사표의 SKU ${r.skuId}(${r.skuKey})가 활성 SKU가 아니다`);
      else if (s.key !== r.skuKey) errs.push(`SKU ${r.skuId} 키가 다르다: 실사표 ${r.skuKey} / DB ${s.key}`);
      if (r.selfCount === null) errs.push(`self_count 빈칸: ${r.skuKey}`);
      else if (r.selfCount < 0) errs.push(`self_count 음수: ${r.skuKey}`);
      if (r.rgInbound < 0) errs.push(`rg_inbound 음수: ${r.skuKey}`);
    }

    const rg = rgQtyBySku(links, await fetchRgStock(), new Set(Object.keys(loadOverrides().ignoreRgVids)));
    for (const i of rg.issues) errs.push(`${i.kind} ${i.ref} — ${i.detail}`);

    const plan: Plan[] = [];
    for (const r of rows) {
      const rgNow = rg.bySku.get(r.skuId) ?? 0;
      const total = (r.selfCount ?? 0) + r.rgInbound + rgNow;
      if (total > 0 && r.unitCost === null) errs.push(`재고 ${total}개인데 unit_cost 빈칸: ${r.skuKey}`);
      for (const [location, qty] of [['self', r.selfCount ?? 0], ['rg_inbound', r.rgInbound], ['rg', rgNow]] as const) {
        if (qty > 0) plan.push({ skuId: r.skuId, key: r.skuKey, location, qty, unitCost: r.unitCost ?? 0 });
      }
    }

    const rgMoved = rows.filter((r) => (rg.bySku.get(r.skuId) ?? 0) !== r.rgActual);
    const total = (loc: Location) => plan.filter((p) => p.location === loc).reduce((s, p) => s + p.qty, 0);
    const value = plan.reduce((s, p) => s + p.qty * p.unitCost, 0);
    console.log(`${file} → 기초 전표 ${plan.length}건 · self ${total('self')} · rg_inbound ${total('rg_inbound')} · rg ${total('rg')} · 평가액 ${value.toLocaleString()}원`);
    if (rgMoved.length > 0) console.log(`(참고) 실사표 작성 후 RG 재고가 바뀐 SKU ${rgMoved.length}개 — 적재는 지금 값으로 한다`);
    if (errs.length > 0) throw new Error(`적재할 수 없다 ${errs.length}건:\n  ${errs.slice(0, 40).join('\n  ')}`);
    if (!APPLY) {
      console.log('(점검만 — 적재하려면 --apply)');
      return;
    }

    const cutoverAt = new Date().toISOString();
    await c.query('BEGIN');
    try {
      for (const p of plan) {
        await postLotCreate(c, {
          skuId: p.skuId, location: p.location, qty: p.qty, unitCost: p.unitCost, kind: 'opening',
          occurredAt: cutoverAt, idemKey: `opening:${p.skuId}:${p.location}`, refType: 'opening', refId: file,
        });
      }
      await c.query(
        `insert into erp.sync_cursors (name, cursor_at) values ('ledger_cutover', $1)
         on conflict (name) do update set cursor_at = excluded.cursor_at, updated_at = now()`,
        [cutoverAt],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
    console.log(`✅ 기초재고 적재 — ${plan.length}건 · 기준 시각 ${cutoverAt}`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 3: 점검 모드**

Run: `npx tsc --noEmit && npx --no-install tsx scripts/erp/opening-apply.ts`
Expected: `… 기초 전표 N건 …` 과 `(점검만 — 적재하려면 --apply)`. `적재할 수 없다`가 나오면 원인을 컨트롤러에게 보고한다(실사표 빈칸·매핑 이슈는 사용자 몫).

- [ ] **Step 4: 🔴 컨트롤러가 사용자에게 합계(수량·평가액)를 보여주고 승인을 받은 뒤** 적재와 대조:

Run: `npx --no-install tsx scripts/erp/opening-apply.ts --apply && npx --no-install tsx scripts/erp/opening-apply.ts --verify`
Expected: `✅ 기초재고 적재`, 이어서 `✅ 원장 RG = 쿠팡 RG 실재고`.
적재와 대조 사이에 RG 판매가 나면 그 SKU만 −1 수준으로 어긋난다 — 그 경우 대조를 한 번 더 돌려 차이가 판매로 설명되는지 본다(판매 차감은 1-C가 기초재고 시각부터 소급한다).

- [ ] **Step 5: 커밋**

```bash
git add scripts/erp/opening-apply.ts scripts/erp/rg-reconcile.ts
git commit -m "feat(erp): 기초재고 적재와 RG 실재고 대조"
```

---

### Task 12: 1-B 마무리

- [ ] **Step 1:** 전체 테스트와 타입 검사 — `npx vitest run` (실패 13 이하), `npx tsc --noEmit` (0 오류)
- [ ] **Step 2:** 이 계획서 끝에 「적재 결과」 절(기초 전표 건수·위치별 합계·평가액·대조 결과·기준 시각)을 적는다.
- [ ] **Step 3:** 최종 리뷰(superpowers:requesting-code-review) → 브랜치 푸시 → PR. 병합은 사용자 확인 후.

---

## 이 계획에서 하지 않는 것 (1-C로 넘긴다)

| 항목 | 이유 · 1-C에서 할 일 |
|---|---|
| 주문·주문라인(P3), 어댑터, 판매 차감 전표 | 1-C 본체. 수집 시작점 = `sync_cursors.ledger_cutover` — 기초재고 이후 판매를 빠짐없이 소급한다 |
| **당근 수동 판매 등록** (2026-09-26 사용자 승인 시 1-B로 적었던 것) | 판매는 주문라인에 묶이므로 주문 테이블과 함께 1-C로 옮긴다. 원장 쪽 준비(자체보관 차감 `postConsume`)는 이 계획이 만든다 |
| 입고 전표(영수증 확정 → `receipt`)와 `purchase_units` 적재 | 품번 오매핑 의심 2건(693742·888450) 확인과 함께. 기초재고 이후 입고는 `cost_entries.created_at > ledger_cutover`로 소급 |
| RG 보내기(`self → rg_inbound`)와 입고 완료(`rg_inbound → rg`, RG 판매 가능 수량 증가로 판정) · N일 넘게 입고중이면 경보 | RG 입고 API가 없어 재고 API 증가분을 신호로 쓴다. 매일 `rg-reconcile`을 pg_cron에 올린다 |
| `sale_records` RG 무효 1,062건 원인 · Wing 판매 키 중복(`wing-…`/`…`) | 판매 가져오기를 어댑터로 바꿀 때 함께 고친다. 둘 다 옛 수익 화면 숫자에 영향이 있다 |
| 마스터버니 얼음주머니 보관 SKU | 과거 판매를 원장에 옮기지 않기로 해 필요 없어졌다 |
| 1-A 정리 잔여(`validate()` 테스트 · report 예시 로직 중복 · `--verify` 채널 필터) | 동작에 영향이 없는 정리 — 2단계 화면 작업 전에 |
| (I2) 역전표 뒤 같은 멱등키 재기록 | `alreadyPosted`가 원 전표를 찾아 **무시한다**(역전표로 상쇄돼 있어도). 1-C의 취소→재주문·재수집은 버전 키(`sale:<주문>@2`)를 쓴다 |
| (I4) FIFO와 시각 | FIFO는 lot 시각과 판매 시각을 비교하지 않는다 — 1-C에서 `lotAt <= occurredAt` 필터 여부를 정하고, `occurredAt`은 오프셋 있는 ISO 문자열만 받는다. 여러 SKU를 한 트랜잭션에 기록할 때는 `sku_id` 오름차순으로 잠가 교착을 피한다 |
