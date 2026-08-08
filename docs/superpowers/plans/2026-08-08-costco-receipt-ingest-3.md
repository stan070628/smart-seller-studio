# 코스트코 영수증 자동 입고 — 3편: 확정과 cron

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영수증이 실제 `cost_entries`가 된다. 판독은 cron이 알아서 돌고, 확정은 사람이 누른다.

**Architecture:** 확정 로직의 판단 부분을 순수 함수로 떼어 테스트한다. 소분 이월 계산은 **기존 입고 API에서 서비스 함수로 추출해 공유**한다 — 복제하면 두 경로의 원가가 조용히 갈린다.

**Tech Stack:** Next.js App Router · `pg` · Vercel Cron · vitest

**Spec:** `docs/superpowers/specs/2026-08-08-costco-receipt-ingest-design.md`
**전편:** 1편(스키마·순수로직) · 2편(업로드·추출) — 둘 다 main 병합 완료
**후속:** 4편 화면 (`/m/receipt` + 조회 API + 줄 수정 API)

---

## 전편에서 이미 있는 것

| 모듈 | 쓸 것 |
|---|---|
| `src/lib/receipt/discount.ts` | `attributeDiscounts()`, `netAmountOf()`, `AttributedLine` |
| `src/lib/receipt/entry-payload.ts` | `buildEntryPayload()` — 오버로드로 반환 타입 분기 |
| `src/lib/receipt/extract.ts` | `extractReceipt()`, `receiptJsonSchema()` |
| `src/lib/receipt/verify.ts` | `verifyReceipt()` |
| `src/lib/receipt/mapping.ts` | `applyMappings()`, `ItemMapRow`, `DraftLineRow` |
| `src/lib/cost-management/subdivision.ts` | `calculateSubdivision()` |
| API | `POST /api/receipts` (업로드), `POST /api/receipts/[id]/parse` (판독) |

기존 관례:
- cron 인증 — `Authorization: Bearer ${CRON_SECRET}`, `vercel.json`의 `crons` 배열에 등록
- 인증 — `getCurrentUser()` → `{ userId, email } | null`
- DB — `getSourcingPool()`, 트랜잭션은 `pool.connect()` / `BEGIN` / `ROLLBACK` / `client.release()`

---

## cron이 만드는 두 가지 문제

판독을 cron에 맡기기로 하면서 2편에 없던 문제가 생긴다. **둘 다 이 계획에서 푼다.**

### 문제 1 — 동시 실행이 줄을 중복시킨다

2편의 판독 라우트는 `ocr_status === 'parsed'`를 보고 재판독을 막는다. 그런데 그 검사는 **판독이 끝난 뒤에야** 걸린다. cron 두 번이 겹치면 둘 다 `pending`을 보고 둘 다 판독해 줄이 두 벌 들어간다.

**해법: 원자적 claim.** 하나의 `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`로 초안을 집으면서 동시에 `parsing`으로 바꾼다. 두 번째 cron은 그 행을 건너뛴다.

### 문제 2 — 죽은 cron이 초안을 영영 묶는다

`parsing`으로 바꿔놓고 함수가 죽으면 그 초안은 영원히 `parsing`에 남아 아무도 안 집는다.

**해법: 시각 기반 회수.** `parse_started_at`이 10분보다 오래되면 다시 집을 수 있게 한다. 다만 무한 재시도는 흐릿한 사진 하나로 돈을 계속 태우므로 **시도 3회에서 `failed`로 못 박는다.**

`failed`는 cron이 다시 집지 않는다. 사람이 명시적으로 재시도해야 한다 — 자동 재시도가 조용히 비용을 쓰는 것보다 낫다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/102_receipt_parse_state.sql` | `parsing` 상태 · 시도 횟수 · 시작 시각 |
| `src/lib/receipt/confirm.ts` | 확정 대상 선별 + 매핑 학습 값 산출. **순수 함수** |
| `src/lib/cost-management/create-entry.ts` | 입고 생성 서비스. 기존 라우트에서 추출 |
| `src/app/api/receipts/[id]/confirm/route.ts` | `POST` 확정 |
| `src/app/api/cron/parse-receipts/route.ts` | `GET` cron 판독 |

---

## Task 1: 마이그레이션 102

**Files:**
- Create: `supabase/migrations/102_receipt_parse_state.sql`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 영수증 판독 상태 — cron 동시 실행·중단 대응
-- spec 2026-08-08 / plan 3

-- 'parsing'을 CHECK에 추가한다. 제약을 갈아끼우는 것이라 DROP 후 ADD.
ALTER TABLE receipt_drafts DROP CONSTRAINT IF EXISTS receipt_drafts_ocr_status_check;
ALTER TABLE receipt_drafts ADD CONSTRAINT receipt_drafts_ocr_status_check
  CHECK (ocr_status IN ('pending','parsing','parsed','failed'));

-- 시도 횟수. 흐릿한 사진 하나가 무한히 돈을 태우는 것을 막는다
ALTER TABLE receipt_drafts
  ADD COLUMN IF NOT EXISTS parse_attempts int NOT NULL DEFAULT 0
    CHECK (parse_attempts >= 0);

-- 죽은 cron이 묶어둔 초안을 시각으로 회수한다
ALTER TABLE receipt_drafts
  ADD COLUMN IF NOT EXISTS parse_started_at timestamptz;

-- cron이 집을 후보를 고르는 인덱스
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_claimable
  ON receipt_drafts (ocr_status, parse_started_at)
  WHERE ocr_status IN ('pending','parsing');

COMMENT ON COLUMN receipt_drafts.parse_attempts IS 'cron 판독 시도 횟수. 3회에서 failed로 확정';
COMMENT ON COLUMN receipt_drafts.parse_started_at IS 'parsing 진입 시각. 10분 초과 시 회수 대상';
```

