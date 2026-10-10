# ERP 원가관리 상품 추가 → SKU 자동 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원가관리에 쿠팡 상품번호가 있는 상품을 저장하면 서버가 그 상품의 SKU·리스팅·연결을 바로 만들고, 빠진 상품은 재고현황의 「SKU 다시 맞추기」로 채운다.

**Architecture:** 전체 적재 스크립트(`sku-collect` → `sku-apply`) 안에 있던 세 덩어리(쿠팡 상세 변환 · DB 입력 읽기 · upsert)를 `src/lib/erp/sku/`로 옮기고, 그 위에 상품 하나만 다루는 `syncSellerProduct`(`sync-product.ts`)를 올린다. 키·옵션·배수·원가 연결은 전체 적재와 같은 순수 함수 `buildDraft`가 정한다. 원가관리 라우트 둘은 저장(자동 커밋)이 끝난 **뒤** `sync-app.ts`를 부르고 실패를 응답의 `skuSync`로만 알린다. 설계: `docs/superpowers/specs/2026-10-10-erp-sku-auto-add-design.md`.

**Tech Stack:** Next.js App Router · TypeScript · vitest + @testing-library/react + msw · PostgreSQL(`pg` 풀 `getSourcingPool`, 스크립트는 `pg.Client` + `SUPABASE_DB_URL`) · 쿠팡 Wing API(`getProductDetail`).

**작업 위치:** worktree `/Users/seungminlee/dev/smart_seller_studio/.worktrees/sku-keep`(브랜치 `fix/sku-apply-keep-legacy`, 시작 HEAD `b4030799`). `.env.local`은 `../../.env.local` 심볼릭 링크로 이미 있다.

## 🔴 실행자 규칙 (어기면 사용자 화면이 깨지거나 운영 DB가 바뀐다)

1. **`next build`·`npm run build` 금지, `.next` 삭제 금지** — 다른 폴더에서 dev 서버가 돈다.
2. 검사는 `npx vitest run <경로>`와 `npx tsc --noEmit -p .`만 쓴다.
3. **운영 DB에 쓰지 않는다.** 이 계획의 DB 접근은 전부 `BEGIN READ ONLY` 트랜잭션 안의 읽기다. `sku-apply.ts --apply` 실행 금지 · `sku-collect.ts` 실행 금지(오늘 날짜 초안 JSON을 덮어쓰고 쿠팡을 수백 번 부른다) · `psql`로 `insert/update/delete` 금지. 테스트는 전부 가짜 DB를 쓴다.
4. **push 금지.** 커밋은 각 Task 끝에서 해당 파일만 `git add <경로>`로 담는다(`git add -A` 금지).
5. 운영 대조(Task 12)가 다르면 **코드를 추측으로 고치지 말고** 차이를 그대로 보고한다.

**계획 코드 사전 검증(2026-10-10, 계획 작성자):** 이 계획의 코드 블록을 버리는 임시 worktree에 그대로 붙여 돌렸다 — `tsc` 0 · 관련 테스트 20파일 168개 PASS(새 테스트 9파일) · `sku-apply.ts` 점검 출력 변경 전과 `diff` 동일 · Task 12 운영 대조 4개 상품 모두 같다(읽기 전용). 실행자는 그대로 옮기면 된다. 다르게 나오면 그새 코드나 DB가 바뀐 것이다.

## 계획 작성 중 정한 것 (설계서가 열어 둔 곳)

| # | 설계서 | 정한 것 | 이유 |
|---|---|---|---|
| 1 | 「SKU 적재와 같은 advisory lock」 | **SKU 적재에 잠금이 없었다.** `upsert.ts`에 `SKU_MASTER_LOCK = 7103`(`pg_advisory_xact_lock(bigint)`)을 새로 두고 `sku-apply --apply`와 `syncSellerProduct`가 둘 다 잡는다 | 7101(원장 SKU, int 쌍)·7102(기초재고 bigint · 주문 채널 int 쌍)와 겹치지 않는다(`grep -rn pg_advisory src scripts`로 확인) |
| 2 | 「이미 있으면 건너뛴다」 | 쿠팡을 부르기 **전**에 한 번, 잠금을 잡은 **뒤** 한 번 더 본다 | 원가관리 bulk와 「SKU 다시 맞추기」가 겹쳐도 같은 상품을 두 번 만들지 않는다 |
| 3 | 「그 상품의 SKU·리스팅·연결만」 | 네이버·토스 리스팅은 **DB에 아직 없는 것만** 만든다. 이미 있는 것(다른 상품과 `any_of`로 묶인 것 등)은 연결도 건드리지 않는다 | 상품 하나만 본 초안은 묶음의 다른 상품을 몰라 `link_mode`를 `single`로 잘못 덮는다. 그 경우는 전체 적재가 맡는다(설계 §4 한계와 같은 쪽) |
| 4 | DB 입력 「상품번호 필터」 | 그 상품번호의 원가 행 + 그 vid들을 가리키는 원가 연결·품절 동기화 연결만 읽는다. **`sale_records`는 읽지 않는다** | 판매 귀속은 `buildDraft`의 점검 이슈(`sale_attribution_mismatch`)에만 쓰이고 행을 바꾸지 않는다. `sale_records` 전체 정규식 조회를 저장마다 돌릴 이유가 없다 |
| 5 | 운영 대조의 「초안 단계까지만」 | `syncSellerProduct(deps, id, { planOnly: true })` → `{ status: 'planned', skus, plan }`. 존재 확인·잠금·쓰기를 하지 않는다. 라우트는 이 옵션을 쓰지 않으므로 라우트 응답의 `status`는 설계의 네 값뿐이다(오버로드로 타입 보장) | 이미 있는 10-10 상품 4개로 대조하려면 존재 확인을 건너뛰어야 한다 |
| 6 | bulk 「상품별 결과」 | 응답 `data.skuSync: [{ seller_product_id, product_name, status, skus, error? }]`. 한 요청에서 SKU 자동 추가는 **최대 20개**, 넘는 상품은 `failed`(「한 번에 20개까지 자동 추가 — 재고현황의 「SKU 다시 맞추기」로 채운다」). bulk 라우트 `maxDuration = 300`, 단건 라우트 `60` | bulk는 한 번에 200건까지 받는다. 쿠팡 조회를 200번 돌리면 함수 시간을 넘는다 — 「SKU 다시 맞추기」와 같은 상한 |
| 7 | 단건 응답 | `{ success, data: <저장된 행>, skuSync }` — `data`(행)에 섞지 않고 최상위에 둔다 | 기존 `data` 형태를 그대로 둔다 |
| 8 | 「SKU 다시 맞추기」 대상 | `product_costs.seller_product_id > 0` · 리스팅·SKU 키 둘 다 없음 · **최근 추가 순** · 숨김 여부는 보지 않는다 | 2026-10-10 운영 읽기 전용 측정: 대상 0건. 전체 적재도 숨김 상품을 포함한다 |
| 9 | 앱 연결부 | `sync-app.ts`(풀·`withTx`·`getCoupangClient`를 붙인다)를 `sync-product.ts`와 따로 둔다 | `withTx`가 있는 `@/lib/erp/stock/http`는 `next/server`를 끌어온다 — 스크립트(Task 12)가 `sync-product.ts`만 import하게 |
| 10 | 단건 화면(`AddProductModal`) | 이 창은 쿠팡에 없는 상품 전용이라 상품번호를 보내지 않는다 → 늘 `skipped`. 토스트 처리는 같은 함수로 달아 둔다(조용히 무시) | 쿠팡 상품은 `BulkAddProductModal`로만 들어온다 |
| 11 | 「쿠팡 호출 1.3초 간격」 | `getProductDetail`의 실제 간격은 200ms(`API_DELAY`)다. 상한 20은 설계대로 둔다 | 1.3초는 RG API 간격(`RG_API_DELAY`)이다. 20개면 어느 쪽이든 300초 안 |

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/erp/sku/coupang-input.ts` | 쿠팡 상품 상세 → `DraftInput.coupangProducts` 한 줄 · vid 목록 | 생성 |
| `src/lib/erp/sku/db-input.ts` | DB → `DraftInput`의 나머지(전체 또는 상품 하나 범위) | 생성 |
| `src/lib/erp/sku/upsert.ts` | 초안 불변식 검사 · SKU 마스터 잠금 · SKU/리스팅/연결 upsert(원가 연결 합집합) | 생성 |
| `src/lib/erp/sku/sync-product.ts` | `syncSellerProduct`(상품 하나 · `planOnly`) · `syncMissing`(빠진 상품 최대 20개) | 생성 |
| `src/lib/erp/sku/sync-app.ts` | 앱 연결부(풀·트랜잭션·쿠팡) — `syncForApp` · `syncMissingForApp`. 던지지 않는다 | 생성 |
| `src/lib/erp/sku/sync-message.ts` | 결과 → 화면 문구(토스트 · 버튼 결과 줄) | 생성 |
| `scripts/erp/sku-collect.ts` | 위 lib를 쓴다 — 출력 불변 | 수정 |
| `scripts/erp/sku-apply.ts` | 위 lib를 쓴다 · `--apply`가 잠금을 잡는다 — 점검 출력 불변 | 수정 |
| `scripts/erp/sku-sync-compare.ts` | 운영 대조(읽기 전용) — `planOnly` 계획 vs 현재 DB | 생성 |
| `src/app/api/cost-management/products/route.ts` | POST 저장 뒤 `skuSync` | 수정 |
| `src/app/api/cost-management/products/bulk/route.ts` | 저장 뒤 상품별 `skuSync`(최대 20) | 수정 |
| `src/app/api/erp/skus/sync-missing/route.ts` | POST — 빠진 상품 SKU 맞추기 | 생성 |
| `src/components/orders/AddProductModal.tsx` · `BulkAddProductModal.tsx` | `skuSync` 토스트 | 수정 |
| `src/components/erp/stock/SkuSyncButton.tsx` | 「SKU 다시 맞추기」 버튼 + 결과 줄 | 생성 |
| `src/components/erp/stock/api.ts` · `StockClient.tsx` | 호출 함수 · 버튼 배치 | 수정 |
| 테스트 | `src/__tests__/lib/erp/sku/coupang-input.test.ts` · `db-input.test.ts` · `upsert.test.ts` · `sync-fake.ts`(가짜 DB, 테스트 아님) · `sync-product.test.ts` · `sync-missing.test.ts` · `sync-message.test.ts` · `src/__tests__/api/cost-management-products-sku-sync.test.ts` · `src/__tests__/api/erp-skus-sync-missing.test.ts` · `src/__tests__/components/erp-sku-sync-button.test.tsx` | 생성 |

---

### Task 0: 회귀 기준선 기록 (읽기 전용)

**Files:** 없음(출력만 `/tmp`에 둔다)

- [ ] **Step 1: 점검 dry-run 기준선** — `sku-apply.ts`는 인자 없이 돌리면 `BEGIN READ ONLY`로만 읽는다.

Run:
```bash
cd /Users/seungminlee/dev/smart_seller_studio/.worktrees/sku-keep
npx --no-install tsx scripts/erp/sku-apply.ts > /tmp/sku-apply-before.txt 2>&1; tail -16 /tmp/sku-apply-before.txt
```
Expected(2026-10-10 17:20 실측과 같아야 한다):
```
sku-draft-2026-10-10.json + overrides → SKU 220(active 220) · 리스팅 452 · 연결 462
  리스팅 채널: coupang_wing 197 · coupang_rg 102 · naver 104 · toss 49
  link_mode: single 449 · any_of 3
현재 DB: SKU 221 · 리스팅 452 · 연결 462
--apply 시 변경:
  SKU      삽입 0 · 갱신 0 · 동일 220 · 보관(archived) 0
  (유지) … 3줄(콜맨 · 트루릴리젼 · 마크곤잘레스)
  리스팅   삽입 0 · 갱신 0 · 동일 452 · 비활성화 0
  연결     draft 462 재작성 (신규 0 · 배수변경 0 · 삭제 0)
  manual 충돌 SKU 0 · 리스팅 0 · 연결 0 — 0이 아니면 --apply가 실패한다
```
숫자가 다르면(그새 누가 SKU를 바꿨다) 멈추고 보고한다 — 이 파일이 Task 4의 비교 기준이다.

- [ ] **Step 2: 기준 테스트** — Run: `npx vitest run src/__tests__/lib/erp/sku/` · Expected: PASS(3파일 75개). Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: `0`.

---

### Task 1: `coupang-input.ts` — 쿠팡 상세 → 초안 입력

**Files:**
- Create: `src/lib/erp/sku/coupang-input.ts`
- Test: `src/__tests__/lib/erp/sku/coupang-input.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/erp/sku/coupang-input.test.ts
import { describe, it, expect } from 'vitest';
import { toCoupangProduct, vidsOf } from '@/lib/erp/sku/coupang-input';

