# 취소/반품 소급 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 임포트 후 취소·반품된 주문을 `sale_records.voided_at`로 소프트 무효화하고, FIFO·집계에서 제외하며, 감지를 wing·naver 일괄 임포트에 피기백한다.

**Architecture:** `sale_records`에 `voided_at` 컬럼을 추가하고 손익·재고 로드 4곳에 `voided_at IS NULL`을 건다. wing·naver 일괄 임포트가 같은 API 응답에서 취소 건의 키를 순수 헬퍼(`cancel-sync.ts`)로 뽑아 매칭 레코드를 `UPDATE ... SET voided_at = now()`한다. 결과 건수는 임포트 응답 `voided`로 반환해 기존 결과 패널에 표시한다.

**Tech Stack:** Next.js 16, TypeScript, PostgreSQL (pg, SOURCING_DATABASE_URL), Vitest.

**설계 문서:** `docs/superpowers/specs/2026-07-06-cancel-return-voiding-design.md`

> **테스트 실행 주의:** 인자 없는 `npx vitest run`은 `node_modules.nosync` 라이브러리 테스트까지 돌려 대량 선재 실패한다. **항상 파일 경로를 지정**해 실행한다.

---

## File Structure

- **Create** `supabase/migrations/085_sale_records_voided.sql` — `voided_at` 컬럼.
- **Create** `src/lib/cost-management/cancel-sync.ts` — 취소키 추출 순수 헬퍼(wing/naver).
- **Modify** 4개 라우트 — `sale_records` 로드에 `voided_at IS NULL`.
- **Modify** wing/rg/naver bulk 라우트 — void UPDATE + `voided` 응답.
- **Modify** `src/components/orders/import-summary.ts` — `voided` 필드.
- **Modify** `src/components/orders/CostManagementTab.tsx` — 패널 "취소 반영 N건".
- **Create** tests — cancel-sync, import-summary.

---

## Task 1: 마이그레이션 085 (`voided_at` 컬럼)

**Files:**
- Create: `supabase/migrations/085_sale_records_voided.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
BEGIN;

ALTER TABLE sale_records
  ADD COLUMN IF NOT EXISTS voided_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN sale_records.voided_at IS
  '취소/반품으로 무효화된 시각. NULL이면 유효 판매. FIFO·집계에서 제외.';

COMMIT;
```

- [ ] **Step 2: DB에 적용** — 이 프로젝트의 `sale_records`는 Render PostgreSQL(`SOURCING_DATABASE_URL`)에 있다. **실제 DB 쓰기**지만 nullable·기본 NULL 컬럼 추가라 기존 코드/데이터에 무해(additive).

Run: `node scripts/migrate-sourcing.mjs 085`
Expected: 성공 로그(085 적용). 실패 시(환경변수 없음 등) 사용자에게 보고하고 멈춘다.

- [ ] **Step 3: 컬럼 적용 확인**

Run: `node -e "import('pg').then(async({default:pg})=>{const p=new pg.Pool({connectionString:process.env.SOURCING_DATABASE_URL,ssl:{rejectUnauthorized:false}});const r=await p.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='sale_records' AND column_name='voided_at'\");console.log(r.rows);await p.end();})"`
Expected: `[ { column_name: 'voided_at' } ]`

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/085_sale_records_voided.sql
git commit -m "feat(cost-management): sale_records voided_at 컬럼(취소/반품 소프트 무효화)"
```

---

## Task 2: FIFO·집계에서 무효 판매 제외 (4곳)

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`
- Modify: `src/app/api/cost-management/products/[id]/fifo-summary/route.ts`
- Modify: `src/app/api/cost-management/products/[id]/variant-stock/route.ts`
- Modify: `src/app/api/cost-management/products/[id]/sales/route.ts`

SQL WHERE만 추가한다. 단위 테스트 불가 → tsc + 수동 검증(Task 6).

- [ ] **Step 1: products/route.ts** — `:76`
  현재: `` `SELECT id, product_cost_id, sold_at, quantity, selling_price, coupon_discount, channel, shipping_fee FROM sale_records WHERE user_id = $1`, ``
  변경(끝에 `AND voided_at IS NULL` 추가):
  `` `SELECT id, product_cost_id, sold_at, quantity, selling_price, coupon_discount, channel, shipping_fee FROM sale_records WHERE user_id = $1 AND voided_at IS NULL`, ``