- [ ] **Step 2: 롤백 트랜잭션으로 검증**

🔴 **운영 DB에 커밋하지 마라.** 실제 적용은 사람이 따로 판단한다.

```bash
cd /Users/seungminlee/dev/smart_seller_studio && set -a; . ./.env.local 2>/dev/null; set +a
psql "$SOURCING_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
\i supabase/migrations/102_receipt_parse_state.sql
ROLLBACK;
SQL
```

Expected: `ALTER TABLE` / `CREATE INDEX` / `COMMENT` 출력 후 `ROLLBACK`, 오류 없음.

기존 `receipt_drafts`에 행이 있어도 통과해야 한다 — `parse_attempts`가 `NOT NULL DEFAULT 0`이라 기존 행이 0으로 채워진다.

- [ ] **Step 3: 롤백 후 DB 청결 재확인**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && set -a; . ./.env.local 2>/dev/null; set +a
psql "$SOURCING_DATABASE_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='receipt_drafts' AND column_name IN ('parse_attempts','parse_started_at');"
```
Expected: 아무것도 출력되지 않음 (롤백됐으므로)

- [ ] **Step 4: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add supabase/migrations/102_receipt_parse_state.sql && \
git commit -m "feat(receipt): 판독 상태에 parsing·시도횟수 추가" -- supabase/migrations/102_receipt_parse_state.sql
```

---

## Task 2: 확정 대상 선별

**Files:**
- Create: `src/lib/receipt/confirm.ts`
- Test: `src/lib/receipt/__tests__/confirm.test.ts`

어떤 줄이 확정 가능한지 판단한다. **거절 사유를 함께 낸다** — 사람이 무엇을 고쳐야 하는지 알아야 하기 때문이다.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { selectConfirmable, type ConfirmCandidate } from '@/lib/receipt/confirm';

function line(over: Partial<ConfirmCandidate> = {}): ConfirmCandidate {
  return {
    line_no: 1,
    is_discount: false,
    decision: 'ingest',
    product_cost_id: 'prod-1',
    entry_type: 'normal',
    items_per_box: null,
    subdivision_unit: null,
    cost_entry_id: null,
    ...over,
  };
}