describe('toCoupangProduct', () => {
  it('Wing vid는 최상위 → marketplaceItemData 순, RG vid는 rocketGrowthItemData', () => {
    const p = toCoupangProduct({
      sellerProductId: '16404126884',
      sellerProductName: '펜들턴 셔파 담요',
      items: [
        { itemName: '화이트', vendorItemId: 11, rocketGrowthItemData: { vendorItemId: 21 } },
        { itemName: '사바나', marketplaceItemData: { vendorItemId: 12 } },
        { itemName: 'RG만', rocketGrowthItemData: { vendorItemId: 23 } },
      ],
    });
    expect(p.sellerProductId).toBe(16404126884);
    expect(p.productName).toBe('펜들턴 셔파 담요');
    expect(p.items.map((i) => [i.itemName, i.wingVid, i.rgVid])).toEqual([
      ['화이트', 11, 21],
      ['사바나', 12, null],
      ['RG만', null, 23],
    ]);
    expect(vidsOf(p)).toEqual([11, 21, 12, 23]);
  });

  it('값이 빈 속성은 버리고 exposed는 있을 때만 남긴다', () => {
    const p = toCoupangProduct({
      sellerProductId: 1,
      sellerProductName: 'x',
      items: [{
        itemName: '블랙 1개',
        vendorItemId: 5,
        attributes: [
          { attributeTypeName: '색상', attributeValueName: '블랙', exposed: 'EXPOSED' },
          { attributeTypeName: '수량', attributeValueName: ' ' },
          { attributeTypeName: '모델명', attributeValueName: 'A-1' },
        ],
      }],
    });
    expect(p.items[0].attributes).toEqual([
      { attributeTypeName: '색상', attributeValueName: '블랙', exposed: 'EXPOSED' },
      { attributeTypeName: '모델명', attributeValueName: 'A-1' },
    ]);
  });

  it('items·itemName이 없으면 빈 값', () => {
    expect(toCoupangProduct({ sellerProductId: 2, sellerProductName: 'y' }).items).toEqual([]);
    const p = toCoupangProduct({ sellerProductId: 3, sellerProductName: 'z', items: [{ vendorItemId: 7 }] });
    expect(p.items[0]).toEqual({ itemName: '', attributes: [], wingVid: 7, rgVid: null });
    expect(vidsOf(p)).toEqual([7]);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/coupang-input.test.ts` · Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `scripts/erp/sku-collect.ts`의 `collectCoupang` 안 변환을 그대로 옮긴다(주석 포함).

```ts
// src/lib/erp/sku/coupang-input.ts
// 쿠팡 상품 상세(getProductDetail 응답) → SKU 초안 입력 한 줄.
// 전체 적재(scripts/erp/sku-collect.ts)와 상품 하나 추가(sync-product.ts)가 같은 변환을 쓴다.
import type { DraftInput } from './draft';

export type CoupangProductInput = DraftInput['coupangProducts'][number];

export function toCoupangProduct(detail: unknown): CoupangProductInput {
  const d = detail as { sellerProductId: number; sellerProductName: string; items?: Record<string, unknown>[] };
  return {
    sellerProductId: Number(d.sellerProductId),
    productName: d.sellerProductName,
    items: (d.items ?? []).map((it) => {
      // 로켓그로스 동시 운영 상품은 Wing vid가 최상위가 아니라 marketplaceItemData.vendorItemId에 있다(2026-09-26 실측).
      const rg = it.rocketGrowthItemData as { vendorItemId?: number } | undefined;
      const mp = it.marketplaceItemData as { vendorItemId?: number } | undefined;
      const wing = it.vendorItemId ?? mp?.vendorItemId;
      return {
        itemName: String(it.itemName ?? ''),
        // 옵션 키가 쓰는 세 필드(이름·값·exposed)만 남기고, 값이 빈 속성은 버린다(초안 JSON 크기 절감).
        // 빈 속성은 옵션 조합에서도 어차피 걸러지지만, 값이 빈 `수량` 속성까지 버리므로 그런 item은
        // 수량을 itemName에서 읽는다(빈 값을 수량 1로 읽는 것보다 정확하다). exposed는 구매옵션(EXPOSED)과
        // 검색옵션(NONE)을 가르는 데 필요하므로 유지한다.
        attributes: Array.isArray(it.attributes)
          ? (it.attributes as { attributeTypeName: string; attributeValueName: string; exposed?: string }[])
              .filter((a) => String(a.attributeValueName ?? '').trim() !== '')
              .map((a) => ({ attributeTypeName: a.attributeTypeName, attributeValueName: a.attributeValueName, ...(a.exposed ? { exposed: a.exposed } : {}) }))
          : [],
        wingVid: wing ? Number(wing) : null,
        rgVid: rg?.vendorItemId ? Number(rg.vendorItemId) : null,
      };
    }),
  };
}

/** 상품의 모든 Wing·RG vid(item 순서, Wing 먼저) */
export const vidsOf = (p: CoupangProductInput): number[] =>
  p.items.flatMap((it) => [it.wingVid, it.rgVid]).filter((v): v is number => typeof v === 'number' && v > 0);
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/coupang-input.test.ts` · Expected: PASS(3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/sku/coupang-input.ts src/__tests__/lib/erp/sku/coupang-input.test.ts
git commit -m "refactor(erp): 쿠팡 상품 상세 → SKU 초안 입력 변환을 lib로"
```

---

### Task 2: `db-input.ts` — DB → 초안 입력(전체 · 상품 하나)

**Files:**
- Create: `src/lib/erp/sku/db-input.ts`
- Test: `src/__tests__/lib/erp/sku/db-input.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/erp/sku/db-input.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readDraftDbInput } from '@/lib/erp/sku/db-input';

function fake() {
  const calls: { sql: string; params: unknown }[] = [];
  const res = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('from product_costs')) {
      return res([
        { id: 'pc-1', product_name: '담요', seller_product_id: '16404126884', vendor_item_id: null },
        { id: 'pc-2', product_name: '샴푸', seller_product_id: '-3', vendor_item_id: '96152866376' },
      ]);
    }
    if (sql.includes('from product_cost_channels')) return res([{ product_cost_id: 'pc-1', channel_type: 'coupang_wing', external_id: '11', unit_multiplier: 2 }]);
    if (sql.includes('from stock_sync_links')) return res([{ coupang_vendor_item_id: '11', channel: 'naver', product_id: '900', option_key: null, label: null }]);
    if (sql.includes('from sale_records')) {
      return res([
        { vid: '11', product_cost_id: 'pc-1', rows: 3 },
        { vid: null, product_cost_id: 'pc-1', rows: 1 },
        { vid: '12', product_cost_id: null, rows: 1 },
      ]);
    }
    return res([]);
  });
  return { db: { query }, calls };
}

describe('readDraftDbInput', () => {
  it('전체 — 네 조회를 범위 없이 돌리고 sku-collect와 같은 모양으로 바꾼다', async () => {
    const f = fake();
    const x = await readDraftDbInput(f.db);
    expect(x).toEqual({
      legacyProductCosts: [
        { id: 'pc-1', productName: '담요', sellerProductId: 16404126884, vendorItemId: null },
        { id: 'pc-2', productName: '샴푸', sellerProductId: -3, vendorItemId: 96152866376 },
      ],
      legacyChannels: [{ productCostId: 'pc-1', channelType: 'coupang_wing', externalId: 11, unitMultiplier: 2 }],
      syncLinks: [{ coupangVid: 11, channel: 'naver', productId: 900, optionKey: '', label: null }],
      saleAttributions: [{ vid: 11, productCostId: 'pc-1', rows: 3 }],
    });
    // 초안 JSON의 input 키 순서가 바뀌지 않게
    expect(Object.keys(x)).toEqual(['legacyProductCosts', 'legacyChannels', 'syncLinks', 'saleAttributions']);
    expect(f.calls).toHaveLength(4);
    expect(f.calls.every((c) => c.params === undefined)).toBe(true);
    expect(f.calls[0].sql).toBe('select id, product_name, seller_product_id, vendor_item_id from product_costs');
  });

  it('상품 하나 — 상품번호·vid로 좁히고 sale_records는 읽지 않는다', async () => {
    const f = fake();
    const x = await readDraftDbInput(f.db, { sellerProductId: 16404126884, vids: [11, 21] });
    expect(f.calls).toHaveLength(3);
    expect(f.calls.some((c) => c.sql.includes('sale_records'))).toBe(false);
    expect(f.calls[0].params).toEqual([16404126884, [11, 21]]);
    expect(f.calls[0].sql).toContain('where seller_product_id = $1 or vendor_item_id = any($2::bigint[])');
    expect(f.calls[1].params).toEqual([[11, 21]]);
    expect(f.calls[1].sql).toContain("channel_type <> 'naver' and external_id = any($1::bigint[])");
    expect(f.calls[2].params).toEqual([[11, 21]]);
    expect(f.calls[2].sql).toContain('where coupang_vendor_item_id = any($1::bigint[])');
    expect(x.saleAttributions).toEqual([]);
    expect(x.legacyChannels).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/db-input.test.ts` · Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현** — 전체 모드 SQL 네 개는 `sku-collect.ts`의 `collectDb`에서 글자 그대로 옮긴다.

```ts
// src/lib/erp/sku/db-input.ts
// DB → SKU 초안 입력(쿠팡 상품을 뺀 나머지). 전체 적재는 범위 없이, 상품 하나 추가는 그 상품번호·vid로 좁혀 읽는다.
// 트랜잭션은 호출자가 연다(전체 적재는 BEGIN READ ONLY). 구매자 정보는 읽지 않는다 — sale_records에서는 vid·product_cost_id·건수만.
import type { Db } from '@/lib/erp/ledger/store';
import type { DraftInput } from './draft';

type Q = Pick<Db, 'query'>;
export type DraftDbInput = Omit<DraftInput, 'coupangProducts'>;
/** 상품 하나로 좁힌다 — 그 상품번호의 원가 행 · 그 vid들을 가리키는 원가 연결·품절 동기화 연결 */
export interface DbScope {
  sellerProductId: number;
  vids: number[];
}

export async function readDraftDbInput(db: Q, scope?: DbScope): Promise<DraftDbInput> {
  const pcs = scope
    ? (await db.query(
        `select id, product_name, seller_product_id, vendor_item_id from product_costs
          where seller_product_id = $1 or vendor_item_id = any($2::bigint[])
             or id in (select product_cost_id from product_cost_channels where channel_type <> 'naver' and external_id = any($2::bigint[]))`,
        [scope.sellerProductId, scope.vids],
      )).rows
    : (await db.query(`select id, product_name, seller_product_id, vendor_item_id from product_costs`)).rows;
  const pcc = scope
    ? (await db.query(
        `select product_cost_id, channel_type, external_id, unit_multiplier from product_cost_channels
          where channel_type <> 'naver' and external_id = any($1::bigint[])`,
        [scope.vids],
      )).rows
    : (await db.query(`select product_cost_id, channel_type, external_id, unit_multiplier from product_cost_channels`)).rows;
  const ssl = scope
    ? (await db.query(
        `select coupang_vendor_item_id, channel, product_id, option_key, label from stock_sync_links
          where coupang_vendor_item_id = any($1::bigint[])`,
        [scope.vids],
      )).rows
    : (await db.query(`select coupang_vendor_item_id, channel, product_id, option_key, label from stock_sync_links`)).rows;
  // 판매 귀속은 점검 이슈(sale_attribution_mismatch)에만 쓰이고 행을 바꾸지 않는다 —
  // 상품 하나 추가에서는 sale_records 전체를 훑는 조회를 돌리지 않는다.
  const sales = scope
    ? []
    : (await db.query(`
      select nullif(regexp_replace(coupang_order_item_id, '^.*-', ''), '')::bigint as vid, product_cost_id, count(*)::int as rows
        from sale_records
       where voided_at is null and channel in ('coupang', 'rocket_growth') and coupang_order_item_id ~ '-[0-9]+$'
       group by 1, 2`)).rows;
  return {
    legacyProductCosts: pcs.map((r) => ({
      id: String(r.id),
      productName: String(r.product_name),
      sellerProductId: Number(r.seller_product_id),
      vendorItemId: r.vendor_item_id ? Number(r.vendor_item_id) : null,
    })),
    legacyChannels: pcc.map((r) => ({
      productCostId: String(r.product_cost_id),
      channelType: r.channel_type as DraftInput['legacyChannels'][number]['channelType'],
      externalId: Number(r.external_id),
      unitMultiplier: Number(r.unit_multiplier),
    })),
    syncLinks: ssl.map((r) => ({
      coupangVid: Number(r.coupang_vendor_item_id),
      channel: r.channel as DraftInput['syncLinks'][number]['channel'],
      productId: Number(r.product_id),
      optionKey: String(r.option_key ?? ''),
      label: r.label ?? null,
    })),
    saleAttributions: sales
      .filter((r) => r.vid && r.product_cost_id)
      .map((r) => ({ vid: Number(r.vid), productCostId: String(r.product_cost_id), rows: Number(r.rows) })),
  };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/db-input.test.ts` · Expected: PASS(2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/sku/db-input.ts src/__tests__/lib/erp/sku/db-input.test.ts
git commit -m "refactor(erp): SKU 초안 DB 입력 읽기를 lib로 — 상품 하나 범위 추가"
```

---

### Task 3: `upsert.ts` — 불변식 · 잠금 · upsert

**Files:**
- Create: `src/lib/erp/sku/upsert.ts`
- Test: `src/__tests__/lib/erp/sku/upsert.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/erp/sku/upsert.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SKU_MASTER_LOCK, insertLinks, lockSkuMaster, upsertListings, upsertSkus, validateDraft, type DraftRows } from '@/lib/erp/sku/upsert';

const PC = '7cab2ba8-cb4e-4c3a-8d3f-273455c1513a';
const rows = (): DraftRows => ({
  skus: [{ key: 'cp:1:블랙', name: '왜건', optionLabel: '블랙', baseUnitLabel: null, status: 'active', legacyProductCostIds: [PC] }],
  listings: [{ key: 'coupang_wing|11|', channel: 'coupang_wing', externalProductId: '11', externalOptionKey: '', altProductId: '1', label: '왜건 · 블랙', linkMode: 'single' }],
  links: [{ listingKey: 'coupang_wing|11|', skuKey: 'cp:1:블랙', multiplier: 1 }],
});

function fake(empty: string[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let id = 10;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (empty.some((frag) => sql.includes(frag))) return { rows: [], rowCount: 0 };
    return { rows: [{ id: ++id }], rowCount: 1 };
  });
  return { db: { query }, calls };
}

describe('validateDraft', () => {
  it('정상이면 던지지 않는다', () => expect(() => validateDraft(rows())).not.toThrow());
  it('비어 있으면 던진다', () => expect(() => validateDraft({ ...rows(), links: [] })).toThrow(/비어 있는 것/));
  it('uuid 아닌 원가 연결 · single인데 SKU 2개 · 배수 0을 잡는다', () => {
    const d = rows();
    d.skus[0].legacyProductCostIds = ['pc-1'];
    d.skus.push({ ...d.skus[0], key: 'cp:1:레드', legacyProductCostIds: [] });
    d.links.push({ listingKey: 'coupang_wing|11|', skuKey: 'cp:1:레드', multiplier: 0 });
    expect(() => validateDraft(d)).toThrow(/uuid 아님[\s\S]*배수가 양의 정수가 아니다[\s\S]*single인데 SKU 2개/);
  });
});

describe('upsert', () => {
  it('잠금은 bigint 7103', async () => {
    const f = fake();
    await lockSkuMaster(f.db);
    expect(SKU_MASTER_LOCK).toBe(7103);
    expect(f.calls[0]).toEqual({ sql: 'select pg_advisory_xact_lock($1::bigint)', params: [7103] });
  });

  it('SKU — 원가 연결은 DB ∪ 초안, draft 행만 덮는다 · 키→id 맵', async () => {
    const f = fake();
    const ids = await upsertSkus(f.db, rows().skus);
    expect([...ids]).toEqual([['cp:1:블랙', 11]]);
    expect(f.calls[0].sql).toContain('unnest(erp.skus.legacy_product_cost_ids || excluded.legacy_product_cost_ids)');
    expect(f.calls[0].sql).toContain("where erp.skus.origin = 'draft'");
    expect(f.calls[0].params).toEqual(['cp:1:블랙', '왜건', '블랙', null, 'active', [PC]]);
  });

  it('manual과 겹치면(0행) 던진다', async () => {
    await expect(upsertSkus(fake(['insert into erp.skus']).db, rows().skus)).rejects.toThrow('초안 키 cp:1:블랙가 manual SKU와 겹친다');
    await expect(upsertListings(fake(['insert into erp.channel_listings']).db, rows().listings)).rejects.toThrow('manual 리스팅과 겹친다');
  });

  it('리스팅 → 연결', async () => {
    const f = fake();
    const sku = await upsertSkus(f.db, rows().skus);
    const lst = await upsertListings(f.db, rows().listings);
    await insertLinks(f.db, rows().links, sku, lst);
    expect(f.calls[1].params).toEqual(['coupang_wing', '11', '', '1', '왜건 · 블랙', 'single']);
    expect(f.calls[2].sql).toContain('on conflict (listing_id, sku_id) do nothing');
    expect(f.calls[2].params).toEqual([12, 11, 1]);
  });

  it('연결 대상이 맵에 없으면 던진다', async () => {
    await expect(insertLinks(fake().db, rows().links, new Map(), new Map())).rejects.toThrow('연결 대상 누락');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/upsert.test.ts` · Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `validate`와 `apply`의 upsert SQL을 `sku-apply.ts`에서 글자 그대로 옮긴다. 정리(보관·비활성화·연결 삭제)는 옮기지 않는다.

```ts
// src/lib/erp/sku/upsert.ts
// SKU 초안 행 → erp.skus · erp.channel_listings · erp.listing_skus.
// 전체 적재(scripts/erp/sku-apply.ts --apply)와 상품 하나 추가(sync-product.ts)가 같이 쓴다.
// 보관·비활성화·연결 삭제(정리)는 전체 적재 전용이라 여기 없다.
// 호출자가 트랜잭션을 열고 lockSkuMaster를 먼저 잡는다.
// 원가 연결(legacy_product_cost_ids)은 DB 값과 초안 값의 합집합으로 둔다 — 초안은 옛 판매 기록으로만 연결을 찾아,
// 사람이 손으로 붙인 연결(2026-10-05 콜맨·트루릴리젼·마크곤잘레스)을 모른다. 지우면 옛 장부 경고가 되살아난다.
import type { Db } from '@/lib/erp/ledger/store';
import type { Draft, DraftLink, DraftListing, DraftSku } from './draft';

type Q = Pick<Db, 'query'>;
export type DraftRows = Pick<Draft, 'skus' | 'listings' | 'links'>;

/**
 * SKU 마스터 쓰기 잠금(pg_advisory_xact_lock(bigint)). 전체 적재와 상품 하나 추가가 겹쳐 쓰지 않게 한다.
 * 7101(원장 SKU, int 쌍)·7102(기초재고 bigint · 주문 채널 int 쌍)와 겹치지 않는다.
 */
export const SKU_MASTER_LOCK = 7103;

export async function lockSkuMaster(db: Q): Promise<void> {
  await db.query('select pg_advisory_xact_lock($1::bigint)', [SKU_MASTER_LOCK]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 적재 전 불변식. 하나라도 어긋나면 던진다(DB에 쓰기 전에). */
export function validateDraft(d: DraftRows): void {
  const errs: string[] = [];
  if (d.skus.length === 0 || d.listings.length === 0 || d.links.length === 0) errs.push('SKU·리스팅·연결 중 비어 있는 것이 있다');
  const skuKeys = new Set<string>();
  for (const s of d.skus) {
    if (skuKeys.has(s.key)) errs.push(`SKU 키 중복: ${s.key}`);
    skuKeys.add(s.key);
    if (!s.name) errs.push(`SKU 이름 없음: ${s.key}`);
    for (const id of s.legacyProductCostIds) if (!UUID.test(id)) errs.push(`uuid 아님: ${s.key} → ${id}`);
  }
  const listingKeys = new Set<string>();
  const uniq = new Set<string>();
  for (const l of d.listings) {
    if (listingKeys.has(l.key)) errs.push(`리스팅 키 중복: ${l.key}`);
    listingKeys.add(l.key);
    const u = `${l.channel}|${l.externalProductId}|${l.externalOptionKey}`;
    if (uniq.has(u)) errs.push(`리스팅 유니크 키 중복: ${u}`);
    uniq.add(u);
  }
  const linkCount = new Map<string, number>();
  const linkPair = new Set<string>();
  for (const k of d.links) {
    if (!listingKeys.has(k.listingKey)) errs.push(`연결의 리스팅이 없다: ${k.listingKey} → ${k.skuKey}`);
    if (!skuKeys.has(k.skuKey)) errs.push(`연결의 SKU가 없다: ${k.listingKey} → ${k.skuKey}`);
    if (!Number.isInteger(k.multiplier) || k.multiplier <= 0) errs.push(`배수가 양의 정수가 아니다: ${k.listingKey} → ${k.skuKey} = ${k.multiplier}`);
    const p = `${k.listingKey}→${k.skuKey}`;
    if (linkPair.has(p)) errs.push(`연결 중복: ${p}`);
    linkPair.add(p);
    linkCount.set(k.listingKey, (linkCount.get(k.listingKey) ?? 0) + 1);
  }
  for (const l of d.listings) {
    const n = linkCount.get(l.key) ?? 0;
    if (n === 0) errs.push(`연결 없는 리스팅: ${l.key}`);
    else if (l.linkMode === 'single' && n !== 1) errs.push(`single인데 SKU ${n}개: ${l.key}`);
    else if (l.linkMode === 'any_of' && n < 2) errs.push(`any_of인데 SKU ${n}개: ${l.key}`);
  }
  if (errs.length > 0) throw new Error(`불변식 위반 ${errs.length}건:\n  ${errs.slice(0, 30).join('\n  ')}`);
}

/** 키 기준 upsert(draft 행만 덮는다). 키 → erp.skus.id */
export async function upsertSkus(db: Q, skus: DraftSku[]): Promise<Map<string, number>> {
  const skuId = new Map<string, number>();
  for (const s of skus) {
    const { rows } = await db.query(
      `insert into erp.skus (key, name, option_label, base_unit_label, status, legacy_product_cost_ids, origin)
         values ($1, $2, $3, $4, $5, $6::uuid[], 'draft')
         on conflict (key) do update set name = excluded.name, option_label = excluded.option_label,
           base_unit_label = excluded.base_unit_label, status = excluded.status,
           legacy_product_cost_ids = array(select distinct x from unnest(erp.skus.legacy_product_cost_ids || excluded.legacy_product_cost_ids) as x order by x),
           updated_at = now()
         where erp.skus.origin = 'draft'
         returning id`,
      [s.key, s.name, s.optionLabel, s.baseUnitLabel, s.status, s.legacyProductCostIds],
    );
    if (rows.length === 0) throw new Error(`초안 키 ${s.key}가 manual SKU와 겹친다 — 초안을 고친다`);
    skuId.set(s.key, Number(rows[0].id));
  }
  return skuId;
}

/** (channel, external_product_id, external_option_key) 기준 upsert(draft 행만 덮는다). 리스팅 키 → erp.channel_listings.id */
export async function upsertListings(db: Q, listings: DraftListing[]): Promise<Map<string, number>> {
  const listingId = new Map<string, number>();
  for (const l of listings) {
    const { rows } = await db.query(
      `insert into erp.channel_listings (channel, external_product_id, external_option_key, alt_product_id, label, link_mode, active, origin)
         values ($1, $2, $3, $4, $5, $6, true, 'draft')
         on conflict (channel, external_product_id, external_option_key) do update
           set alt_product_id = excluded.alt_product_id, label = excluded.label, link_mode = excluded.link_mode, active = true
         where erp.channel_listings.origin = 'draft'
         returning id`,
      [l.channel, l.externalProductId, l.externalOptionKey, l.altProductId, l.label, l.linkMode],
    );
    if (rows.length === 0) throw new Error(`초안 리스팅 ${l.key}가 manual 리스팅과 겹친다 — 초안을 고친다`);
    listingId.set(l.key, Number(rows[0].id));
  }
  return listingId;
}

/** 연결을 넣는다(이미 있으면 그대로). manual 연결과 겹치면 던진다 */
export async function insertLinks(db: Q, links: DraftLink[], skuId: Map<string, number>, listingId: Map<string, number>): Promise<void> {
  for (const k of links) {
    const lid = listingId.get(k.listingKey);
    const sid = skuId.get(k.skuKey);
    if (!lid || !sid) throw new Error(`연결 대상 누락: ${k.listingKey} → ${k.skuKey}`);
    const { rows } = await db.query(
      `insert into erp.listing_skus (listing_id, sku_id, multiplier, origin) values ($1, $2, $3, 'draft')
         on conflict (listing_id, sku_id) do nothing
         returning 1`,
      [lid, sid, k.multiplier],
    );
    if (rows.length === 0) throw new Error(`연결 ${k.listingKey}→${k.skuKey}가 manual 연결과 겹친다 — 초안을 고친다`);
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/upsert.test.ts` · Expected: PASS(8).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/sku/upsert.ts src/__tests__/lib/erp/sku/upsert.test.ts
git commit -m "refactor(erp): SKU 초안 upsert·불변식을 lib로 — SKU 마스터 잠금(7103) 추가"
```

---

### Task 4: 스크립트 두 개가 lib를 쓴다 — 출력 불변 회귀

**Files:**
- Modify: `scripts/erp/sku-collect.ts`(전체 교체)
- Modify: `scripts/erp/sku-apply.ts:1-80`(머리말·import·`validate` 삭제), `apply()` 전체, 맨 아래 실행부의 `validate(d)`
- 임시: `scripts/erp/_check-sku-input.ts`(돌린 뒤 지운다 — 커밋하지 않는다)

- [ ] **Step 1: `sku-collect.ts` 교체** — 출력 파일·콘솔 문구는 그대로 두고 `collectDb`의 네 조회와 `collectCoupang`의 변환만 lib로 바꾼다.

```ts
// scripts/erp/sku-collect.ts
// 사용법: npx --no-install tsx scripts/erp/sku-collect.ts
// DB(읽기 전용 세션)와 쿠팡 API(GET만)에서 입력을 모아 SKU 초안(JSON)과 점검 보고서(MD)를 docs/erp/에 쓴다.
// 구매자 정보는 읽지 않는다 — sale_records에서는 vid·product_cost_id·건수만 모은다.
// DB 입력 읽기·쿠팡 상세 변환은 원가관리 상품 추가(src/lib/erp/sku/sync-product.ts)와 같은 lib를 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { buildDraft, type DraftInput } from '@/lib/erp/sku/draft';
import { readDraftDbInput, type DraftDbInput } from '@/lib/erp/sku/db-input';
import { toCoupangProduct } from '@/lib/erp/sku/coupang-input';
import { renderReport } from '@/lib/erp/sku/report';
import { getCoupangClient } from '@/lib/listing/coupang-client';

loadEnvLocal();
const DATE = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', '..', 'docs', 'erp');

interface OpsFacts {
  naverSyncProducts: number;
  naverSales90d: number;
  naverSoldProducts90d: number;
  costcoMap: { itemCode: string; itemLabel: string | null; productName: string | null }[];
}

type DbInput = DraftDbInput & { sellerProductIds: number[]; ops: OpsFacts };

async function collectDb(): Promise<DbInput> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // 세션 SET이 아니라 트랜잭션 단위로 읽기 전용을 건다 — 트랜잭션 pooler 모드에서도 모든 조회가 이 트랜잭션 안에서 돈다.
    await c.query('BEGIN READ ONLY');
    const core = await readDraftDbInput(c);
    // 운영 영향 메모용 실측(읽기 전용). 구매자 정보는 읽지 않는다 — 건수와 상품 수만.
    const naverSync = (await c.query(`select count(distinct product_id)::int as n from stock_sync_links where channel = 'naver'`)).rows[0];
    const naverSales = (await c.query(`
      select count(*)::int as rows, count(distinct product_cost_id)::int as products
        from sale_records
       where voided_at is null and channel = 'naver' and sold_at >= (now() at time zone 'Asia/Seoul')::date - 90`)).rows[0];
    const costco = (await c.query(`
      select m.item_code, m.item_label, pc.product_name
        from costco_item_map m left join product_costs pc on pc.id = m.product_cost_id
       where m.item_code in ('693742', '888450')
       order by m.item_code`)).rows;
    const ops: OpsFacts = {
      naverSyncProducts: Number(naverSync.n),
      naverSales90d: Number(naverSales.rows),
      naverSoldProducts90d: Number(naverSales.products),
      costcoMap: costco.map((r) => ({ itemCode: String(r.item_code), itemLabel: r.item_label ?? null, productName: r.product_name ?? null })),
    };
    await c.query('COMMIT');
    return {
      ops,
      ...core,
      sellerProductIds: [...new Set(core.legacyProductCosts.map((r) => r.sellerProductId).filter((n) => n > 0))],
    };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

async function collectCoupang(extraIds: number[]): Promise<{ products: DraftInput['coupangProducts']; failed: number[] }> {
  const cp = getCoupangClient();
  const ids = new Set(extraIds);
  for (const bt of [undefined, 'rocketGrowth']) {
    let token = '';
    do {
      const page = await cp.getSellerProducts('APPROVED', 50, token, bt);
      for (const p of page.items) ids.add(Number((p as unknown as { sellerProductId: number }).sellerProductId));
      token = page.nextToken ?? '';
    } while (token);
  }
  console.log(`쿠팡 상품 ${ids.size}개 상세 조회…`);
  const products: DraftInput['coupangProducts'] = [];
  const failed: number[] = [];
  for (const id of ids) {
    try {
      products.push(toCoupangProduct(await cp.getProductDetail(id)));
    } catch (e) {
      failed.push(id);
      console.error(`⚠️ 쿠팡 상품 ${id} 조회 실패: ${(e as Error).message}`);
    }
  }
  return { products, failed };
}

(async () => {
  const db = await collectDb();
  const { products: coupangProducts, failed } = await collectCoupang(db.sellerProductIds);
  const { sellerProductIds: _unused, ops, ...rest } = db;
  void _unused;
  const input: DraftInput = { ...rest, coupangProducts };
  const draft = buildDraft(input);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `sku-draft-${DATE}.json`), JSON.stringify({ input, draft, coupangFetchFailed: failed }, null, 2));
  const costcoLine = ops.costcoMap.length
    ? ops.costcoMap.map((m) => `${m.itemCode} 「${m.itemLabel ?? '라벨 없음'}」→${m.productName ?? '연결 없음'}`).join(', ')
    : '693742·888450 둘 다 costco_item_map에 없음';
  const notes = [
    `네이버 판매 가져오기(naver-bulk-import)는 product_costs.naver_channel_product_no만 본다 — 품절 동기화에 연결된 네이버 상품은 ${ops.naverSyncProducts}개인데 최근 90일 네이버 판매 기록은 ${ops.naverSales90d}건(${ops.naverSoldProducts90d}개 상품)뿐이다(${DATE} 기준). 나머지 판매는 기록되지 않았을 가능성이 크다. 1-C(주문 수집)에서 channel_listings로 해결한다.`,
    `costco_item_map 오매핑 의심(${DATE} 현재 연결): ${costcoLine}. purchase_units 적재 전 확인이 필요하다.`,
  ];
  if (failed.length) notes.push(`쿠팡 상품 상세 조회 실패 ${failed.length}건(판매 종료·삭제 상품일 수 있다): ${failed.join(', ')}`);
  fs.writeFileSync(path.join(OUT, `sku-review-${DATE}.md`), renderReport(draft, { date: DATE, notes }));
  console.log(`SKU ${draft.skus.length} · 리스팅 ${draft.listings.length} · 연결 ${draft.links.length} · 이슈 ${draft.issues.length}`);
  console.log(`→ docs/erp/sku-draft-${DATE}.json, docs/erp/sku-review-${DATE}.md`);
})().catch((e) => {
  console.error(`실패: ${(e as Error).message}`);
  process.exit(1);
});
```

(`rest`의 키 순서는 `readDraftDbInput`의 반환 순서 = 원래 순서(legacyProductCosts · legacyChannels · syncLinks · saleAttributions)라 초안 JSON 모양이 그대로다.)

- [ ] **Step 2: `sku-apply.ts` 머리말·import·`validate`** — 파일 첫 줄부터 `const sameArr = …` 줄 **바로 앞**까지(머리말 · import · `UUID` · `newClient` · `loadFinalDraft` · `validate`)를 아래로 바꾼다(`UUID`와 `validate`는 `upsert.ts`로 옮겨 갔으므로 사라진다). `sameArr`·`unionArr`부터 아래 `dryRun`·`verify`는 건드리지 않는다.

```ts
// scripts/erp/sku-apply.ts
// 사용법: npx --no-install tsx scripts/erp/sku-apply.ts [--apply | --verify]
// 최신 초안 + docs/erp/sku-overrides.json → erp.skus / channel_listings / listing_skus 적재.
//
// 기본(점검): 적재할 내용과 현재 DB와의 차이만 출력한다. DB는 BEGIN READ ONLY 트랜잭션으로만 읽는다.
// --apply : 트랜잭션 하나로 적재한다. 키 기준 upsert라 다시 돌려도 안전하다. 오류가 나면 전부 롤백하고 exit 1.
//           SKU 마스터 잠금(lockSkuMaster, 7103)을 먼저 잡는다 — 원가관리 상품 추가(sync-product)와 겹쳐 쓰지 않게.
//           초안에서 빠진 연결은 지운다(listing_skus는 초안이 원장이다). skus·channel_listings는 지우지 않고
//           보관(archived / active=false)한다.
//           보관·비활성화·연결 삭제는 origin='draft' 행에만 한다 — 1-B 이후 손으로 만든 행(manual)은 건드리지 않는다.
//           원가 연결(legacy_product_cost_ids)은 DB 값과 초안 값의 합집합으로 둔다 — 초안은 옛 판매 기록으로만 연결을 찾아,
//           사람이 손으로 붙인 연결(2026-10-05 콜맨·트루릴리젼·마크곤잘레스)을 모른다. 지우면 옛 장부 경고가 되살아난다.
//           upsert·불변식은 src/lib/erp/sku/upsert.ts(원가관리 상품 추가와 공유), 정리(보관·비활성화·삭제)는 여기만.
// --verify: 적재 결과 점검표(1-1 완료 기준)를 읽기 전용으로 출력한다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { applyOverrides, type Draft, type Overrides } from '@/lib/erp/sku/draft';
import { insertLinks, lockSkuMaster, upsertListings, upsertSkus, validateDraft } from '@/lib/erp/sku/upsert';

loadEnvLocal();
const DIR = path.join(__dirname, '..', '..', 'docs', 'erp');
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');

const newClient = () => new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

function loadFinalDraft(): { draftFile: string; d: Draft } {
  const draftFile = fs.readdirSync(DIR).filter((n) => /^sku-draft-.*\.json$/.test(n)).sort().pop();
  if (!draftFile) throw new Error('docs/erp/sku-draft-*.json이 없다 — sku-collect.ts를 먼저 돌린다');
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, draftFile), 'utf-8')) as { draft: Draft; coupangFetchFailed?: unknown[] };
  // 쿠팡 조회가 일부 실패한 초안은 SKU가 빠져 있다 — 그대로 적재하면 빠진 SKU가 보관 처리된다.
  if (raw.coupangFetchFailed && raw.coupangFetchFailed.length > 0) {
    throw new Error(`${draftFile}은 쿠팡 조회 실패 ${raw.coupangFetchFailed.length}건이 있는 초안이다 — sku-collect.ts를 다시 돌린다`);
  }
  const overrides = JSON.parse(fs.readFileSync(path.join(DIR, 'sku-overrides.json'), 'utf-8')) as Overrides;
  return { draftFile, d: applyOverrides(raw.draft, overrides) };
}
```

- [ ] **Step 3: `sku-apply.ts`의 `apply()` 교체** — `async function apply(d: Draft): Promise<void> {`부터 그 함수 끝까지를 아래로 바꾼다(정리 SQL과 순서는 그대로).

```ts
async function apply(d: Draft): Promise<void> {
  const c = newClient();
  await c.connect();
  try {
    await c.query('BEGIN');
    await lockSkuMaster(c);
    const skuId = await upsertSkus(c, d.skus);
    const archived = await c.query(
      `update erp.skus set status = 'archived', updated_at = now()
        where status <> 'archived' and origin = 'draft' and not (key = any($1::text[]))`,
      [d.skus.map((s) => s.key)],
    );
    // P5: SKU 키는 동결이다. 초안에서 키가 사라지거나 병합(overrides)으로 보관되는 SKU에 원장 재고가 있으면
    //     재고가 보이지 않게 된다 — 보관을 반영한 뒤 같은 트랜잭션에서 확인하고, 있으면 전부 롤백한다.
    const stocked = await c.query(
      `select s.key, h.location, h.qty
         from erp.skus s join erp.stock_on_hand h on h.sku_id = s.id
        where s.status = 'archived' and s.origin = 'draft' and h.qty <> 0`,
    );
    if (stocked.rows.length > 0) {
      throw new Error(`재고가 있는 SKU를 보관하려 한다 — 키가 바뀌었거나 병합됐다. 초안(overrides)을 고친다:\n  ${stocked.rows.map((r) => `${r.key} ${r.location} ${r.qty}`).join('\n  ')}`);
    }

    const listingId = await upsertListings(c, d.listings);
    const deactivated = await c.query(
      `update erp.channel_listings set active = false where active and origin = 'draft' and not (id = any($1::bigint[]))`,
      [[...listingId.values()]],
    );

    await c.query(`delete from erp.listing_skus where origin = 'draft'`);
    await insertLinks(c, d.links, skuId, listingId);
    await c.query('COMMIT');
    console.log(`✅ 적재 완료 — SKU ${skuId.size}(보관 ${archived.rowCount}) · 리스팅 ${listingId.size}(비활성화 ${deactivated.rowCount}) · 연결 ${d.links.length}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(`❌ 롤백: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
```

- [ ] **Step 4: 실행부** — 맨 아래 즉시 실행 함수의 `validate(d);`를 `validateDraft(d);`로 바꾼다.

- [ ] **Step 5: 타입 확인** — Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: `0`. (`scripts/_*`만 tsc에서 빠지고 `scripts/erp/*`는 검사된다.)

- [ ] **Step 6: 점검 dry-run 회귀(읽기 전용)**

Run:
```bash
npx --no-install tsx scripts/erp/sku-apply.ts > /tmp/sku-apply-after.txt 2>&1; diff /tmp/sku-apply-before.txt /tmp/sku-apply-after.txt && echo "출력 같음"
```
Expected: `출력 같음` — 특히 `SKU      삽입 0 · 갱신 0 · 동일 220 · 보관(archived) 0` · `리스팅   삽입 0 · 갱신 0 · 동일 452 · 비활성화 0` · `연결     draft 462 재작성 (신규 0 · 배수변경 0 · 삭제 0)` · 리스팅 채널·link_mode 줄이 Task 0과 같다. 다르면 멈추고 보고한다.

- [ ] **Step 7: 수집 입력 회귀(읽기 전용 · 임시 파일)** — `sku-collect.ts`는 돌리지 않는다(초안 파일을 덮어쓴다). 대신 lib가 읽는 값을 10-10 초안 JSON의 `input`과 비교한다. 아래 파일을 만든다(`scripts/_*`라 tsc에서 빠진다).

```ts
// scripts/erp/_check-sku-input.ts — 임시. 돌린 뒤 지운다. DB는 BEGIN READ ONLY, 쿠팡은 GET 1회.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { readDraftDbInput } from '@/lib/erp/sku/db-input';
import { toCoupangProduct } from '@/lib/erp/sku/coupang-input';
import { getCoupangClient } from '@/lib/listing/coupang-client';

loadEnvLocal();
const sortJ = (a: unknown[]) => a.map((x) => JSON.stringify(x)).sort();

(async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'erp', 'sku-draft-2026-10-10.json'), 'utf-8'));
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const now = await readDraftDbInput(c);
    await c.query('ROLLBACK');
    for (const k of ['legacyProductCosts', 'legacyChannels', 'syncLinks'] as const) {
      const a = sortJ(raw.input[k]);
      const b = sortJ(now[k]);
      const onlyOld = a.filter((x) => !b.includes(x));
      const onlyNew = b.filter((x) => !a.includes(x));
      console.log(`${k}: 초안 ${a.length} · 지금 ${b.length} · 초안에만 ${onlyOld.length} · 지금만 ${onlyNew.length}`);
      for (const x of [...onlyOld.map((s) => `- ${s}`), ...onlyNew.map((s) => `+ ${s}`)].slice(0, 10)) console.log(`    ${x}`);
    }
    console.log(`saleAttributions: 초안 ${raw.input.saleAttributions.length} · 지금 ${now.saleAttributions.length} (그새 판매가 늘면 달라도 된다)`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
  const id = 16404126884;
  const before = raw.input.coupangProducts.find((p: { sellerProductId: number }) => p.sellerProductId === id);
  const after = toCoupangProduct(await getCoupangClient().getProductDetail(id));
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(`쿠팡 변환 ${id}: ${same ? '같다' : `다르다\n  초안 ${JSON.stringify(before)}\n  지금 ${JSON.stringify(after)}`}`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

Run:
```bash
npx --no-install tsx scripts/erp/_check-sku-input.ts; rm scripts/erp/_check-sku-input.ts
```
Expected: 세 줄 모두 `초안에만 0 · 지금만 0` · `쿠팡 변환 16404126884: 같다`. 차이가 있으면 출력된 행을 보고 「10-10 17:12 초안 이후의 DB 변경」인지(예: 원가관리에 상품을 더 넣었다) 「변환이 달라졌다」인지 가려 보고한다 — 후자면 멈춘다. `git status`에 `_check-sku-input.ts`가 남지 않아야 한다.

- [ ] **Step 8: 기존 테스트** — Run: `npx vitest run src/__tests__/lib/erp/sku/` · Expected: PASS(6파일).

- [ ] **Step 9: Commit**

```bash
git add scripts/erp/sku-collect.ts scripts/erp/sku-apply.ts
git commit -m "refactor(erp): SKU 적재 스크립트가 공유 lib를 쓴다 — 점검 출력 불변(삽입 0·갱신 0·동일 220)"
```

---

### Task 5: `sync-product.ts` — `syncSellerProduct`

**Files:**
- Create: `src/lib/erp/sku/sync-product.ts`
- Create: `src/__tests__/lib/erp/sku/sync-fake.ts`(가짜 DB·쿠팡 — 테스트 파일 이름이 아니라 vitest가 따로 돌리지 않는다. Task 6도 쓴다)
- Test: `src/__tests__/lib/erp/sku/sync-product.test.ts`

- [ ] **Step 1: 가짜 DB·쿠팡 작성** — SQL 조각으로 응답을 고르고 모든 호출을 기록한다.

```ts
// src/__tests__/lib/erp/sku/sync-fake.ts
// syncSellerProduct · syncMissing 테스트용 가짜 DB·쿠팡·트랜잭션. 운영 DB에 닿지 않는다.
import { vi } from 'vitest';
import type { SyncDeps } from '@/lib/erp/sku/sync-product';

export const PC = '7cab2ba8-cb4e-4c3a-8d3f-273455c1513a';
export const SP = 16404126884;

export const detail = (id = SP) => ({
  sellerProductId: id,
  sellerProductName: '펜들턴 셔파 담요',
  items: [
    { itemName: '화이트쇼어', vendorItemId: 11, rocketGrowthItemData: { vendorItemId: 21 } },
    { itemName: '사바나', marketplaceItemData: { vendorItemId: 12 } },
  ],
});

export interface FakeOpts {
  /** 존재 확인 응답(차례로). 다 쓰면 false */
  hit?: boolean[];
  pcs?: Record<string, unknown>[];
  pcc?: Record<string, unknown>[];
  ssl?: Record<string, unknown>[];
  existingListings?: string[];
  missing?: Record<string, unknown>[];
  /** erp.skus upsert가 manual과 겹쳐 0행 */
  skuConflict?: boolean;
}

export function fake(o: FakeOpts = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const hits = [...(o.hit ?? [])];
  let id = 100;
  let txCount = 0;
  const res = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('order by at desc')) return res(o.missing ?? []);
    if (sql.includes('as hit')) return res([{ hit: hits.shift() ?? false }]);
    if (sql.includes('pg_advisory_xact_lock')) return res([{}]);
    if (sql.includes('from product_costs')) return res(o.pcs ?? [{ id: PC, product_name: '펜들턴', seller_product_id: String(SP), vendor_item_id: null }]);
    if (sql.includes('from product_cost_channels')) return res(o.pcc ?? []);
    if (sql.includes('from stock_sync_links')) return res(o.ssl ?? []);
    if (sql.includes('as k from erp.channel_listings')) return res((o.existingListings ?? []).map((k) => ({ k })));
    if (sql.includes('insert into erp.skus') && o.skuConflict) return res([]);
    if (sql.includes('insert into erp.listing_skus')) return res([{ ok: 1 }]);
    if (sql.includes('insert into erp.')) return res([{ id: ++id }]);
    return res([]);
  });
  const db = { query };
  const coupang = { getProductDetail: vi.fn(async (sid: number): Promise<unknown> => detail(sid)) };
  const tx: SyncDeps['tx'] = async (fn) => {
    txCount++;
    return fn(db);
  };
  const deps: SyncDeps = { db, tx, coupang };
  const writes = () => calls.filter((c) => /^\s*(insert|update|delete)/i.test(c.sql));
  return { deps, calls, coupang, writes, txCount: () => txCount };
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/erp/sku/sync-product.test.ts
import { describe, it, expect } from 'vitest';
import { syncSellerProduct } from '@/lib/erp/sku/sync-product';
import { PC, SP, fake } from './sync-fake';

describe('syncSellerProduct', () => {
  it('새 상품 — 잠금 뒤 옵션별 SKU·Wing/RG 리스팅·연결을 만들고, 원가 연결은 같은 상품번호의 원가 행', async () => {
    const f = fake();
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'created', skus: 2 });
    const lockAt = f.calls.findIndex((c) => c.sql.includes('pg_advisory_xact_lock'));
    expect(f.calls[lockAt].params).toEqual([7103]);
    const w = f.writes();
    expect(lockAt).toBeLessThan(f.calls.indexOf(w[0]));
    const skus = w.filter((c) => c.sql.includes('insert into erp.skus'));
    expect(skus.map((c) => c.params.slice(0, 3))).toEqual([
      [`cp:${SP}:화이트쇼어`, '펜들턴 셔파 담요', '화이트쇼어'],
      [`cp:${SP}:사바나`, '펜들턴 셔파 담요', '사바나'],
    ]);
    expect(skus.map((c) => c.params[5])).toEqual([[PC], [PC]]);
    const listings = w.filter((c) => c.sql.includes('insert into erp.channel_listings'));
    expect(listings.map((c) => [c.params[0], c.params[1], c.params[3], c.params[4]])).toEqual([
      ['coupang_wing', '11', String(SP), '펜들턴 셔파 담요 · 화이트쇼어'],
      ['coupang_rg', '21', String(SP), '펜들턴 셔파 담요 · 화이트쇼어'],
      ['coupang_wing', '12', String(SP), '펜들턴 셔파 담요 · 사바나'],
    ]);
    expect(w.filter((c) => c.sql.includes('insert into erp.listing_skus'))).toHaveLength(3);
    // 보관·비활성화·연결 삭제(정리)는 하지 않는다
    expect(w.some((c) => /^\s*(update|delete)/i.test(c.sql))).toBe(false);
    expect(f.txCount()).toBe(1);
  });

  it('리스팅·SKU가 이미 있으면 exists — 쿠팡을 부르지 않고 쓰지 않는다', async () => {
    const f = fake({ hit: [true] });
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'exists', skus: 0 });
    expect(f.calls[0].params).toEqual([String(SP), `cp:${SP}:%`]);
    expect(f.calls[0].sql).toContain('alt_product_id = $1');
    expect(f.coupang.getProductDetail).not.toHaveBeenCalled();
    expect(f.writes()).toHaveLength(0);
  });

  it('잠금을 잡은 뒤 다시 보면 이미 있다(겹친 요청) → exists, 쓰지 않는다', async () => {
    const f = fake({ hit: [false, true] });
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'exists', skus: 0 });
    expect(f.writes()).toHaveLength(0);
  });

  it('쿠팡 조회 실패 → failed, 트랜잭션을 열지 않는다', async () => {
    const f = fake();
    f.coupang.getProductDetail.mockRejectedValueOnce(new Error('[쿠팡] 상품 조회 실패: 없음'));
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'failed', skus: 0, error: '[쿠팡] 상품 조회 실패: 없음' });
    expect(f.txCount()).toBe(0);
  });

  it('쿠팡 옵션에 vid가 하나도 없으면 failed', async () => {
    const f = fake();
    f.coupang.getProductDetail.mockResolvedValueOnce({ sellerProductId: SP, sellerProductName: 'x', items: [{ itemName: '블랙' }] });
    const r = await syncSellerProduct(f.deps, SP);
    expect(r).toMatchObject({ status: 'failed', skus: 0 });
    expect(r.error).toContain('vid');
  });

  it('상품번호가 0 이하·정수가 아니면 skipped — 아무것도 부르지 않는다', async () => {
    const f = fake();
    for (const bad of [0, -5, 1.5, Number.NaN]) expect(await syncSellerProduct(f.deps, bad)).toEqual({ status: 'skipped', skus: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('원가 연결은 DB ∪ 초안 — SKU upsert가 합집합 SQL을 쓴다', async () => {
    const f = fake();
    await syncSellerProduct(f.deps, SP);
    const sku = f.writes().find((c) => c.sql.includes('insert into erp.skus'))!;
    expect(sku.sql).toContain('unnest(erp.skus.legacy_product_cost_ids || excluded.legacy_product_cost_ids)');
    expect(sku.sql).toContain("where erp.skus.origin = 'draft'");
  });

  it('조회를 그 상품번호·vid로 좁히고, 그 상품 SKU만 쓴다', async () => {
    const f = fake({ pcc: [{ product_cost_id: PC, channel_type: 'coupang_wing', external_id: '11', unit_multiplier: 1 }] });
    await syncSellerProduct(f.deps, SP);
    const keys = f.writes().filter((c) => c.sql.includes('insert into erp.skus')).map((c) => String(c.params[0]));
    expect(keys.every((k) => k.startsWith(`cp:${SP}:`))).toBe(true);
    const pcs = f.calls.find((c) => c.sql.includes('from product_costs'))!;
    expect(pcs.params).toEqual([SP, [11, 21, 12]]);
    const scoped = f.calls.filter((c) => (c.sql.includes('from product_cost_channels') && !c.sql.includes('from product_costs')) || c.sql.includes('from stock_sync_links'));
    expect(scoped.map((c) => c.params)).toEqual([[[11, 21, 12]], [[11, 21, 12]]]);
    expect(f.calls.some((c) => c.sql.includes('sale_records'))).toBe(false);
  });

  it('네이버 리스팅 — 새 것은 만들고, 이미 있는 것(다른 상품과 묶인 것)은 건드리지 않는다', async () => {
    const f = fake({
      ssl: [
        { coupang_vendor_item_id: '11', channel: 'naver', product_id: '900', option_key: '5001', label: '담요 · 화이트' },
        { coupang_vendor_item_id: '12', channel: 'naver', product_id: '901', option_key: '', label: '담요 묶음' },
      ],
      existingListings: ['naver|901|'],
    });
    expect(await syncSellerProduct(f.deps, SP)).toEqual({ status: 'created', skus: 2 });
    const ask = f.calls.find((c) => c.sql.includes('as k from erp.channel_listings'))!;
    expect(ask.params).toEqual([['naver|900|5001', 'naver|901|']]);
    const listings = f.writes()
      .filter((c) => c.sql.includes('insert into erp.channel_listings'))
      .map((c) => `${c.params[0]}|${c.params[1]}|${c.params[2]}`);
    expect(listings).toContain('naver|900|5001');
    expect(listings).not.toContain('naver|901|');
    expect(f.writes().filter((c) => c.sql.includes('insert into erp.listing_skus'))).toHaveLength(4);
  });

  it('manual SKU와 겹치면 failed', async () => {
    const r = await syncSellerProduct(fake({ skuConflict: true }).deps, SP);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('manual SKU와 겹친다');
  });

  it('planOnly — 존재 확인·잠금·쓰기 없이 그 상품 행을 돌려준다(이미 있어도)', async () => {
    const f = fake({ hit: [true] });
    const r = await syncSellerProduct(f.deps, SP, { planOnly: true });
    if (r.status !== 'planned') throw new Error(`planned 아님: ${r.status}`);
    expect(r.skus).toBe(2);
    expect(r.plan.skus.map((s) => s.key)).toEqual([`cp:${SP}:화이트쇼어`, `cp:${SP}:사바나`]);
    expect(r.plan.links.map((l) => `${l.listingKey}→${l.skuKey}×${l.multiplier}`)).toEqual([
      `coupang_wing|11|→cp:${SP}:화이트쇼어×1`,
      `coupang_rg|21|→cp:${SP}:화이트쇼어×1`,
      `coupang_wing|12|→cp:${SP}:사바나×1`,
    ]);
    expect(f.calls.some((c) => c.sql.includes('as hit') || c.sql.includes('pg_advisory'))).toBe(false);
    expect(f.writes()).toHaveLength(0);
    expect(f.txCount()).toBe(0);
  });
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/sync-product.test.ts` · Expected: FAIL(모듈 없음).

- [ ] **Step 4: 구현**

```ts
// src/lib/erp/sku/sync-product.ts
// 원가관리 상품 추가 → 그 쿠팡 상품의 SKU·리스팅·연결을 만든다(설계 docs/superpowers/specs/2026-10-10-erp-sku-auto-add-design.md).
// 키·옵션·배수·원가 연결은 전체 적재와 같은 buildDraft가 정한다. 그 상품 행만 upsert하고 보관·비활성화·연결 삭제는 하지 않는다.
// 이미 리스팅·SKU가 있는 상품은 건드리지 않는다 — 보정(sku-overrides.json)이 걸린 기존 상품은 전체 적재가 맡는다.
// 이 파일은 next/server를 끌어오지 않는다(스크립트가 import한다). 앱 연결부는 sync-app.ts.
import type { Db } from '@/lib/erp/ledger/store';
import { buildDraft, type DraftLink, type DraftListing, type DraftSku } from './draft';
import { toCoupangProduct, vidsOf, type CoupangProductInput } from './coupang-input';
import { readDraftDbInput } from './db-input';
import { insertLinks, lockSkuMaster, upsertListings, upsertSkus, validateDraft } from './upsert';

type Q = Pick<Db, 'query'>;

export type SkuSyncStatus = 'created' | 'exists' | 'failed' | 'skipped';
/** 원가관리 응답의 skuSync. skipped = 상품번호 없음(가상 ID) */
export interface SkuSync {
  status: SkuSyncStatus;
  skus: number;
  error?: string;
}
export interface SyncPlan {
  skus: DraftSku[];
  listings: DraftListing[];
  links: DraftLink[];
}
export type PlanResult =
  | { status: 'planned'; skus: number; plan: SyncPlan }
  | { status: 'skipped' | 'failed'; skus: 0; error?: string };

export interface SyncDeps {
  /** 트랜잭션 밖 읽기(존재 확인 · planOnly) */
  db: Q;
  /** 한 트랜잭션. 던지면 롤백 */
  tx: <T>(fn: (c: Q) => Promise<T>) => Promise<T>;
  coupang: { getProductDetail(sellerProductId: number): Promise<unknown> };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 그 상품번호의 리스팅(alt_product_id) 또는 SKU 키(cp:<id>:…)가 하나라도 있으면 true */
async function hasSkuRows(db: Q, sellerProductId: number): Promise<boolean> {
  const { rows } = await db.query(
    `select exists (select 1 from erp.channel_listings where alt_product_id = $1)
         or exists (select 1 from erp.skus where key like $2) as hit`,
    [String(sellerProductId), `cp:${sellerProductId}:%`],
  );
  return rows[0]?.hit === true;
}

async function fetchProduct(coupang: SyncDeps['coupang'], sellerProductId: number): Promise<CoupangProductInput> {
  const p = toCoupangProduct(await coupang.getProductDetail(sellerProductId));
  if (p.sellerProductId !== sellerProductId) throw new Error(`쿠팡 응답의 상품번호가 다르다: ${p.sellerProductId}`);
  if (vidsOf(p).length === 0) throw new Error('쿠팡 옵션에 vid가 없다(승인 전 상품일 수 있다)');
  return p;
}

/** DB 입력을 그 상품으로 좁혀 buildDraft → 그 상품의 SKU와 그 SKU에 닿는 리스팅·연결만 */
async function planFor(db: Q, product: CoupangProductInput): Promise<SyncPlan> {
  const id = product.sellerProductId;
  const rest = await readDraftDbInput(db, { sellerProductId: id, vids: vidsOf(product) });
  const d = buildDraft({ ...rest, coupangProducts: [product] });
  const prefix = `cp:${id}:`;
  const skus = d.skus.filter((s) => s.key.startsWith(prefix));
  const skuKeys = new Set(skus.map((s) => s.key));
  const touched = new Set(d.links.filter((l) => skuKeys.has(l.skuKey)).map((l) => l.listingKey));
  let listings = d.listings.filter((l) => touched.has(l.key));
  // 네이버·토스 리스팅이 이미 있으면(다른 상품과 any_of로 묶인 것 등) 건드리지 않는다 — 이 상품만 본 초안은
  // 묶음의 다른 상품을 몰라 link_mode를 잘못 덮는다. 그 경우는 전체 적재가 맡는다.
  const shared = listings.filter((l) => l.channel === 'naver' || l.channel === 'toss').map((l) => l.key);
  if (shared.length > 0) {
    const { rows } = await db.query(
      `select channel || '|' || external_product_id || '|' || external_option_key as k from erp.channel_listings
        where channel || '|' || external_product_id || '|' || external_option_key = any($1::text[])`,
      [shared],
    );
    const existing = new Set(rows.map((r) => String(r.k)));
    listings = listings.filter((l) => !existing.has(l.key));
  }
  const keep = new Set(listings.map((l) => l.key));
  const links = d.links.filter((l) => keep.has(l.listingKey) && skuKeys.has(l.skuKey));
  return { skus, listings, links };
}

/**
 * 쿠팡 상품 하나 → SKU·리스팅·연결. 던지지 않는다(실패는 status 'failed').
 * planOnly: 존재 확인·잠금·쓰기 없이 만들 행만 돌려준다(운영 대조용 — scripts/erp/sku-sync-compare.ts).
 */
export async function syncSellerProduct(deps: SyncDeps, sellerProductId: number, opts: { planOnly: true }): Promise<PlanResult>;
export async function syncSellerProduct(deps: SyncDeps, sellerProductId: number, opts?: { planOnly?: false }): Promise<SkuSync>;
export async function syncSellerProduct(
  deps: SyncDeps,
  sellerProductId: number,
  opts: { planOnly?: boolean } = {},
): Promise<SkuSync | PlanResult> {
  if (!Number.isInteger(sellerProductId) || sellerProductId <= 0) return { status: 'skipped', skus: 0 };
  try {
    if (opts.planOnly) {
      const product = await fetchProduct(deps.coupang, sellerProductId);
      const plan = await planFor(deps.db, product);
      return { status: 'planned', skus: plan.skus.length, plan };
    }
    if (await hasSkuRows(deps.db, sellerProductId)) return { status: 'exists', skus: 0 };
    const product = await fetchProduct(deps.coupang, sellerProductId);
    return await deps.tx(async (c): Promise<SkuSync> => {
      await lockSkuMaster(c);
      // 쿠팡을 기다리는 사이 다른 요청(bulk · SKU 다시 맞추기 · 전체 적재)이 먼저 만들었을 수 있다
      if (await hasSkuRows(c, sellerProductId)) return { status: 'exists', skus: 0 };
      const plan = await planFor(c, product);
      validateDraft(plan);
      const skuId = await upsertSkus(c, plan.skus);
      const listingId = await upsertListings(c, plan.listings);
      await insertLinks(c, plan.links, skuId, listingId);
      return { status: 'created', skus: plan.skus.length };
    });
  } catch (e) {
    return { status: 'failed', skus: 0, error: errMsg(e) };
  }
}
```

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/sync-product.test.ts` · Expected: PASS(11). Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/erp/sku/sync-product.ts src/__tests__/lib/erp/sku/sync-fake.ts src/__tests__/lib/erp/sku/sync-product.test.ts
git commit -m "feat(erp): syncSellerProduct — 쿠팡 상품 하나를 SKU·리스팅·연결로(그 상품만 · 원가 연결 보존 · planOnly)"
```

---

### Task 6: `syncMissing` — 빠진 상품 최대 20개

**Files:**
- Modify: `src/lib/erp/sku/sync-product.ts`(끝에 추가)
- Test: `src/__tests__/lib/erp/sku/sync-missing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — Task 5의 `sync-fake.ts`를 쓴다.

```ts
// src/__tests__/lib/erp/sku/sync-missing.test.ts
import { describe, it, expect } from 'vitest';
import { syncMissing, SYNC_MISSING_CAP } from '@/lib/erp/sku/sync-product';
import { detail, fake } from './sync-fake';

describe('syncMissing', () => {
  it('리스팅 없는 상품을 최신순으로 받아 상한까지 돌리고, 넘으면 more', async () => {
    const f = fake({ missing: [{ id: '300', name: 'C' }, { id: '200', name: 'B' }, { id: '100', name: 'A' }] });
    f.coupang.getProductDetail.mockImplementation(async (sid: number) => {
      if (sid === 200) throw new Error('[쿠팡] 상품 조회 실패: 없음');
      return detail(sid);
    });
    const r = await syncMissing(f.deps, 2);
    const ask = f.calls.find((c) => c.sql.includes('order by at desc'))!;
    expect(ask.params).toEqual([3]);
    expect(ask.sql).toContain('pc.seller_product_id > 0');
    expect(ask.sql).toContain('not exists (select 1 from erp.channel_listings l where l.alt_product_id = pc.seller_product_id::text)');
    expect(ask.sql).toContain("not exists (select 1 from erp.skus s where s.key like 'cp:' || pc.seller_product_id || ':%')");
    expect(r.results.map((x) => [x.sellerProductId, x.productName, x.status])).toEqual([[300, 'C', 'created'], [200, 'B', 'failed']]);
    expect(r.results[1].error).toBe('[쿠팡] 상품 조회 실패: 없음');
    expect(r).toMatchObject({ created: 1, exists: 0, failed: 1, skus: 2, more: true });
    expect(f.coupang.getProductDetail).not.toHaveBeenCalledWith(100);
  });

  it('기본 상한은 20', async () => {
    expect(SYNC_MISSING_CAP).toBe(20);
    const f = fake();
    await syncMissing(f.deps);
    expect(f.calls[0].params).toEqual([21]);
  });

  it('빠진 상품이 없으면 빈 결과', async () => {
    expect(await syncMissing(fake().deps)).toEqual({ results: [], created: 0, exists: 0, failed: 0, skus: 0, more: false });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/sync-missing.test.ts` · Expected: FAIL(`syncMissing` 없음).

- [ ] **Step 3: 구현** — `sync-product.ts` 끝에 붙인다.

```ts
/** 「SKU 다시 맞추기」 한 번에 도는 상품 수 — 쿠팡 상세 조회를 순서대로 부르므로 함수 시간(300초) 안에 든다 */
export const SYNC_MISSING_CAP = 20;

export interface SyncMissingRow extends SkuSync {
  sellerProductId: number;
  productName: string;
}
export interface SyncMissingResult {
  results: SyncMissingRow[];
  /** status 'created'인 상품 수 */
  created: number;
  exists: number;
  failed: number;
  /** 새로 만든 SKU 수 */
  skus: number;
  /** 상한을 넘어 남은 상품이 있다 */
  more: boolean;
}

/** 원가관리에 쿠팡 상품번호가 있는데 리스팅·SKU가 없는 상품(최근 추가 순)을 상한까지 syncSellerProduct */
export async function syncMissing(deps: SyncDeps, cap = SYNC_MISSING_CAP): Promise<SyncMissingResult> {
  const { rows } = await deps.db.query(
    `select pc.seller_product_id as id, max(pc.product_name) as name, max(pc.created_at) as at
       from product_costs pc
      where pc.seller_product_id > 0
        and not exists (select 1 from erp.channel_listings l where l.alt_product_id = pc.seller_product_id::text)
        and not exists (select 1 from erp.skus s where s.key like 'cp:' || pc.seller_product_id || ':%')
      group by pc.seller_product_id
      order by at desc, id desc
      limit $1`,
    [cap + 1],
  );
  const results: SyncMissingRow[] = [];
  for (const row of rows.slice(0, cap)) {
    const sellerProductId = Number(row.id);
    const r = await syncSellerProduct(deps, sellerProductId);
    results.push({ sellerProductId, productName: String(row.name ?? ''), ...r });
  }
  const count = (s: SkuSyncStatus) => results.filter((x) => x.status === s).length;
  return {
    results,
    created: count('created'),
    exists: count('exists'),
    failed: count('failed'),
    skus: results.filter((x) => x.status === 'created').reduce((s, x) => s + x.skus, 0),
    more: rows.length > cap,
  };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/` · Expected: PASS(Task 5의 11개 포함).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/sku/sync-product.ts src/__tests__/lib/erp/sku/sync-missing.test.ts
git commit -m "feat(erp): syncMissing — 리스팅 없는 원가관리 상품을 최신순 20개까지 SKU로"
```

---

### Task 7: `sync-app.ts` · `sync-message.ts`

**Files:**
- Create: `src/lib/erp/sku/sync-app.ts`
- Create: `src/lib/erp/sku/sync-message.ts`
- Test: `src/__tests__/lib/erp/sku/sync-message.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/erp/sku/sync-message.test.ts
import { describe, it, expect } from 'vitest';
import { formatSyncMissing, summarizeSkuSync } from '@/lib/erp/sku/sync-message';

describe('summarizeSkuSync', () => {
  it('하나 실패 — 설계의 문구 그대로', () => {
    expect(summarizeSkuSync([{ status: 'failed', skus: 0, error: 'x' }])).toEqual({
      kind: 'error', message: 'SKU 자동 추가 실패 — 재고현황의 「SKU 다시 맞추기」로 다시 시도',
    });
  });
  it('여럿 — 추가 수와 실패 건수', () => {
    expect(summarizeSkuSync([
      { status: 'created', skus: 2 }, { status: 'created', skus: 1 },
      { status: 'failed', skus: 0 }, { status: 'failed', skus: 0 }, { status: 'exists', skus: 0 },
    ])).toEqual({ kind: 'error', message: 'SKU 3개 추가 · SKU 자동 추가 실패 2건 — 재고현황의 「SKU 다시 맞추기」로 다시 시도' });
  });
  it('추가만 — 성공', () => {
    expect(summarizeSkuSync([{ status: 'created', skus: 2 }])).toEqual({ kind: 'success', message: 'SKU 2개 자동 추가' });
  });
  it('이미 있음·건너뜀·없음은 말하지 않는다', () => {
    expect(summarizeSkuSync([{ status: 'exists', skus: 0 }, { status: 'skipped', skus: 0 }, undefined, null])).toBeNull();
    expect(summarizeSkuSync([])).toBeNull();
  });
});

describe('formatSyncMissing', () => {
  const row = (sellerProductId: number, status: 'created' | 'exists' | 'failed', skus = 0) => ({ sellerProductId, productName: 'p', status, skus });
  it('추가 · 이미 있음 · 실패(상품번호)', () => {
    expect(formatSyncMissing({
      results: [row(300, 'created', 2), row(200, 'failed'), row(100, 'failed'), row(50, 'exists')],
      created: 1, exists: 1, failed: 2, skus: 2, more: false,
    })).toBe('SKU 2개 추가 · 이미 있음 1 · 실패 2(200, 100)');
  });
  it('남은 상품이 있으면 한 번 더', () => {
    expect(formatSyncMissing({ results: [row(1, 'created', 1)], created: 1, exists: 0, failed: 0, skus: 1, more: true }))
      .toBe('SKU 1개 추가 · 이미 있음 0 · 실패 0 · 남은 상품이 있다 — 한 번 더 누른다');
  });
  it('빠진 상품 없음', () => {
    expect(formatSyncMissing({ results: [], created: 0, exists: 0, failed: 0, skus: 0, more: false }))
      .toBe('빠진 상품 없음 — 원가관리의 쿠팡 상품이 모두 SKU에 있다');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/sync-message.test.ts` · Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현**

```ts
// src/lib/erp/sku/sync-message.ts
// SKU 자동 추가 결과 → 화면 문구(원가관리 추가 토스트 · 재고현황 「SKU 다시 맞추기」 결과 줄). 화면에서 import한다 — 타입만 가져온다.
import type { SkuSync, SyncMissingResult } from './sync-product';

export const SKU_SYNC_RETRY_HINT = '재고현황의 「SKU 다시 맞추기」로 다시 시도';

/** 원가관리 저장 응답의 skuSync(한 개 또는 bulk 여러 개) → 토스트 하나. 말할 것이 없으면 null(이미 있음·상품번호 없음) */
export function summarizeSkuSync(list: (SkuSync | null | undefined)[]): { kind: 'success' | 'error'; message: string } | null {
  const xs = list.filter((x): x is SkuSync => !!x);
  const skus = xs.filter((x) => x.status === 'created').reduce((s, x) => s + x.skus, 0);
  const failed = xs.filter((x) => x.status === 'failed').length;
  if (failed > 0) {
    return {
      kind: 'error',
      message: `${skus > 0 ? `SKU ${skus}개 추가 · ` : ''}SKU 자동 추가 실패${failed > 1 ? ` ${failed}건` : ''} — ${SKU_SYNC_RETRY_HINT}`,
    };
  }
  if (skus > 0) return { kind: 'success', message: `SKU ${skus}개 자동 추가` };
  return null;
}

/** 「SKU 다시 맞추기」 결과 한 줄 — 「SKU N개 추가 · 이미 있음 N · 실패 N(상품번호…)」 */
export function formatSyncMissing(r: SyncMissingResult): string {
  if (r.results.length === 0) return '빠진 상품 없음 — 원가관리의 쿠팡 상품이 모두 SKU에 있다';
  const failedIds = r.results.filter((x) => x.status === 'failed').map((x) => x.sellerProductId);
  return `SKU ${r.skus}개 추가 · 이미 있음 ${r.exists} · 실패 ${r.failed}${failedIds.length ? `(${failedIds.join(', ')})` : ''}${r.more ? ' · 남은 상품이 있다 — 한 번 더 누른다' : ''}`;
}
```

```ts
// src/lib/erp/sku/sync-app.ts
// 앱(API 라우트)에서 SKU 자동 추가를 부르는 곳 — 풀·트랜잭션·쿠팡 클라이언트를 붙인다. syncForApp은 던지지 않는다.
import { getSourcingPool } from '@/lib/sourcing/db';
import { withTx } from '@/lib/erp/stock/http';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { syncMissing, syncSellerProduct, type SkuSync, type SyncDeps, type SyncMissingResult } from './sync-product';

const appDeps = (): SyncDeps => ({ db: getSourcingPool(), tx: withTx, coupang: getCoupangClient() });

export async function syncForApp(sellerProductId: number): Promise<SkuSync> {
  if (!Number.isInteger(sellerProductId) || sellerProductId <= 0) return { status: 'skipped', skus: 0 };
  try {
    return await syncSellerProduct(appDeps(), sellerProductId);
  } catch (e) {
    // 쿠팡 키가 없으면 getCoupangClient가 던진다 — 원가관리 저장은 이미 끝났으므로 실패로만 알린다
    return { status: 'failed', skus: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export const syncMissingForApp = (): Promise<SyncMissingResult> => syncMissing(appDeps());
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/lib/erp/sku/sync-message.test.ts` · Expected: PASS(7). Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: `0`(`tx: withTx` 대입이 타입을 통과해야 한다 — `PoolClient`는 `Db`의 `query`를 만족한다. 다른 ERP 라우트도 `withTx((c) => commitOpeningImport(c, …))`로 같은 대입을 한다).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/sku/sync-app.ts src/lib/erp/sku/sync-message.ts src/__tests__/lib/erp/sku/sync-message.test.ts
git commit -m "feat(erp): SKU 자동 추가 앱 연결부 · 화면 문구"
```

---

### Task 8: 원가관리 라우트 두 개 — 저장 뒤 `skuSync`

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`(import 블록 · POST의 `INSERT` 뒤 `return`)
- Modify: `src/app/api/cost-management/products/bulk/route.ts`(import · `created` 타입 · 루프 뒤 · 응답)
- Test: `src/__tests__/api/cost-management-products-sku-sync.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/api/cost-management-products-sku-sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockSync } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockSync: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/sku/sync-app', () => ({ syncForApp: mockSync, syncMissingForApp: vi.fn() }));

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let query: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO product_costs')) {
      const sp = params[2];
      return { rows: [{ id: `pc-${String(sp)}`, product_name: params[1], seller_product_id: sp === null ? null : String(sp) }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  mockGetPool.mockReturnValue({ query });
  mockSync.mockResolvedValue({ status: 'created', skus: 2 });
});

describe('POST /api/cost-management/products — skuSync', () => {
  it('상품번호가 있으면 저장 뒤 SKU를 만들고 skuSync를 싣는다', async () => {
    const { POST } = await import('@/app/api/cost-management/products/route');
    const res = await POST(post('/api/cost-management/products', { product_name: '담요', seller_product_id: 16404126884 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.id).toBe('pc-16404126884');
    expect(json.skuSync).toEqual({ status: 'created', skus: 2 });
    expect(mockSync).toHaveBeenCalledWith(16404126884);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(mockSync.mock.invocationCallOrder[0]);
  });

  it('SKU 추가가 던져도 201 · 저장됨 · skuSync.failed', async () => {
    mockSync.mockRejectedValueOnce(new Error('쿠팡 키 없음'));
    const { POST } = await import('@/app/api/cost-management/products/route');
    const res = await POST(post('/api/cost-management/products', { product_name: '담요', seller_product_id: 16404126884 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('pc-16404126884');
    expect(json.skuSync).toEqual({ status: 'failed', skus: 0, error: '쿠팡 키 없음' });
  });

  it('상품번호가 없으면 skipped — 부르지 않는다', async () => {
    const { POST } = await import('@/app/api/cost-management/products/route');
    const json = await (await POST(post('/api/cost-management/products', { product_name: '소분 원재료' }))).json();
    expect(json.skuSync).toEqual({ status: 'skipped', skus: 0 });
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe('POST /api/cost-management/products/bulk — skuSync', () => {
  it('상품별 결과 · 한 건 실패가 등록 수에 영향 없다', async () => {
    mockSync.mockResolvedValueOnce({ status: 'created', skus: 1 }).mockResolvedValueOnce({ status: 'failed', skus: 0, error: '없음' });
    const { POST } = await import('@/app/api/cost-management/products/bulk/route');
    const res = await POST(post('/api/cost-management/products/bulk', { items: [
      { product_name: 'A', seller_product_id: 101 },
      { product_name: 'B', seller_product_id: 102 },
    ] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.created_count).toBe(2);
    expect(json.data.skuSync).toEqual([
      { seller_product_id: 101, product_name: 'A', status: 'created', skus: 1 },
      { seller_product_id: 102, product_name: 'B', status: 'failed', skus: 0, error: '없음' },
    ]);
  });

  it('한 요청에서 20개까지만 — 넘는 상품은 failed로 「SKU 다시 맞추기」 안내', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ product_name: `P${i}`, seller_product_id: 1000 + i }));
    const { POST } = await import('@/app/api/cost-management/products/bulk/route');
    const json = await (await POST(post('/api/cost-management/products/bulk', { items }))).json();
    expect(mockSync).toHaveBeenCalledTimes(20);
    expect(json.data.skuSync).toHaveLength(21);
    expect(json.data.skuSync[20]).toMatchObject({ seller_product_id: 1020, status: 'failed', skus: 0 });
    expect(json.data.skuSync[20].error).toContain('SKU 다시 맞추기');
  });

  it('SKU 추가가 던져도 그 상품만 failed', async () => {
    mockSync.mockRejectedValueOnce(new Error('boom'));
    const { POST } = await import('@/app/api/cost-management/products/bulk/route');
    const json = await (await POST(post('/api/cost-management/products/bulk', { items: [{ product_name: 'A', seller_product_id: 101 }] }))).json();
    expect(json.data.created_count).toBe(1);
    expect(json.data.skuSync[0]).toEqual({ seller_product_id: 101, product_name: 'A', status: 'failed', skus: 0, error: 'boom' });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/api/cost-management-products-sku-sync.test.ts` · Expected: FAIL(`skuSync` 없음).

- [ ] **Step 3: 단건 라우트** — `src/app/api/cost-management/products/route.ts` 맨 위 import 끝에 더한다.

```ts
import { syncForApp } from '@/lib/erp/sku/sync-app';
import type { SkuSync } from '@/lib/erp/sku/sync-product';

// POST가 저장 뒤 쿠팡 상품 상세를 한 번 읽는다(SKU 자동 추가)
export const maxDuration = 60;
```

POST 안 `return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });` 한 줄을 아래로 바꾼다.

```ts
    const saved = rows[0];
    // 저장(INSERT 자동 커밋)이 끝난 뒤 SKU를 만든다 — 실패해도 원가관리 저장은 성공이다(설계 §1)
    const sellerProductId = Number(saved.seller_product_id);
    let skuSync: SkuSync = { status: 'skipped', skus: 0 };
    if (sellerProductId > 0) {
      try {
        skuSync = await syncForApp(sellerProductId);
      } catch (e) {
        skuSync = { status: 'failed', skus: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }
    return NextResponse.json({ success: true, data: saved, skuSync }, { status: 201 });
```

- [ ] **Step 4: bulk 라우트** — `src/app/api/cost-management/products/bulk/route.ts`.

import 끝에 더한다:
```ts
import { syncForApp } from '@/lib/erp/sku/sync-app';
import { SYNC_MISSING_CAP, type SkuSync } from '@/lib/erp/sku/sync-product';

// 저장 뒤 상품마다 쿠팡 상품 상세를 읽는다(SKU 자동 추가, 최대 SYNC_MISSING_CAP개)
export const maxDuration = 300;

const OVER_CAP = `한 번에 ${SYNC_MISSING_CAP}개까지 자동 추가 — 재고현황의 「SKU 다시 맞추기」로 채운다`;

type BulkSkuSync = SkuSync & { seller_product_id: number | null; product_name: string };
```

`const created: unknown[] = [];`를 아래로 바꾼다:
```ts
    const created: ({ seller_product_id: number | string | null; product_name: string } & Record<string, unknown>)[] = [];
```

`for (const raw of items as BulkItem[]) { … }` 루프가 끝난 바로 뒤(응답 `return NextResponse.json(` 앞)에 넣는다:
```ts
    // 저장(건별 INSERT 자동 커밋)이 끝난 뒤 상품마다 SKU를 만든다 — 실패해도 등록은 그대로다(설계 §1)
    const skuSync: BulkSkuSync[] = [];
    let budget = SYNC_MISSING_CAP;
    for (const row of created) {
      const id = row.seller_product_id === null ? null : Number(row.seller_product_id);
      const base = { seller_product_id: id, product_name: String(row.product_name) };
      if (id === null || !(id > 0)) {
        skuSync.push({ ...base, status: 'skipped', skus: 0 });
        continue;
      }
      if (budget <= 0) {
        skuSync.push({ ...base, status: 'failed', skus: 0, error: OVER_CAP });
        continue;
      }
      budget--;
      try {
        skuSync.push({ ...base, ...(await syncForApp(id)) });
      } catch (e) {
        skuSync.push({ ...base, status: 'failed', skus: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }
```

응답의 `data`에 `skuSync`를 더한다:
```ts
        data: { created, skipped, created_count: created.length, skipped_count: skipped.length, skuSync },
```

머리 주석(`/** POST /api/cost-management/products/bulk … */`)의 세 가지 목록 아래에 한 줄을 더한다:
```ts
 *  4) 저장이 끝난 뒤 쿠팡 상품번호가 있는 상품을 SKU로 만든다(data.skuSync, 상품별 · 최대 20개).
```

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run src/__tests__/api/cost-management-products-sku-sync.test.ts` · Expected: PASS(6). Run: `npx vitest run src/__tests__/api/cost-management src/__tests__/api/product-cost-channels-crud.test.ts` · Expected: 기존 원가관리 라우트 테스트도 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cost-management/products/route.ts src/app/api/cost-management/products/bulk/route.ts src/__tests__/api/cost-management-products-sku-sync.test.ts
git commit -m "feat(erp): 원가관리 상품 추가 → 저장 뒤 SKU 자동 추가(skuSync · 실패해도 저장 성공)"
```

---

### Task 9: 원가관리 화면 토스트

**Files:**
- Modify: `src/components/orders/BulkAddProductModal.tsx:5`(import) · `:303-310`(결과 처리)
- Modify: `src/components/orders/AddProductModal.tsx:5`(import) · `:84-88`(성공 처리)

- [ ] **Step 1: `BulkAddProductModal.tsx`** — import 줄 `import { toast } from '@/components/ui/toast';` 아래에 더한다.

```ts
import { summarizeSkuSync } from '@/lib/erp/sku/sync-message';
import type { SkuSync } from '@/lib/erp/sku/sync-product';
```

`if (created_count > 0) toast.success(\`${created_count}건을 원가관리에 추가했습니다.\`);` 바로 아래에 넣는다.

```ts
      // 저장 뒤 서버가 SKU를 만든 결과 — 실패만 남기면 재고현황에서 다시 맞출 수 있다
      const sync = summarizeSkuSync(((json.data as { skuSync?: SkuSync[] }).skuSync) ?? []);
      if (sync) toast[sync.kind](sync.message);
```

- [ ] **Step 2: `AddProductModal.tsx`** — 같은 import 두 줄을 더하고, `if (json.success) {` 블록의 `clearDraftNow();` 바로 아래에 넣는다.

```ts
        // 이 창은 상품번호를 보내지 않아 보통 skipped(말하지 않는다) — 응답 규격이 같으므로 같은 처리를 둔다
        const sync = summarizeSkuSync([json.skuSync as SkuSync | undefined]);
        if (sync) toast[sync.kind](sync.message);
```

- [ ] **Step 3: 검사** — Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: `0`. Run: `npx vitest run src/__tests__/lib/erp/sku/sync-message.test.ts` · Expected: PASS(이 두 모달 전용 테스트는 없다 — 문구는 `sync-message.test.ts`가 검사한다).

- [ ] **Step 4: Commit**

```bash
git add src/components/orders/BulkAddProductModal.tsx src/components/orders/AddProductModal.tsx
git commit -m "feat(erp): 원가관리 상품 추가 화면 — SKU 자동 추가 결과 토스트"
```

---

### Task 10: `POST /api/erp/skus/sync-missing`

**Files:**
- Create: `src/app/api/erp/skus/sync-missing/route.ts`
- Test: `src/__tests__/api/erp-skus-sync-missing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/api/erp-skus-sync-missing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockMissing } = vi.hoisted(() => ({ mockGetCurrentUser: vi.fn(), mockMissing: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));
vi.mock('@/lib/erp/sku/sync-app', () => ({ syncMissingForApp: mockMissing, syncForApp: vi.fn() }));

const req = () => new NextRequest('http://localhost/api/erp/skus/sync-missing', { method: 'POST', body: '{}' });
const RESULT = {
  results: [{ sellerProductId: 300, productName: 'C', status: 'created', skus: 2 }],
  created: 1, exists: 0, failed: 0, skus: 2, more: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  mockMissing.mockResolvedValue(RESULT);
});

describe('POST /api/erp/skus/sync-missing', () => {
  it('로그인하지 않으면 401 — 돌리지 않는다', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/skus/sync-missing/route');
    expect((await POST(req())).status).toBe(401);
    expect(mockMissing).not.toHaveBeenCalled();
  });

  it('결과를 돌려준다', async () => {
    const { POST } = await import('@/app/api/erp/skus/sync-missing/route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: RESULT });
  });

  it('후보 조회가 던지면 500 server', async () => {
    mockMissing.mockRejectedValueOnce(new Error('db down'));
    const { POST } = await import('@/app/api/erp/skus/sync-missing/route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('server');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/api/erp-skus-sync-missing.test.ts` · Expected: FAIL(라우트 없음).

- [ ] **Step 3: 구현**

```ts
// src/app/api/erp/skus/sync-missing/route.ts
// POST /api/erp/skus/sync-missing — 원가관리에 쿠팡 상품번호가 있는데 리스팅·SKU가 없는 상품을 SKU로 만든다(최신순, 한 번에 20개).
// 재고현황 「SKU 다시 맞추기」 버튼. 상품별 실패는 결과에 담기고(200), 후보 조회 자체가 실패하면 500.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { syncMissingForApp } from '@/lib/erp/sku/sync-app';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await syncMissingForApp() });
  } catch (e) {
    return erpError(e);
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/api/erp-skus-sync-missing.test.ts` · Expected: PASS(3).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/erp/skus/sync-missing/route.ts src/__tests__/api/erp-skus-sync-missing.test.ts
git commit -m "feat(erp): POST /api/erp/skus/sync-missing — 빠진 원가관리 상품을 SKU로(20개)"
```

---

### Task 11: 재고현황 「SKU 다시 맞추기」 버튼

**Files:**
- Create: `src/components/erp/stock/SkuSyncButton.tsx`
- Modify: `src/components/erp/stock/api.ts`(import · 끝에 함수)
- Modify: `src/components/erp/stock/StockClient.tsx`(import · 툴바)
- Test: `src/__tests__/components/erp-sku-sync-button.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// src/__tests__/components/erp-sku-sync-button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import SkuSyncButton from '@/components/erp/stock/SkuSyncButton';
import { server } from '../mocks/server';

const data = (o: Record<string, unknown>) => ({ results: [], created: 0, exists: 0, failed: 0, skus: 0, more: false, ...o });

describe('SkuSyncButton', () => {
  it('누르면 빠진 상품을 맞추고 결과를 한 줄로 보인다 · 추가가 있으면 onDone', async () => {
    let calls = 0;
    server.use(http.post('/api/erp/skus/sync-missing', () => {
      calls++;
      return HttpResponse.json({ success: true, data: data({
        results: [
          { sellerProductId: 300, productName: 'C', status: 'created', skus: 2 },
          { sellerProductId: 200, productName: 'B', status: 'failed', skus: 0, error: '없음' },
        ],
        created: 1, failed: 1, skus: 2,
      }) });
    }));
    const onDone = vi.fn();
    render(<SkuSyncButton onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /SKU 다시 맞추기/ }));
    expect(await screen.findByText('SKU 2개 추가 · 이미 있음 0 · 실패 1(200)')).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('빠진 상품이 없으면 그렇게 말하고 onDone을 부르지 않는다', async () => {
    server.use(http.post('/api/erp/skus/sync-missing', () => HttpResponse.json({ success: true, data: data({}) })));
    const onDone = vi.fn();
    render(<SkuSyncButton onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /SKU 다시 맞추기/ }));
    expect(await screen.findByText(/빠진 상품 없음/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('서버 오류 — 결과 줄 없이 버튼을 다시 누를 수 있다', async () => {
    server.use(http.post('/api/erp/skus/sync-missing', () => HttpResponse.json({ success: false, code: 'server', error: '서버 오류' }, { status: 500 })));
    render(<SkuSyncButton onDone={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /SKU 다시 맞추기/ });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(screen.getByRole('button', { name: /SKU 다시 맞추기/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/components/erp-sku-sync-button.test.tsx` · Expected: FAIL(모듈 없음).

- [ ] **Step 3: `api.ts`** — import 블록 끝(`import type { RgAutoLast } …` 아래)에 더한다.

```ts
import type { SyncMissingResult } from '@/lib/erp/sku/sync-product';
```

파일 끝에 더한다.

```ts
// 원가관리에 있는데 SKU가 없는 쿠팡 상품을 SKU로(한 번에 20개)
export const postSkuSyncMissing = () => call<SyncMissingResult>('/api/erp/skus/sync-missing', {});
```

- [ ] **Step 4: `SkuSyncButton.tsx`**

```tsx
// src/components/erp/stock/SkuSyncButton.tsx
'use client';

/**
 * 재고현황 「SKU 다시 맞추기」 — 원가관리에 쿠팡 상품번호가 있는데 SKU가 없는 상품을 SKU로 만든다(한 번에 20개).
 * 원가관리 추가 때 자동 추가가 실패한 상품을 채우는 곳이다. 지우거나 고치지 않으므로 확인 창을 띄우지 않는다.
 */
import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { btnStyle, disabledBtnStyle } from '@/components/orders/erp-ui';
import { formatSyncMissing } from '@/lib/erp/sku/sync-message';
import { postSkuSyncMissing } from './api';

export default function SkuSyncButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    const r = await postSkuSyncMissing();
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    const msg = formatSyncMissing(r.data);
    setLast(msg);
    if (r.data.failed > 0) toast.error(msg);
    else toast.success(msg);
    if (r.data.created > 0) onDone();
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        style={busy ? disabledBtnStyle : btnStyle}
        title="원가관리에 쿠팡 상품번호가 있는데 SKU가 없는 상품을 SKU로 만든다(한 번에 20개)"
      >
        <Package size={12} /> {busy ? 'SKU 맞추는 중…' : 'SKU 다시 맞추기'}
      </button>
      {last && <span role="status" style={{ fontSize: 11.5, color: E.inkSub }}>{last}</span>}
    </>
  );
}
```

- [ ] **Step 5: `StockClient.tsx`** — import 블록의 `import RgAutoPanel from './RgAutoPanel';` 아래에 `import SkuSyncButton from './SkuSyncButton';`를 더하고, 툴바의 엑셀 버튼 줄

```tsx
        <button type="button" onClick={exportCsv} style={btnStyle}><Download size={12} /> 엑셀↓</button>
```

바로 아래에 넣는다.

```tsx
        <SkuSyncButton onDone={() => void load()} />
```

- [ ] **Step 6: 통과 확인** — Run: `npx vitest run src/__tests__/components/erp-sku-sync-button.test.tsx src/__tests__/components/erp-stock-table.test.tsx src/__tests__/components/erp-stock-view.test.ts` · Expected: PASS. Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add src/components/erp/stock/SkuSyncButton.tsx src/components/erp/stock/api.ts src/components/erp/stock/StockClient.tsx src/__tests__/components/erp-sku-sync-button.test.tsx
git commit -m "feat(erp): 재고현황 「SKU 다시 맞추기」 버튼"
```

---

### Task 12: 운영 대조 — 10-10 상품 4개(읽기 전용)

**Files:**
- Create: `scripts/erp/sku-sync-compare.ts`

**무엇을 보는가:** 2026-10-10 원가관리에 추가한 상품 4개는 전체 적재(`sku-apply --apply`)로 이미 SKU가 됐다(2026-10-10 읽기 전용 확인: SKU id 1071~1075, 리스팅 id 2042~2046, 모두 `coupang_wing` · `single` · 배수 1 · 원가 연결 각 1개). `syncSellerProduct`의 계획 단계(`planOnly`)가 같은 행을 만들어야 한다 — 다르면 자동 추가가 전체 적재와 다른 SKU를 만든다는 뜻이다.

| 상품번호 | DB SKU(키) | DB 리스팅(vid) |
|---|---|---|
| 16405441934 | 1071 `cp:16405441934:1500ml` | 2042 wing 96152866376 |
| 16405396513 | 1072 `cp:16405396513:레드그레이화이트 / 높이 23.6~33cm` | 2043 wing 96152752056 |
| 16404126884 | 1073 `…:화이트쇼어(앤틱화이트) 127x178cm` · 1074 `…:사바나스트라이프(아이보리) 127x178cm` | 2044 wing 96148192261 · 2045 wing 96148192260 |
| 16399766529 | 1075 `cp:16399766529:35정` | 2046 wing 96160716838 |

- [ ] **Step 1: 스크립트 작성**

```ts
// scripts/erp/sku-sync-compare.ts
// 사용법: npx --no-install tsx scripts/erp/sku-sync-compare.ts [상품번호…]
// 읽기 전용 대조: syncSellerProduct의 계획 단계(planOnly — 존재 확인·잠금·쓰기 없음)가 만들 행과
// 지금 DB의 행(전체 적재가 만든 것)이 같은지 본다. DB는 BEGIN READ ONLY로만 읽고(끝에 ROLLBACK), 쿠팡은 상품 상세 GET만.
// 기본 대상 = 2026-10-10 원가관리에 추가한 4개. 계획은 이미 DB에 있는 네이버·토스 리스팅을 빼므로(설계상 건드리지 않는다),
// 네이버·토스 리스팅이 붙은 상품에서는 「DB에만」 줄이 나오는 것이 정상이다.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { syncSellerProduct } from '@/lib/erp/sku/sync-product';
import { getCoupangClient } from '@/lib/listing/coupang-client';

loadEnvLocal();
const DEFAULT_IDS = [16405441934, 16405396513, 16404126884, 16399766529];
const argIds = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const targets = argIds.length > 0 ? argIds : DEFAULT_IDS;

function diffSets(label: string, plan: string[], db: string[]): string[] {
  const a = new Set(plan);
  const b = new Set(db);
  return [
    ...[...a].filter((x) => !b.has(x)).map((x) => `${label} 계획에만: ${x}`),
    ...[...b].filter((x) => !a.has(x)).map((x) => `${label} DB에만: ${x}`),
  ];
}

(async () => {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const coupang = getCoupangClient();
  let bad = 0;
  try {
    await c.query('BEGIN READ ONLY');
    for (const id of targets) {
      const r = await syncSellerProduct(
        { db: c, tx: async () => { throw new Error('읽기 전용 대조 — 쓰지 않는다'); }, coupang },
        id,
        { planOnly: true },
      );
      if (r.status !== 'planned') {
        bad++;
        console.log(`❌ ${id} 계획 실패: ${r.status} ${r.error ?? ''}`);
        continue;
      }
      const like = `cp:${id}:%`;
      const skus = (await c.query(
        `select key, name, option_label, status, legacy_product_cost_ids::text[] as legacy from erp.skus where key like $1`,
        [like],
      )).rows;
      const links = (await c.query(
        `select l.channel || '|' || l.external_product_id || '|' || l.external_option_key as lkey,
                l.alt_product_id, l.label, l.link_mode, s.key as skey, x.multiplier
           from erp.listing_skus x join erp.channel_listings l on l.id = x.listing_id join erp.skus s on s.id = x.sku_id
          where s.key like $1`,
        [like],
      )).rows;
      const out: string[] = [];
      out.push(...diffSets(
        'SKU',
        r.plan.skus.map((s) => `${s.key} | ${s.name} | ${s.optionLabel} | ${s.status}`),
        skus.map((s) => `${s.key} | ${s.name} | ${s.option_label} | ${s.status}`),
      ));
      for (const s of r.plan.skus) {
        const row = skus.find((x) => x.key === s.key);
        const missing = row ? s.legacyProductCostIds.filter((x) => !((row.legacy ?? []) as string[]).includes(x)) : [];
        if (missing.length > 0) out.push(`원가 연결 계획에만: ${s.key} → ${missing.join(',')}`);
      }
      out.push(...diffSets(
        '리스팅',
        r.plan.listings.map((l) => `${l.key} | ${l.altProductId} | ${l.label} | ${l.linkMode}`),
        [...new Set(links.map((l) => `${l.lkey} | ${l.alt_product_id} | ${l.label} | ${l.link_mode}`))],
      ));
      out.push(...diffSets(
        '연결',
        r.plan.links.map((k) => `${k.listingKey}→${k.skuKey}×${k.multiplier}`),
        links.map((l) => `${l.lkey}→${l.skey}×${l.multiplier}`),
      ));
      if (out.length > 0) {
        bad++;
        console.log(`❌ ${id} 다름 ${out.length}건`);
        for (const x of out) console.log(`   ${x}`);
      } else {
        console.log(`✅ ${id} SKU ${r.plan.skus.length} · 리스팅 ${r.plan.listings.length} · 연결 ${r.plan.links.length} — DB와 같다`);
      }
    }
    await c.query('ROLLBACK');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
  console.log(bad > 0 ? `다름 ${bad}개 상품 — 고치지 말고 보고한다` : `${targets.length}개 상품 모두 같다`);
  if (bad > 0) process.exitCode = 1;
})().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: 타입** — Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: `0`.

- [ ] **Step 3: 실행(읽기 전용)** — Run: `npx --no-install tsx scripts/erp/sku-sync-compare.ts`

Expected(각 줄 앞에 `[coupang] GET …/seller-products/<id> → HTTP 200` 로그가 붙는다):
```
✅ 16405441934 SKU 1 · 리스팅 1 · 연결 1 — DB와 같다
✅ 16405396513 SKU 1 · 리스팅 1 · 연결 1 — DB와 같다
✅ 16404126884 SKU 2 · 리스팅 2 · 연결 2 — DB와 같다
✅ 16399766529 SKU 1 · 리스팅 1 · 연결 1 — DB와 같다
4개 상품 모두 같다
```
❌가 나오면 **고치지 않는다.** 출력 전체를 보고에 붙이고, 쿠팡 쪽 변경(10-10 이후 RG 등록·옵션 추가 → 「계획에만」 리스팅)인지 규칙 차이인지 메모한다.

- [ ] **Step 4: 쓰지 않았음 확인(읽기 전용)**

```bash
U=$(grep "^SUPABASE_DB_URL=" .env.local | cut -d= -f2- | tr -d '"')
psql "$U" -At -c "begin read only; select count(*) from erp.skus; select count(*) from erp.channel_listings; select count(*) from erp.listing_skus; select max(updated_at) from erp.skus; rollback;"
```
Expected: SKU 221 · 리스팅 452 · 연결 462(Task 0의 「현재 DB」 줄과 같다 — 다르면 그 사이 다른 세션의 작업인지 확인하고 보고). `max(updated_at)`이 이 작업을 시작한 시각 이전이다.

- [ ] **Step 5: Commit**

```bash
git add scripts/erp/sku-sync-compare.ts
git commit -m "chore(erp): SKU 자동 추가 운영 대조 스크립트(읽기 전용 · planOnly vs DB)"
```

---

### Task 13: 전체 검증 · 설계서 정정 · 실행 기록

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-erp-sku-auto-add-design.md`(끝에 절 추가)
- Modify: 이 계획서 끝

- [ ] **Step 1: 관련 테스트 전부** — Run: `npx vitest run src/__tests__/lib/erp src/__tests__/api src/__tests__/components 2>&1 | grep -E "^ FAIL |Test Files|Tests " | sed 's/ >.*//' | sort -u` · Expected: 새로 만든 테스트 파일 9개(coupang-input · db-input · upsert · sync-product · sync-missing · sync-message · cost-management-products-sku-sync · erp-skus-sync-missing · erp-sku-sync-button) PASS. 다른 FAIL이 있으면 그 테스트가 이 계획이 바꾼 파일(파일 구조 표)을 import하는지 본다 — 하면 고치고, 안 하면 시작 전부터 있던 실패로 실행 기록에 파일명을 적는다(main의 A11 실행 기록에 알려진 실패 7파일 목록이 있다).

- [ ] **Step 2: 타입** — Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` · Expected: `0`.

- [ ] **Step 3: 마지막 회귀(읽기 전용)** — Run: `npx --no-install tsx scripts/erp/sku-apply.ts > /tmp/sku-apply-final.txt 2>&1; diff /tmp/sku-apply-before.txt /tmp/sku-apply-final.txt && echo "출력 같음"` · Expected: `출력 같음`.

- [ ] **Step 4: 설계서 정정** — 설계서 끝에 아래 절을 붙인다.

```markdown
## 6. 계획에서 정한 것 (2026-10-10)

- SKU 적재에는 advisory lock이 없었다 — `SKU_MASTER_LOCK = 7103`을 새로 두고 전체 적재(`--apply`)와 자동 추가가 둘 다 잡는다.
- 이미 있는지는 쿠팡 조회 전과 잠금 뒤에 두 번 본다(겹친 요청).
- 네이버·토스 리스팅은 DB에 아직 없는 것만 만든다. 이미 있는 것(다른 상품과 묶인 `any_of` 등)은 전체 적재가 맡는다.
- 상품 하나 범위의 DB 입력은 `sale_records`를 읽지 않는다(판매 귀속은 점검 이슈에만 쓰인다).
- bulk 원가관리 추가는 한 요청에서 SKU 자동 추가를 20개까지만 하고, 넘는 상품은 `failed`로 「SKU 다시 맞추기」를 안내한다.
- 운영 대조용 `planOnly`(쓰기 없음)는 `status: 'planned'`를 돌려준다 — 라우트 응답에는 나오지 않는다.
```

- [ ] **Step 5: 실행 기록** — 이 계획서 끝에 「## 실행 기록 (YYYY-MM-DD)」 절을 만들고 커밋 sha · 새 테스트 수 · Task 4 Step 6·7, Task 12 Step 3·4의 출력 요약을 적는다.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-10-erp-sku-auto-add-design.md docs/superpowers/plans/2026-10-10-erp-sku-auto-add.md
git commit -m "docs(erp): SKU 자동 추가 — 계획에서 정한 것 · 실행 기록"
```

---

## 병합 뒤 (사용자 게이트 — 컨트롤러가 묻는다)

1. PR 생성·병합은 사용자 승인 뒤(이 계획은 push하지 않는다). 마이그레이션 없음.
2. 배포 뒤 첫 실제 확인은 사용자가 한다 — 원가관리 「쿠팡 상품 불러오기」로 새 상품 하나를 넣고 토스트 「SKU N개 자동 추가」 → 재고현황에 그 SKU가 보이는지 → 코스트코 영수증 입고에서 조회되는지.