- [ ] **Step 2: fifo-summary/route.ts** — `:32`
  현재: `` `SELECT id, sold_at, quantity, selling_price, shipping_fee FROM sale_records WHERE product_cost_id = $1`, ``
  변경:
  `` `SELECT id, sold_at, quantity, selling_price, shipping_fee FROM sale_records WHERE product_cost_id = $1 AND voided_at IS NULL`, ``

- [ ] **Step 3: variant-stock/route.ts** — `:32-36` 쿼리
  현재:
```ts
    `SELECT variant_name, SUM(quantity)::int AS total
     FROM sale_records
     WHERE product_cost_id = $1 AND variant_name IS NOT NULL
     GROUP BY variant_name`,
```
  변경(`AND voided_at IS NULL` 추가):
```ts
    `SELECT variant_name, SUM(quantity)::int AS total
     FROM sale_records
     WHERE product_cost_id = $1 AND variant_name IS NOT NULL AND voided_at IS NULL
     GROUP BY variant_name`,
```

- [ ] **Step 4: sales/route.ts (GET)** — `:26-31` 쿼리
  현재:
```ts
      `SELECT id, sold_at, quantity, selling_price, coupon_discount, channel, coupang_order_item_id, shipping_fee, created_at
       FROM sale_records
       WHERE product_cost_id = $1
       ORDER BY sold_at DESC, created_at DESC`,
```
  변경:
```ts
      `SELECT id, sold_at, quantity, selling_price, coupon_discount, channel, coupang_order_item_id, shipping_fee, created_at
       FROM sale_records
       WHERE product_cost_id = $1 AND voided_at IS NULL
       ORDER BY sold_at DESC, created_at DESC`,
```

- [ ] **Step 5: tsc** — Run: `npx tsc --noEmit` → 신규 에러 없음(무관한 `ImageLabel3x3Editor.tsx` 제외).

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts "src/app/api/cost-management/products/[id]/fifo-summary/route.ts" "src/app/api/cost-management/products/[id]/variant-stock/route.ts" "src/app/api/cost-management/products/[id]/sales/route.ts"
git commit -m "fix(cost-management): FIFO·재고·목록에서 무효(voided) 판매 제외"
```

---

## Task 3: 취소키 추출 순수 헬퍼 `cancel-sync.ts`

**Files:**
- Create: `src/lib/cost-management/cancel-sync.ts`
- Test: `src/__tests__/lib/cancel-sync.test.ts`

wing/naver 취소 주문에서 매칭 `sale_records` 키를 뽑는 순수 함수. 라우트는 기존 루프에서 이 함수를 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/lib/cancel-sync.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { wingCancelledKeys, naverCancelledKey } from '@/lib/cost-management/cancel-sync';

describe('wingCancelledKeys', () => {
  const vendorItemMap = new Map<number, unknown>([[111, {}]]);
  const sellerProductMap = new Map<number, unknown>([[900, {}]]);

  it('vendorItemId가 매칭되는 취소 주문 아이템의 키를 반환', () => {
    const order = { orderId: 5, items: [{ vendorItemId: 111, sellerProductId: 1 }] };
    expect(wingCancelledKeys(order, vendorItemMap, sellerProductMap)).toEqual(['wing-5-111']);
  });
  it('sellerProductId fallback 매칭도 포함', () => {
    const order = { orderId: 7, items: [{ vendorItemId: 222, sellerProductId: 900 }] };
    expect(wingCancelledKeys(order, vendorItemMap, sellerProductMap)).toEqual(['wing-7-222']);
  });
  it('매칭 안 되는 아이템은 제외', () => {
    const order = { orderId: 8, items: [{ vendorItemId: 999, sellerProductId: 999 }] };
    expect(wingCancelledKeys(order, vendorItemMap, sellerProductMap)).toEqual([]);
  });
  it('여러 아이템 각각 키 생성', () => {
    const order = { orderId: 9, items: [{ vendorItemId: 111, sellerProductId: 1 }, { vendorItemId: 999, sellerProductId: 900 }] };
    expect(wingCancelledKeys(order, vendorItemMap, sellerProductMap)).toEqual(['wing-9-111', 'wing-9-999']);
  });
});

describe('naverCancelledKey', () => {
  const map = new Map<number, string>([[1, 'pc-1']]);
  it('매칭되는 취소 주문의 키 반환', () => {
    expect(naverCancelledKey({ productOrderId: 'PO1', channelProductNo: 1 }, map)).toBe('naver-PO1');
  });
  it('채널상품번호 미매칭이면 null', () => {
    expect(naverCancelledKey({ productOrderId: 'PO2', channelProductNo: 999 }, map)).toBeNull();
  });
  it('channelProductNo 없으면 null', () => {
    expect(naverCancelledKey({ productOrderId: 'PO3', channelProductNo: null }, map)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/lib/cancel-sync.test.ts` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/lib/cost-management/cancel-sync.ts`

```ts
interface WingItem { vendorItemId: number; sellerProductId: number }
interface WingOrder { orderId: number | string; items: WingItem[] }