describe('selectConfirmable', () => {
  it('조건을 갖춘 줄은 확정 대상이다', () => {
    const r = selectConfirmable([line()]);
    expect(r.confirmable.map((l) => l.line_no)).toEqual([1]);
    expect(r.skipped).toEqual([]);
  });

  it('이미 확정된 줄은 건너뛴다 — 멱등성의 근거', () => {
    const r = selectConfirmable([line({ cost_entry_id: 'entry-1' })]);
    expect(r.confirmable).toEqual([]);
    expect(r.skipped[0].reason).toBe('already_confirmed');
  });

  it('decision이 ingest가 아니면 건너뛴다', () => {
    const r = selectConfirmable([line({ decision: 'skip' }), line({ line_no: 2, decision: 'pending' })]);
    expect(r.confirmable).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['not_ingest', 'not_ingest']);
  });

  it('할인 줄은 건너뛴다', () => {
    const r = selectConfirmable([line({ is_discount: true, decision: 'skip' })]);
    expect(r.skipped[0].reason).toBe('discount_line');
  });

  it('판매상품이 없으면 거절한다', () => {
    const r = selectConfirmable([line({ product_cost_id: null })]);
    expect(r.confirmable).toEqual([]);
    expect(r.skipped[0].reason).toBe('no_product');
  });

  it('입고 방식이 없으면 거절한다', () => {
    const r = selectConfirmable([line({ entry_type: null })]);
    expect(r.skipped[0].reason).toBe('no_entry_type');
  });

  it('소분인데 포장 수량이 없으면 거절한다', () => {
    const r = selectConfirmable([line({ entry_type: 'subdivision', subdivision_unit: 10 })]);
    expect(r.skipped[0].reason).toBe('missing_subdivision_params');
  });

  it('소분인데 소분 갯수가 없으면 거절한다', () => {
    const r = selectConfirmable([line({ entry_type: 'subdivision', items_per_box: 36 })]);
    expect(r.skipped[0].reason).toBe('missing_subdivision_params');
  });

  it('소분 파라미터가 다 있으면 통과한다', () => {
    const r = selectConfirmable([line({ entry_type: 'subdivision', items_per_box: 36, subdivision_unit: 10 })]);
    expect(r.confirmable.map((l) => l.line_no)).toEqual([1]);
  });

  it('line_no 오름차순으로 낸다 — 소분 이월이 순서에 의존한다', () => {
    const r = selectConfirmable([line({ line_no: 5 }), line({ line_no: 2 }), line({ line_no: 9 })]);
    expect(r.confirmable.map((l) => l.line_no)).toEqual([2, 5, 9]);
  });

  it('지정한 줄만 거를 수 있다', () => {
    const r = selectConfirmable([line({ line_no: 1 }), line({ line_no: 2 })], [2]);
    expect(r.confirmable.map((l) => l.line_no)).toEqual([2]);
    expect(r.skipped).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/receipt/__tests__/confirm.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/confirm"`

- [ ] **Step 3: 구현**

```typescript
/**
 * 확정 대상 선별.
 *
 * 어떤 줄을 입고로 만들 수 있는지 판단하고, 못 만드는 줄은 사유를 함께 낸다.
 * 화면이 "왜 이 줄은 안 들어갔지"에 답할 수 있어야 하기 때문이다.
 */

export type SkipReason =
  | 'already_confirmed'
  | 'not_ingest'
  | 'discount_line'
  | 'no_product'
  | 'no_entry_type'
  | 'missing_subdivision_params';

/** `receipt_draft_lines`에서 읽어온 행 중 이 함수가 쓰는 필드만 */
export interface ConfirmCandidate {
  line_no: number;
  is_discount: boolean;
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
  cost_entry_id: string | null;
}

export interface SelectResult {
  confirmable: ConfirmCandidate[];
  skipped: { line_no: number; reason: SkipReason }[];
}

/**
 * @param lines 초안의 모든 줄
 * @param onlyLineNos 지정하면 그 줄만 대상으로 한다. 생략하면 전부
 */
export function selectConfirmable(
  lines: ConfirmCandidate[],
  onlyLineNos?: number[],
): SelectResult {
  const target = onlyLineNos
    ? lines.filter((l) => onlyLineNos.includes(l.line_no))
    : lines;

  // line_no 오름차순. 소분 이월이 순서에 의존하므로 정렬을 여기서 보장한다
  const sorted = [...target].sort((a, b) => a.line_no - b.line_no);

  const confirmable: ConfirmCandidate[] = [];
  const skipped: { line_no: number; reason: SkipReason }[] = [];

  for (const l of sorted) {
    // 이미 확정된 줄은 다시 만들지 않는다. 멱등성의 근거다
    if (l.cost_entry_id != null) {
      skipped.push({ line_no: l.line_no, reason: 'already_confirmed' });
      continue;
    }
    if (l.is_discount) {
      skipped.push({ line_no: l.line_no, reason: 'discount_line' });
      continue;
    }
    if (l.decision !== 'ingest') {
      skipped.push({ line_no: l.line_no, reason: 'not_ingest' });
      continue;
    }
    if (!l.product_cost_id) {
      skipped.push({ line_no: l.line_no, reason: 'no_product' });
      continue;
    }
    if (!l.entry_type) {
      skipped.push({ line_no: l.line_no, reason: 'no_entry_type' });
      continue;
    }
    if (l.entry_type === 'subdivision' && (!l.items_per_box || !l.subdivision_unit)) {
      skipped.push({ line_no: l.line_no, reason: 'missing_subdivision_params' });
      continue;
    }
    confirmable.push(l);
  }

  return { confirmable, skipped };
}
```

- [ ] **Step 4: 통과 확인** — `11 tests passed`

- [ ] **Step 5: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/lib/receipt/confirm.ts src/lib/receipt/__tests__/confirm.test.ts && \
git commit -m "feat(receipt): 확정 대상 선별과 거절 사유" -- src/lib/receipt/confirm.ts src/lib/receipt/__tests__/confirm.test.ts
```

---

## Task 3: 매핑 학습 값 산출

**Files:**
- Modify: `src/lib/receipt/confirm.ts`
- Modify: `src/lib/receipt/__tests__/confirm.test.ts`

확정한 줄에서 `costco_item_map`에 기억시킬 값을 뽑는다. 다음 장보기에서 같은 품번이 자동으로 채워지게 하는 장치다.

- [ ] **Step 1: 실패하는 테스트 추가**

import에 `mappingUpsertFrom`, `type MappingUpsert`를 추가하고 파일 끝에 붙인다.

```typescript
describe('mappingUpsertFrom', () => {
  const base = {
    line_no: 1, is_discount: false, decision: 'ingest' as const,
    product_cost_id: 'prod-1', entry_type: 'normal' as const,
    items_per_box: null, subdivision_unit: null, cost_entry_id: null,
  };

  it('품번과 확정 값을 기억할 형태로 낸다', () => {
    const r = mappingUpsertFrom({ ...base, item_code: '713160', item_label: 'KS노랑타월36CT' });
    expect(r).toEqual({
      item_code: '713160',
      item_label: 'KS노랑타월36CT',
      product_cost_id: 'prod-1',
      default_decision: 'ingest',
      default_entry_type: 'normal',
      items_per_box: null,
      subdivision_unit: null,
    });
  });

  it('소분 파라미터도 함께 기억한다', () => {
    const r = mappingUpsertFrom({
      ...base, item_code: '713160', item_label: 'KS노랑타월36CT',
      entry_type: 'subdivision', items_per_box: 36, subdivision_unit: 10,
    });
    expect(r?.items_per_box).toBe(36);
    expect(r?.subdivision_unit).toBe(10);
  });

  it('품번이 없으면 기억할 수 없다', () => {
    expect(mappingUpsertFrom({ ...base, item_code: null, item_label: '봉투' })).toBeNull();
  });

  it('확정 시 default_decision은 항상 ingest다', () => {
    const r = mappingUpsertFrom({ ...base, item_code: '999', item_label: 'x' });
    expect(r?.default_decision).toBe('ingest');
  });
});
```

- [ ] **Step 2: 실패 확인** — `mappingUpsertFrom is not a function`

- [ ] **Step 3: 구현 추가**

`confirm.ts` 끝에 붙인다.

```typescript
/** `costco_item_map`에 upsert할 값 */
export interface MappingUpsert {
  item_code: string;
  item_label: string;
  product_cost_id: string;
  default_decision: 'ingest';
  default_entry_type: 'normal' | 'subdivision';
  items_per_box: number | null;
  subdivision_unit: number | null;
}

/**
 * 확정한 줄에서 기억시킬 값을 뽑는다.
 *
 * 확정했다는 것은 사람이 "이 품번은 이 상품으로 입고한다"를 승인했다는 뜻이므로
 * `default_decision`은 언제나 `ingest`다. 개인용(`skip`)이나 매번 묻기(`ask`)는
 * 확정 경로가 아니라 줄 수정 경로에서 기억시킨다.
 *
 * 품번이 없는 줄(봉투값 등)은 기억할 키가 없으므로 null을 낸다.
 */
export function mappingUpsertFrom(
  line: ConfirmCandidate & { item_code: string | null; item_label: string },
): MappingUpsert | null {
  if (!line.item_code || !line.product_cost_id || !line.entry_type) return null;

  return {
    item_code: line.item_code,
    item_label: line.item_label,
    product_cost_id: line.product_cost_id,
    default_decision: 'ingest',
    default_entry_type: line.entry_type,
    items_per_box: line.items_per_box,
    subdivision_unit: line.subdivision_unit,
  };
}
```

- [ ] **Step 4: 통과 확인** — `15 tests passed` (11 + 4)

- [ ] **Step 5: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/lib/receipt/confirm.ts src/lib/receipt/__tests__/confirm.test.ts && \
git commit -m "feat(receipt): 확정 시 매핑 학습 값 산출" -- src/lib/receipt/confirm.ts src/lib/receipt/__tests__/confirm.test.ts
```

---

## Task 4: 입고 생성 서비스 추출

**Files:**
- Create: `src/lib/cost-management/create-entry.ts`
- Modify: `src/app/api/cost-management/products/[id]/entries/route.ts`

🔴 **이 태스크는 작동 중인 프로덕션 코드를 건드린다.** 신중히 하고, 기존 테스트가 전부 통과하는지 확인한 뒤에만 커밋하라.

### 왜 추출하는가

확정 API도 입고를 만들어야 하는데, 소분 팩 계산과 **이월 갱신**이 그 안에 있다. 복제하면 두 경로가 갈리고, 그러면 **같은 상품의 원가가 어느 경로로 들어왔는지에 따라 달라진다.** 이 기능이 막으려는 실패 방식이 정확히 그것이다.

### 방법

`entries/route.ts`의 `POST` 안에 있는 로직 중 **검증 이후 ~ 트랜잭션 종료까지**를 함수로 옮긴다. 라우트는 요청 파싱·검증·응답만 남긴다.

### 옮기는 코드의 출처

`src/app/api/cost-management/products/[id]/entries/route.ts`의 `POST` 중 **106~205행**(상품 조회 ~ 트랜잭션 종료)이다. 검증(84~102행)과 응답(207~214행)은 라우트에 남는다.

### 의도적으로 바뀌는 것 하나

기존 라우트는 `product_costs`의 이월을 **트랜잭션 밖에서** 읽고 안에서 갱신한다. 서비스는 client를 받으므로 읽기가 트랜잭션 **안으로** 들어온다. 같은 상품에 동시 입고가 들어올 때 이월을 덮어쓰는 창이 좁아지므로 **더 안전한 방향**이다. 그 외의 동작은 바꾸지 마라.

- [ ] **Step 1: 기존 테스트 기준선 확보**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx vitest run src/__tests__/api/cost-management-total-entry-stock.test.ts src/lib/cost-management 2>&1 | tail -6
```
통과 개수를 기록해두라. 리팩터 후 같아야 한다.

- [ ] **Step 2: 서비스 함수 작성**

`src/lib/cost-management/create-entry.ts`:

```typescript
import type { PoolClient } from 'pg';
import { ENTRY_CHANNEL } from '@/lib/cost-management/fifo';
import { calculateSubdivision } from '@/lib/cost-management/subdivision';

/**
 * 입고 1건 생성.
 *
 * POST /api/cost-management/products/[id]/entries에서 추출했다.
 * 영수증 확정 경로도 같은 함수를 쓴다 — 소분 이월 계산이 두 곳에 있으면
 * 어느 경로로 들어왔는지에 따라 같은 상품의 원가가 달라진다.
 *
 * 트랜잭션은 호출자가 연다. 이 함수는 주어진 client로만 쿼리한다.
 */
export interface CreateEntryInput {
  client: PoolClient;
  userId: string;
  productCostId: string;
  receivedAt: string;
  /** 일반 모드: 개당 단가 / 소분 모드: 총 구매가 */
  unitCost: number;
  /** 일반 모드에서만 쓴다 */
  quantity?: number;
  /** 양수면 소분 모드로 판정한다 */
  purchaseQuantity?: number | null;
  /** 생략하면 상품에 설정된 기본값을 쓴다 */
  subdivisionUnit?: number | null;
  unitShippingFee?: number;
  unitRgShippingFee?: number;
  channel?: string;
  variantName?: string | null;
  /** 영수증 확정 경로에서만 채운다 */
  sourceReceiptLineId?: string | null;
}

export interface CreateEntryResult {
  entry: Record<string, unknown>;
  /** 소분 모드에서만 값이 있다 */
  carryoverOut: number | null;
  isSubdivisionMode: boolean;
}

/**
 * 호출자가 HTTP 상태로 옮길 수 있도록 상태를 실어 던진다.
 * 라우트가 기존과 같은 400/404를 내게 하는 장치다.
 */
export class CostEntryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CostEntryError';
  }
}

export async function createCostEntry(input: CreateEntryInput): Promise<CreateEntryResult> {
  const {
    client, userId, productCostId, receivedAt, unitCost,
    quantity, purchaseQuantity, subdivisionUnit: inputSubdivisionUnit,
    unitShippingFee, unitRgShippingFee, channel, variantName, sourceReceiptLineId,
  } = input;

  const isSubdivisionMode =
    purchaseQuantity != null && typeof purchaseQuantity === 'number' && purchaseQuantity > 0;

  const { rows: check } = await client.query(
    `SELECT id, subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost
     FROM product_costs WHERE id = $1 AND user_id = $2`,
    [productCostId, userId],
  );
  if (check.length === 0) throw new CostEntryError('Not found', 404);
  const product = check[0];

  let finalQuantity: number;
  let finalUnitCost: number;
  let finalPurchaseQuantity: number | null = null;
  let finalSubdivisionUnit: number | null = null;
  let carryoverOut: number | null = null;
  let newCarryoverUnitCost: number | null = null;

  if (isSubdivisionMode) {
    const subdivisionUnit =
      inputSubdivisionUnit ??
      (product.subdivision_unit ? Number(product.subdivision_unit) : null);

    if (!subdivisionUnit || subdivisionUnit < 1) {
      throw new CostEntryError('subdivision_unit required (product default or body)', 400);
    }

    const calc = calculateSubdivision({
      purchaseQuantity: purchaseQuantity as number,
      totalPurchaseCost: unitCost,
      subdivisionUnit,
      carryoverQuantity: Number(product.subdivision_carryover ?? 0),
      carryoverUnitCost: Number(product.subdivision_carryover_unit_cost ?? 0),
    });

    if (calc.sellablePacks === 0) {
      throw new CostEntryError(
        `팩을 완성하기에 수량이 부족합니다. 현재 이월 포함 총 ${calc.totalAvailable}개, 소분 단위 ${subdivisionUnit}개`,
        400,
      );
    }

    finalQuantity = calc.sellablePacks;
    finalUnitCost = calc.packUnitCost;
    finalPurchaseQuantity = purchaseQuantity as number;
    finalSubdivisionUnit = subdivisionUnit;
    carryoverOut = calc.newCarryoverQuantity;
    newCarryoverUnitCost = calc.newCarryoverUnitCost;
  } else {
    finalQuantity = quantity as number;
    finalUnitCost = unitCost;
  }

  const { rows } = await client.query(
    `INSERT INTO cost_entries
       (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee,
        unit_rg_shipping_fee, channel, purchase_quantity, subdivision_unit, variant_name,
        source_receipt_line_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      userId,
      productCostId,
      receivedAt,
      finalQuantity,
      finalUnitCost,
      unitShippingFee ?? 0,
      unitRgShippingFee ?? 0,
      (channel === ENTRY_CHANNEL.RG || channel === ENTRY_CHANNEL.WING) ? channel : ENTRY_CHANNEL.WING,
      finalPurchaseQuantity,
      finalSubdivisionUnit,
      variantName ?? null,
      sourceReceiptLineId ?? null,
    ],
  );

  if (isSubdivisionMode && carryoverOut !== null) {
    await client.query(
      `UPDATE product_costs SET subdivision_carryover = $1, subdivision_carryover_unit_cost = $2 WHERE id = $3`,
      [carryoverOut, newCarryoverUnitCost, productCostId],
    );
  }

  return { entry: rows[0], carryoverOut, isSubdivisionMode };
}
```

**`source_receipt_line_id`를 INSERT에 추가하는 것이 이번 확장이다.** 기존 호출자는 이 값을 안 넘기므로 null이 들어가고 동작이 바뀌지 않는다.

- [ ] **Step 3: 기존 라우트를 서비스 호출로 교체**

`entries/route.ts`의 `POST`에서 **106~214행**을 아래로 바꾼다. 검증(84~102행)과 그 위는 손대지 마라.

```typescript
  const pool = getSourcingPool();

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { entry, carryoverOut, isSubdivisionMode: subMode } = await createCostEntry({
        client,
        userId: user.userId,
        productCostId: id,
        receivedAt: received_at,
        unitCost: unit_cost,
        quantity,
        purchaseQuantity: purchase_quantity,
        subdivisionUnit: bodySubdivisionUnit,
        unitShippingFee: unit_shipping_fee,
        unitRgShippingFee: unit_rg_shipping_fee,
        channel,
        variantName: variant_name,
      });
      await client.query('COMMIT');

      return NextResponse.json(
        {
          success: true,
          data: entry,
          ...(subMode && { carryover_out: carryoverOut }),
        },
        { status: 201 },
      );
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    // 서비스가 실은 상태를 그대로 쓴다 — 기존 400/404 응답을 보존한다
    if (err instanceof CostEntryError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

import 두 줄을 추가하고, 쓰이지 않게 된 `calculateSubdivision` / `ENTRY_CHANNEL` import는 **`POST` 외의 핸들러에서도 안 쓰는지 확인한 뒤에만** 지워라.

```typescript
import { createCostEntry, CostEntryError } from '@/lib/cost-management/create-entry';
```

- [ ] **Step 4: 기존 테스트가 그대로 통과하는지 확인**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx vitest run src/__tests__/api/cost-management-total-entry-stock.test.ts src/lib/cost-management
```
Expected: Step 1과 **같은 개수** 통과. 하나라도 줄면 리팩터가 동작을 바꾼 것이니 되돌려라.

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/lib/cost-management/create-entry.ts "src/app/api/cost-management/products/[id]/entries/route.ts" && \
git commit -m "refactor(cost): 입고 생성을 서비스 함수로 추출" -- src/lib/cost-management/create-entry.ts "src/app/api/cost-management/products/[id]/entries/route.ts"
```

---

## Task 5: 확정 API

**Files:**
- Create: `src/app/api/receipts/[id]/confirm/route.ts`

- [ ] **Step 1: 라우트 작성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { selectConfirmable, mappingUpsertFrom, type ConfirmCandidate } from '@/lib/receipt/confirm';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { buildEntryPayload } from '@/lib/receipt/entry-payload';
import { createCostEntry } from '@/lib/cost-management/create-entry';

/**
 * POST /api/receipts/[id]/confirm — 영수증 줄을 입고로 확정한다.
 *
 * Body: { line_nos?: number[] } — 생략하면 확정 가능한 줄 전부
 *
 * 확정 단위는 줄이다. 각 줄은 독립적으로 성공/실패하고, 성공하면 자기가 만든
 * cost_entry_id를 기록한다. 이미 기록된 줄은 다시 확정되지 않는다(멱등).
 *
 * line_no 오름차순 직렬로 처리한다 — 같은 상품이 여러 줄에 나올 때
 * 소분 이월이 순서에 의존하기 때문이다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const lineNos: number[] | undefined = Array.isArray(body?.line_nos) ? body.line_nos : undefined;

  const pool = getSourcingPool();

  const { rows: drafts } = await pool.query(
    `SELECT id, purchased_at FROM receipt_drafts WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (drafts.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const receivedAt: string | null = drafts[0].purchased_at
    ? new Date(drafts[0].purchased_at).toISOString().slice(0, 10)
    : null;
  if (!receivedAt) {
    return NextResponse.json(
      { success: false, error: '구매일을 읽지 못한 영수증은 확정할 수 없습니다.' },
      { status: 422 },
    );
  }

  const { rows: allLines } = await pool.query(
    `SELECT id, line_no, item_code, item_label, quantity, unit_price, amount,
            is_discount, applies_to_line_id, tax_type, decision, product_cost_id,
            entry_type, items_per_box, subdivision_unit, cost_entry_id
     FROM receipt_draft_lines WHERE draft_id = $1 ORDER BY line_no`,
    [id],
  );

  const { confirmable, skipped } = selectConfirmable(allLines as ConfirmCandidate[], lineNos);

  // 할인 반영 금액 계산을 위해 전체 줄을 귀속 형태로 만든다.
  // DB의 applies_to_line_id(uuid) 대신 line_no로 다시 잇는다 — 순수 함수가 그 형태를 쓴다
  const idToLineNo = new Map<string, number>(
    (allLines as { id: string; line_no: number }[]).map((l) => [l.id, l.line_no]),
  );
  const attributed = (allLines as Record<string, unknown>[]).map((l) => ({
    line_no: l.line_no as number,
    item_code: l.item_code as string | null,
    item_label: l.item_label as string,
    quantity: Number(l.quantity),
    unit_price: l.unit_price as number | null,
    amount: l.amount as number,
    is_discount: l.is_discount as boolean,
    tax_type: l.tax_type as 'taxable' | 'exempt' | 'unknown',
    applies_to_line_no: l.applies_to_line_id ? (idToLineNo.get(l.applies_to_line_id as string) ?? null) : null,
  }));

  const created: { line_no: number; cost_entry_id: string }[] = [];
  const failed: { line_no: number; error: string }[] = [];

  // 줄마다 독립된 트랜잭션. 하나가 실패해도 앞의 것은 남는다
  for (const line of confirmable) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const payload = line.entry_type === 'subdivision'
        ? buildEntryPayload({
            lines: attributed, lineNo: line.line_no, receivedAt,
            entryType: 'subdivision',
            itemsPerBox: line.items_per_box as number,
            subdivisionUnit: line.subdivision_unit as number,
          })
        : buildEntryPayload({
            lines: attributed, lineNo: line.line_no, receivedAt, entryType: 'normal',
          });

      const dbLine = (allLines as { line_no: number; id: string }[]).find((l) => l.line_no === line.line_no)!;

      const { entry } = await createCostEntry({
        client,
        userId: user.userId,
        productCostId: line.product_cost_id as string,
        receivedAt,
        unitCost: payload.unit_cost,
        quantity: 'quantity' in payload ? payload.quantity : undefined,
        purchaseQuantity: 'purchase_quantity' in payload ? payload.purchase_quantity : null,
        subdivisionUnit: 'subdivision_unit' in payload ? payload.subdivision_unit : null,
        sourceReceiptLineId: dbLine.id,
      });

      const entryId = (entry as { id: string }).id;

      await client.query(
        `UPDATE receipt_draft_lines SET cost_entry_id = $1 WHERE id = $2 AND cost_entry_id IS NULL`,
        [entryId, dbLine.id],
      );

      // 매핑 학습 — 다음 장보기에서 자동으로 채워진다
      const upsert = mappingUpsertFrom({
        ...line,
        item_code: (dbLine as unknown as { item_code: string | null }).item_code,
        item_label: (dbLine as unknown as { item_label: string }).item_label,
      });
      if (upsert) {
        await client.query(
          `INSERT INTO costco_item_map
             (user_id, item_code, item_label, product_cost_id, default_decision,
              default_entry_type, items_per_box, subdivision_unit, times_used, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,now())
           ON CONFLICT (user_id, item_code) DO UPDATE SET
             item_label = EXCLUDED.item_label,
             product_cost_id = EXCLUDED.product_cost_id,
             default_decision = EXCLUDED.default_decision,
             default_entry_type = EXCLUDED.default_entry_type,
             items_per_box = EXCLUDED.items_per_box,
             subdivision_unit = EXCLUDED.subdivision_unit,
             times_used = costco_item_map.times_used + 1,
             last_seen_at = now(),
             updated_at = now()`,
          [user.userId, upsert.item_code, upsert.item_label, upsert.product_cost_id,
           upsert.default_decision, upsert.default_entry_type,
           upsert.items_per_box, upsert.subdivision_unit],
        );
      }

      await client.query('COMMIT');
      created.push({ line_no: line.line_no, cost_entry_id: entryId });
    } catch (err) {
      await client.query('ROLLBACK');
      failed.push({ line_no: line.line_no, error: err instanceof Error ? err.message : '확정 실패' });
    } finally {
      client.release();
    }
  }

  // 남은 줄이 없으면 초안을 완료로 표시한다
  const { rows: remaining } = await pool.query(
    `SELECT count(*)::int AS n FROM receipt_draft_lines
     WHERE draft_id = $1 AND decision = 'ingest' AND cost_entry_id IS NULL`,
    [id],
  );
  if (remaining[0].n === 0) {
    await pool.query(`UPDATE receipt_drafts SET status = 'done', updated_at = now() WHERE id = $1`, [id]);
  }

  return NextResponse.json({ success: true, data: { created, skipped, failed } });
}
```

- [ ] **Step 2: 타입 검사**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit
```

`buildEntryPayload`의 오버로드 때문에 `payload.quantity` 접근에 좁히기가 필요할 수 있다. **테스트가 아니라 코드 쪽에서 해결하라** — `in` 연산자 좁히기가 위 초안의 방식이다.

- [ ] **Step 3: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add "src/app/api/receipts/[id]/confirm/route.ts" && \
git commit -m "feat(receipt): 확정 API — 줄 단위 멱등 입고 생성과 매핑 학습" -- "src/app/api/receipts/[id]/confirm/route.ts"
```

---

## Task 6: cron 판독 라우트

**Files:**
- Create: `src/app/api/cron/parse-receipts/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: 라우트 작성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extractReceipt } from '@/lib/receipt/extract';
import { verifyReceipt } from '@/lib/receipt/verify';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { applyMappings, type ItemMapRow } from '@/lib/receipt/mapping';
import type { AllowedMimeType } from '@/lib/ai/claude-vision';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