/**
 * 취소류(비-SALE) wing 주문에서, 우리 상품과 매칭되는 아이템의 sale_records 키를 반환.
 * 키 규칙은 임포트와 동일: `wing-${orderId}-${vendorItemId}`.
 */
export function wingCancelledKeys(
  order: WingOrder,
  vendorItemMap: ReadonlyMap<number, unknown>,
  sellerProductMap: ReadonlyMap<number, unknown>,
): string[] {
  const keys: string[] = [];
  for (const item of order.items) {
    if (vendorItemMap.has(item.vendorItemId) || sellerProductMap.has(item.sellerProductId)) {
      keys.push(`wing-${order.orderId}-${item.vendorItemId}`);
    }
  }
  return keys;
}

interface NaverOrder { productOrderId: string | number; channelProductNo: number | null }

/**
 * 취소 상태 naver 주문에서, 우리 상품과 매칭되면 sale_records 키를 반환(아니면 null).
 * 키 규칙은 임포트와 동일: `naver-${productOrderId}`. channelProductNoMap은 number 키.
 */
export function naverCancelledKey(
  order: NaverOrder,
  channelProductNoMap: ReadonlyMap<number, unknown>,
): string | null {
  if (order.channelProductNo == null) return null;
  if (!channelProductNoMap.has(order.channelProductNo)) return null;
  return `naver-${order.productOrderId}`;
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/lib/cancel-sync.test.ts` → PASS (7 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cost-management/cancel-sync.ts src/__tests__/lib/cancel-sync.test.ts
git commit -m "feat(cost-management): 취소키 추출 헬퍼 cancel-sync(wing/naver)"
```

---

## Task 4: 일괄 임포트 void 배선 (wing·naver·rg)

**Files:**
- Modify: `src/app/api/cost-management/wing-bulk-import/route.ts`
- Modify: `src/app/api/cost-management/naver-bulk-import/route.ts`
- Modify: `src/app/api/cost-management/rg-bulk-import/route.ts`

READ 각 파일의 현재 루프·응답을 먼저 확인 후 편집. tsc로 검증(라우트 단위 테스트는 안 함).

- [ ] **Step 1: wing-bulk — import 추가**
  상단에: `import { wingCancelledKeys } from '@/lib/cost-management/cancel-sync';`

- [ ] **Step 2: wing-bulk — 취소키 수집**
  `records` 배열 선언 근처(페이지네이션 루프 밖)에 `const cancelledKeys = new Set<string>();` 추가.
  현재 루프의 `if (order.saleType !== 'SALE') continue;`(약 `:109`)를 아래로 교체:
```ts
          if (order.saleType !== 'SALE') {
            for (const k of wingCancelledKeys(order, vendorItemMap, sellerProductMap)) cancelledKeys.add(k);
            continue;
          }
```

- [ ] **Step 3: wing-bulk — void UPDATE + 응답**
  `imported` 집계가 끝난 뒤(현재 `const skippedCount = ...` 및 `return NextResponse.json(...)` 직전)에 추가:
```ts
    let voided = 0;
    if (cancelledKeys.size > 0) {
      const voidRes = await pool.query(
        `UPDATE sale_records SET voided_at = now()
         WHERE user_id = $1 AND coupang_order_item_id = ANY($2::text[]) AND voided_at IS NULL`,
        [user.userId, Array.from(cancelledKeys)],
      );
      voided = voidRes.rowCount ?? 0;
    }
```
  그리고 응답을 `data: { imported, skipped: skippedCount, total: records.length, voided }`로 변경.

- [ ] **Step 4: naver-bulk — import + 수집**
  상단에: `import { naverCancelledKey } from '@/lib/cost-management/cancel-sync';`
  `records` 선언 근처에 `const cancelledKeys = new Set<string>();`.
  현재 취소 필터(약 `:53-54`)를 아래로 교체:
```ts
      if (CANCELLED_STATUSES.has(order.productOrderStatus) || (order.claimStatus && CANCELLED_STATUSES.has(order.claimStatus))) {
        const k = naverCancelledKey(order, channelProductNoMap);
        if (k) cancelledKeys.add(k);
        continue;
      }
```

- [ ] **Step 5: naver-bulk — void UPDATE + 응답**
  INSERT 루프 뒤, `return NextResponse.json(...)` 직전에 Step 3과 동일한 void 블록 추가(같은 SQL). 응답을 `data: { imported, skipped, total: records.length, voided }`로 변경(현재 `skipped` 계산식 유지).

- [ ] **Step 6: rg-bulk — 응답 형태 통일**
  rg-bulk의 성공 응답 `data: { imported, skipped, total }`에 `voided: 0` 추가(RG는 취소 감지 안 함). 조기 반환(0건) 응답에도 `voided: 0` 추가.

- [ ] **Step 7: tsc** — Run: `npx tsc --noEmit` → 신규 에러 없음. (`vendorItemMap`/`sellerProductMap`/`channelProductNoMap`의 실제 변수명을 원본에서 확인해 헬퍼 인자로 정확히 전달할 것.)

- [ ] **Step 8: 커밋**

```bash
git add src/app/api/cost-management/wing-bulk-import/route.ts src/app/api/cost-management/naver-bulk-import/route.ts src/app/api/cost-management/rg-bulk-import/route.ts
git commit -m "feat(cost-management): 일괄 임포트가 취소 주문을 void 처리 + voided 응답"
```

---

## Task 5: 결과 리포트 — `voided` 표시

**Files:**
- Modify: `src/components/orders/import-summary.ts`
- Test: `src/__tests__/components/import-summary.test.ts`
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: 실패하는 테스트 추가** — `src/__tests__/components/import-summary.test.ts`의 `describe` 안에 추가:

```ts
  it('voided 건수를 채널별로 집계한다', () => {
    const summary = buildImportSummary([
      { channel: 'RG', json: { success: true, data: { imported: 1, skipped: 0, total: 1, voided: 0 } } },
      { channel: '윙', json: { success: true, data: { imported: 2, skipped: 0, total: 2, voided: 3 } } },
    ]);
    expect(summary.channels[1].voided).toBe(3);
    expect(summary.totalVoided).toBe(3);
  });

  it('voided 필드가 없으면 0으로 처리', () => {
    const summary = buildImportSummary([
      { channel: '네이버', json: { success: true, data: { imported: 0, skipped: 0, total: 0 } } },
    ]);
    expect(summary.channels[0].voided).toBe(0);
    expect(summary.totalVoided).toBe(0);
  });
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/import-summary.test.ts` → FAIL (`voided`/`totalVoided` 없음).

- [ ] **Step 3: import-summary.ts 확장** — 전체를 아래로 교체:

```ts
export interface BulkImportJson {
  success: boolean;
  data?: { imported: number; skipped: number; total: number; voided?: number };
  error?: string;
}

export interface ChannelImportResult {
  channel: string;
  success: boolean;
  imported: number;
  skipped: number;
  total: number;
  voided: number;
  error?: string;
}

export interface ImportSummary {
  channels: ChannelImportResult[];
  totalImported: number;
  totalVoided: number;
  hasError: boolean;
}

export function buildImportSummary(
  results: { channel: string; json: BulkImportJson }[],
): ImportSummary {
  const channels: ChannelImportResult[] = results.map(({ channel, json }) => {
    if (json.success) {
      return {
        channel,
        success: true,
        imported: json.data?.imported ?? 0,
        skipped: json.data?.skipped ?? 0,
        total: json.data?.total ?? 0,
        voided: json.data?.voided ?? 0,
      };
    }
    return {
      channel,
      success: false,
      imported: 0,
      skipped: 0,
      total: 0,
      voided: 0,
      error: json.error ?? '실패',
    };
  });

  return {
    channels,
    totalImported: channels.reduce((sum, c) => sum + c.imported, 0),
    totalVoided: channels.reduce((sum, c) => sum + c.voided, 0),
    hasError: channels.some((c) => !c.success),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/import-summary.test.ts` → PASS.

- [ ] **Step 5: 패널에 "취소 반영" 표기** — `CostManagementTab.tsx`의 임포트 결과 패널에서 채널별 성공 라인(현재 `신규 {c.imported} · 스킵 {c.skipped}`)을 아래로 교체:

```tsx
                  <span style={{ color: '#16a34a' }}>
                    신규 {c.imported} · 스킵 {c.skipped}{c.voided > 0 ? ` · 취소 ${c.voided}` : ''}
                  </span>
```
  그리고 패널 헤더의 `신규 {importResult.totalImported}건` 옆에 무효 건이 있으면 표기:
```tsx
              판매 가져오기 — 신규 {importResult.totalImported}건{importResult.totalVoided > 0 ? ` · 취소 ${importResult.totalVoided}건` : ''}
```

- [ ] **Step 6: tsc + 테스트** — Run: `npx tsc --noEmit` (신규 에러 없음) 및 `npx vitest run src/__tests__/components/import-summary.test.ts` (PASS).

- [ ] **Step 7: 커밋**

```bash
git add src/components/orders/import-summary.ts src/__tests__/components/import-summary.test.ts src/components/orders/CostManagementTab.tsx
git commit -m "feat(cost-management): 임포트 결과 패널에 취소 반영(voided) 건수 표시"
```

---

## Task 6: 전체 검증

- [ ] **Step 1: 관련 테스트 전체**
  Run: `npx vitest run src/__tests__/lib/cancel-sync.test.ts src/__tests__/components/import-summary.test.ts src/lib/cost-management/__tests__/fifo.test.ts`
  Expected: 전부 PASS.

- [ ] **Step 2: tsc** — Run: `npx tsc --noEmit` → 무관한 `ImageLabel3x3Editor.tsx` 에러만.

- [ ] **Step 3: 수동 검증(dev 서버, 선택)** — `/orders?tab=cost`에서 "판매 가져오기" 실행 후: 결과 패널에 "취소 N건"이 뜨는지, 취소 반영 후 해당 상품 실현손익·재고가 감소하는지. (실 취소 데이터 필요 시 생략 — 로직은 헬퍼 단위 테스트로 커버.)

---

## Self-Review 노트

- **스펙 커버리지:** voided_at 컬럼(§2)=Task 1, FIFO 제외 4곳(§3)=Task 2, 취소 감지 wing/naver(§4)=Task 3·4, RG voided:0(§4)=Task 4 Step 6, 결과 리포트(§5)=Task 5, 테스트(§6)=각 Task. 커버됨.
- **범위 밖(§9):** RG 취소 감지·재활성·단건 피기백·무효 이력 UI — 태스크 없음(의도).
- **타입 일관성:** `voided`(Task 4 응답 → Task 5 import-summary), `wingCancelledKeys`/`naverCancelledKey`(Task 3 정의 → Task 4 사용), void SQL은 wing/naver 동일.
- **의존 확인:** Task 4는 원본의 실제 맵 변수명(`vendorItemMap`/`sellerProductMap`/`channelProductNoMap`)과 `user.userId` 접근을 확인해 배선.
- **DB 쓰기:** Task 1 Step 2가 Render DB에 컬럼 추가(additive·무해). 코드(Task 2)는 컬럼 존재 전제 → Task 1을 먼저 적용.