/**
 * 판독 1회가 12~14초. 3건이면 최대 42초라 60초 안에 들어간다.
 * 기존 라우트들도 같은 방식으로 선언한다 (예: image/composite = 60)
 */
export const maxDuration = 60;

/** 한 회차에 처리할 상한. maxDuration 60초에서 역산했다 */
const MAX_PER_RUN = 3;
/** 죽은 실행이 묶어둔 초안을 회수하는 기준 */
const STUCK_MINUTES = 10;
/** 흐릿한 사진 하나가 무한히 돈을 태우지 않게 한다 */
const MAX_ATTEMPTS = 3;

function mimeOf(path: string): AllowedMimeType {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * GET /api/cron/parse-receipts
 *
 * pending 초안을 주워 판독한다. 매장에서 찍고 앱을 닫아도 처리되게 하는 장치다.
 *
 * 동시 실행 방어: UPDATE ... FOR UPDATE SKIP LOCKED로 원자적으로 집는다.
 * 두 번째 실행은 이미 잠긴 행을 건너뛰므로 같은 초안을 두 번 판독하지 않는다.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();
  const results: { id: string; status: string; detail?: string }[] = [];

  for (let i = 0; i < MAX_PER_RUN; i++) {
    // 원자적 claim — pending이거나, parsing인데 오래 묶여 있는 것을 집는다
    const { rows: claimed } = await pool.query(
      `UPDATE receipt_drafts SET
         ocr_status = 'parsing',
         parse_attempts = parse_attempts + 1,
         parse_started_at = now(),
         updated_at = now()
       WHERE id = (
         SELECT id FROM receipt_drafts
         WHERE (
           ocr_status = 'pending'
           OR (ocr_status = 'parsing' AND parse_started_at < now() - interval '${STUCK_MINUTES} minutes')
         )
         AND parse_attempts < ${MAX_ATTEMPTS}
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, user_id, image_paths, parse_attempts`,
      [],
    );

    if (claimed.length === 0) break;
    const draft = claimed[0];

    try {
      const imagePaths = (draft.image_paths ?? []) as string[];
      if (imagePaths.length === 0) throw new Error('이미지가 없습니다.');

      const supabase = getSupabaseServerClient();
      const images: { data: Buffer; mimeType: AllowedMimeType }[] = [];
      for (const path of imagePaths) {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
        if (error || !data) throw new Error(`이미지를 읽지 못했습니다: ${path}`);
        images.push({ data: Buffer.from(await data.arrayBuffer()), mimeType: mimeOf(path) });
      }

      const extracted = await extractReceipt({ images });
      const verify = verifyReceipt(extracted);
      const attributed = attributeDiscounts(extracted.lines);

      const codes = attributed.map((l) => l.item_code).filter((c): c is string => c != null);
      const { rows: maps } = codes.length
        ? await pool.query(
            `SELECT item_code, product_cost_id, default_decision, default_entry_type,
                    items_per_box, subdivision_unit
             FROM costco_item_map WHERE user_id = $1 AND item_code = ANY($2)`,
            [draft.user_id, codes],
          )
        : { rows: [] };
      const draftLines = applyMappings(attributed, maps as ItemMapRow[]);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // 회수된 초안일 수 있으므로 기존 줄을 지우고 다시 넣는다
        await client.query(`DELETE FROM receipt_draft_lines WHERE draft_id = $1`, [draft.id]);
        await client.query(
          `UPDATE receipt_drafts SET
             purchased_at=$2, purchased_time=$3, register_no=$4, store_name=$5,
             receipt_total=$6, total_item_count=$7,
             tax_exempt_total=$8, taxable_total=$9, vat=$10,
             verify_status=$11, verify_detail=$12, ocr_status='parsed', raw_ocr=$13, updated_at=now()
           WHERE id=$1`,
          [draft.id, extracted.purchased_at, extracted.purchased_time, extracted.register_no,
           extracted.store_name, extracted.receipt_total, extracted.total_item_count,
           extracted.tax_exempt_total, extracted.taxable_total, extracted.vat,
           verify.status, JSON.stringify(verify), JSON.stringify(extracted)],
        );
        const idByLineNo = new Map<number, string>();
        for (const row of draftLines) {
          const { rows } = await client.query(
            `INSERT INTO receipt_draft_lines
               (draft_id,line_no,item_code,item_label,quantity,unit_price,amount,
                is_discount,tax_type,decision,product_cost_id,entry_type,items_per_box,subdivision_unit)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [draft.id, row.line_no, row.item_code, row.item_label, row.quantity, row.unit_price,
             row.amount, row.is_discount, row.tax_type, row.decision, row.product_cost_id,
             row.entry_type, row.items_per_box, row.subdivision_unit],
          );
          idByLineNo.set(row.line_no, rows[0].id);
        }
        for (const row of draftLines) {
          if (row.applies_to_line_no == null) continue;
          const targetId = idByLineNo.get(row.applies_to_line_no);
          if (!targetId) continue;
          await client.query(
            `UPDATE receipt_draft_lines SET applies_to_line_id=$1 WHERE draft_id=$2 AND line_no=$3`,
            [targetId, draft.id, row.line_no],
          );
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      results.push({ id: draft.id, status: verify.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '판독 실패';
      // 시도 상한에 닿으면 failed로 못 박는다. 아니면 pending으로 되돌려 다음 회차를 노린다
      const next = draft.parse_attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      await pool.query(
        `UPDATE receipt_drafts SET ocr_status = $2, updated_at = now() WHERE id = $1`,
        [draft.id, next],
      );
      results.push({ id: draft.id, status: next, detail: msg });
    }
  }

  return NextResponse.json({ success: true, data: { processed: results.length, results } });
}
```

> **`failed`는 cron이 다시 집지 않는다.** claim 쿼리가 `pending`과 오래된 `parsing`만 본다. 재시도는 사람이 명시적으로 `pending`으로 되돌려야 하며, 그 경로는 4편에서 만든다.

- [ ] **Step 2: `vercel.json`에 등록**

`crons` 배열에 아래를 추가한다. 기존 11개는 건드리지 마라.

```json
{ "path": "/api/cron/parse-receipts", "schedule": "*/10 * * * *" }
```

10분 주기다. 매장에서 찍고 집에 오는 동안 처리된다. 더 자주 돌 이유가 없다 — 초안이 없으면 claim 쿼리 한 번으로 끝난다.

- [ ] **Step 3: 타입 검사·린트**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit
cd /Users/seungminlee/dev/smart_seller_studio && npx eslint src/app/api/cron/parse-receipts
```

- [ ] **Step 4: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/app/api/cron/parse-receipts/route.ts vercel.json && \
git commit -m "feat(receipt): cron 판독 — 원자적 claim과 재시도 상한" -- src/app/api/cron/parse-receipts/route.ts vercel.json
```

---

## Task 7: 회귀 + 실물을 진짜 입고로

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 신규 모듈 테스트**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx vitest run src/lib/receipt src/lib/cost-management
```
Expected: 기존 통과분 + 확정 15건

- [ ] **Step 2: 전체 회귀**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx vitest run
```
Expected: **14 failed**에서 늘지 않아야 한다. 특히 `src/lib/cost-management` 쪽이 Task 4 리팩터로 깨지지 않았는지 본다.

- [ ] **Step 3: 타입·린트**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit && echo "tsc OK"
cd /Users/seungminlee/dev/smart_seller_studio && npx eslint src/lib/receipt src/lib/cost-management src/app/api/receipts src/app/api/cron/parse-receipts && echo "eslint OK"
```

- [ ] **Step 4: 마이그레이션 102 적용 (사람 판단)**

여기까지 통과하면 사람에게 보고하고 승인을 받아 적용한다. **에이전트가 임의로 적용하지 마라.**

- [ ] **Step 5: 실물 영수증을 진짜 입고로**

마이그레이션 적용 후, 오늘 촬영한 영수증(`/private/tmp/IMG_3461.JPG`)을 파이프라인에 넣고 **확정까지** 돌린다. 확인할 것:

| 확인 | 기대 |
|---|---|
| `cost_entries` 증가분 | 확정한 줄 수만큼 |
| `source_receipt_line_id` | 전부 채워짐 |
| 할인 줄의 단가 반영 | 라운드티가 32,990이 아니라 **25,990** |
| 같은 줄 두 번 확정 | 두 번째는 `already_confirmed`로 건너뜀, `cost_entries` 안 늘어남 |
| `costco_item_map` | 확정한 품번만큼 행 생성, `times_used = 1` |
| 재확정 시 학습 | `times_used`가 2로 증가 |

**할인 단가 확인이 이번 편의 핵심이다.** 32,990이 들어가면 원가가 21% 부풀려진 것이고, 1편의 `entry-payload` 회귀 테스트가 실제 경로에서는 안 지켜졌다는 뜻이다.

검증 후 만든 데이터는 정리한다 — `cost_entries`는 실제 회계 데이터이므로 테스트 산출물을 남기지 않는다.

---

## 완료 기준

| 항목 | 확인 |
|---|---|
| 영수증 줄이 실제 입고가 된다 | `cost_entries` 증가 |
| 할인이 원가에 반영된다 | 25,990원 |
| 같은 줄이 두 번 입고되지 않는다 | 2회 호출 후에도 1건 |
| 확정한 품번을 기억한다 | `costco_item_map` 생성 |
| 앱을 닫아도 판독된다 | cron이 `pending`을 처리 |
| cron 두 번이 겹쳐도 안전하다 | claim 쿼리의 `SKIP LOCKED` |
| 기존 입고 API가 그대로다 | Task 4 전후 테스트 개수 동일 |

**아직 없는 것** — 화면, 조회 API, 줄 수정 API, `failed` 재시도 경로. 4편에서 만든다.

## Open Questions

- ~~Vercel 함수 수명~~ — **닫힘.** `src/app/api/image/composite/route.ts:8` 등이 이미 `maxDuration = 60`을 선언하고 동작하므로 Hobby 플랜(10초)이 아니다. 판독 3건 42초는 60초 안에 들어간다
- **`failed` 재시도 UI** — 4편에서 만들되, 재시도가 `parse_attempts`를 0으로 되돌릴지 그대로 둘지 정해야 한다
- **이미지 보관 기간** — 공개 버킷에 두기로 한 만큼(스펙 §7) 오래 남길수록 노출 창이 길어진다. 확정 후 N개월 정책이 필요한지
