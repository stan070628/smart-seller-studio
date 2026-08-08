# 코스트코 영수증 자동 입고 — 1편: 스키마와 순수 로직

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영수증 추출 결과를 검산하고 할인을 귀속시켜 입고 페이로드로 바꾸는 순수 함수 계층과, 그것을 담을 DB 스키마를 만든다.

**Architecture:** 외부 의존(모델 호출·DB·화면)이 전혀 없는 순수 함수로 시작한다. 스펙 §9-3이 "검산 로직이 테스트로 굳어 있으면 OCR을 어떻게 바꾸든 정확도 기준이 흔들리지 않는다"고 정한 순서다. 실제 코스트코 영수증 2장에서 뽑은 값을 테스트 데이터로 쓴다.

**Tech Stack:** TypeScript · vitest · PostgreSQL (Supabase)

**Spec:** `docs/superpowers/specs/2026-08-08-costco-receipt-ingest-design.md`

**후속 계획:** 2편 API 계층(업로드·Vision 추출·확정) · 3편 화면(`/m/receipt` + 데스크톱)

---

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/101_receipt_ingest.sql` | 신규 3테이블 + `cost_entries` 컬럼 |
| `src/lib/receipt/types.ts` | 추출 결과 타입. 다른 모듈이 전부 여기에 의존 |
| `src/lib/receipt/verify.ts` | 검산 4종 (스펙 §5-6) |
| `src/lib/receipt/discount.ts` | 할인 귀속 (스펙 §5-7) |
| `src/lib/receipt/entry-payload.ts` | 확정 시 입고 API 페이로드 생성 |
| `src/lib/receipt/pack-size.ts` | 상품명에서 포장 수량 추출 (스펙 §6-3-1) |
| `src/lib/receipt/__tests__/fixtures.ts` | 실제 영수증 2장의 추출 결과 |

`src/lib/receipt/`를 새로 만든다. 기존 `src/lib/cost-management/`는 입고 계산을 담당하고, 영수증 판독은 별개 관심사다. 확정 단계에서만 두 모듈이 만난다.

---

## Task 1: 마이그레이션

**Files:**
- Create: `supabase/migrations/101_receipt_ingest.sql`

> **이 저장소의 마이그레이션은 자동 적용되지 않는다.** `076_product_sourcing_costco_stock.sql` 주석이 "DB에 직접 적용됨. 아래 SQL은 참고용"이라고 명시한다. 파일을 만든 뒤 Supabase 대시보드 SQL Editor에서 직접 실행한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 코스트코 영수증 자동 입고
-- spec docs/superpowers/specs/2026-08-08-costco-receipt-ingest-design.md §4
--
-- 적용: Supabase 대시보드 SQL Editor에서 직접 실행한다.

-- ── 영수증 1장 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipt_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  image_paths      text[] NOT NULL DEFAULT '{}',
  purchased_at     date,
  purchased_time   time,
  register_no      text,
  store_name       text,
  receipt_total    int,
  total_item_count int,
  tax_exempt_total int,
  taxable_total    int,
  vat              int,
  verify_status    text NOT NULL DEFAULT 'unreadable'
                     CHECK (verify_status IN ('matched','mismatch','unreadable')),
  verify_detail    jsonb,
  ocr_status       text NOT NULL DEFAULT 'pending'
                     CHECK (ocr_status IN ('pending','parsed','failed')),
  raw_ocr          jsonb,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','done','discarded')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_drafts_user
  ON receipt_drafts (user_id, created_at DESC);

-- 중복 의심 판정용. 날짜+금액만으로는 오탐이 난다 (spec §7)
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_dup
  ON receipt_drafts (user_id, purchased_at, purchased_time, register_no, receipt_total);

-- ── 품목 1줄 = 확정 단위 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipt_draft_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id           uuid NOT NULL REFERENCES receipt_drafts(id) ON DELETE CASCADE,
  line_no            int NOT NULL,
  item_code          text,
  item_label         text NOT NULL,
  quantity           numeric(10,2) NOT NULL,
  unit_price         int,
  amount             int NOT NULL,
  is_discount        boolean NOT NULL DEFAULT false,
  applies_to_line_id uuid REFERENCES receipt_draft_lines(id) ON DELETE SET NULL,
  tax_type           text NOT NULL DEFAULT 'unknown'
                       CHECK (tax_type IN ('taxable','exempt','unknown')),
  decision           text NOT NULL DEFAULT 'pending'
                       CHECK (decision IN ('pending','ingest','skip')),
  product_cost_id    uuid REFERENCES product_costs(id) ON DELETE SET NULL,
  entry_type         text CHECK (entry_type IN ('normal','subdivision')),
  items_per_box      int,
  subdivision_unit   int,
  cost_entry_id      uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- line_no는 확정 순서를 결정하므로 영수증 안에서 유일해야 한다
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_draft_lines_no
  ON receipt_draft_lines (draft_id, line_no);

-- ── 학습형 매핑 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS costco_item_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  item_code          text NOT NULL,
  item_label         text,
  product_cost_id    uuid REFERENCES product_costs(id) ON DELETE SET NULL,
  default_decision   text NOT NULL DEFAULT 'ask'
                       CHECK (default_decision IN ('ingest','skip','ask')),
  default_entry_type text CHECK (default_entry_type IN ('normal','subdivision')),
  items_per_box      int,
  subdivision_unit   int,
  times_used         int NOT NULL DEFAULT 0,
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_costco_item_map_code
  ON costco_item_map (user_id, item_code);

-- ── 역추적 ────────────────────────────────────────────────────
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS source_receipt_line_id uuid;

CREATE INDEX IF NOT EXISTS idx_cost_entries_source_receipt
  ON cost_entries (source_receipt_line_id)
  WHERE source_receipt_line_id IS NOT NULL;

COMMENT ON TABLE receipt_drafts IS '코스트코 영수증 초안. spec 2026-08-08';
COMMENT ON TABLE receipt_draft_lines IS '영수증 품목 1줄. 확정 단위. spec 2026-08-08';
COMMENT ON TABLE costco_item_map IS '코스트코 품번 → 판매상품 학습형 매핑. spec 2026-08-08';
```

- [ ] **Step 2: SQL 문법 검증**

Run: `psql "$SOURCING_DATABASE_URL" -f supabase/migrations/101_receipt_ingest.sql`
Expected: `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE` / `COMMENT` 출력, 오류 없음

`psql`이 없으면 Supabase 대시보드 SQL Editor에 파일 내용을 붙여넣어 실행한다.

- [ ] **Step 3: 재실행해도 안전한지 확인 (멱등성)**

Run: 같은 명령을 한 번 더 실행
Expected: 오류 없음. 모든 문장이 `IF NOT EXISTS`이므로 아무것도 바뀌지 않는다

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/101_receipt_ingest.sql
git commit -m "feat(receipt): 영수증 자동 입고 스키마 3테이블 추가"
```

---

## Task 2: 타입 정의

**Files:**
- Create: `src/lib/receipt/types.ts`

- [ ] **Step 1: 타입 작성**

```typescript
/**
 * 영수증 추출 결과 타입.
 * spec §5-4의 Vision 추출 계약과 1:1 대응한다.
 */

/** 과세 구분. 코스트코 영수증은 과세 상품 금액 뒤에 T를 붙인다 */
export type TaxType = 'taxable' | 'exempt' | 'unknown';

/** 추출된 품목 1줄. 품목과 할인이 같은 타입을 쓴다 */
export interface ExtractedLine {
  /** 영수증 상의 순서. 확정 순서를 결정하므로 1부터 연속이어야 한다 */
  line_no: number;
  /** 코스트코 품번. 5~7자리 가변. 봉투값 등 품번 없는 줄은 null */
  item_code: string | null;
  item_label: string;
  quantity: number;
  /** 단가. 줄 검산의 근거 */
  unit_price: number | null;
  /** 금액. 할인 줄은 음수 */
  amount: number;
  /** CPN 할인 줄 여부 */
  is_discount: boolean;
  tax_type: TaxType;
}

/** 영수증 1장의 추출 결과 */
export interface ExtractedReceipt {
  store_name: string | null;
  /** YYYY-MM-DD. 영수증에는 MM/DD/YYYY로 찍힌다 */
  purchased_at: string | null;
  /** HH:MM */
  purchased_time: string | null;
  /** "REG:8"의 8 */
  register_no: string | null;
  /** 합계 (VAT 포함) */
  receipt_total: number | null;
  /** 총 판매 상품수. 줄 수가 아니라 수량 합계다 */
  total_item_count: number | null;
  tax_exempt_total: number | null;
  taxable_total: number | null;
  vat: number | null;
  lines: ExtractedLine[];
}
```

- [ ] **Step 2: 타입 검사 통과 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/receipt/types.ts
git commit -m "feat(receipt): 영수증 추출 결과 타입 정의"
```

---

## Task 3: 실제 영수증 fixture

**Files:**
- Create: `src/lib/receipt/__tests__/fixtures.ts`

2026-08-08에 실제 코스트코 양재점 영수증 2장을 촬영해 `claude-opus-5`로 추출한 결과다. 검산 4종이 전부 통과한 값이라 회귀 기준선이 된다.

- [ ] **Step 1: fixture 작성**

```typescript
import type { ExtractedReceipt } from '@/lib/receipt/types';

/**
 * 실제 코스트코 영수증 추출 결과 (2026-08-08 양재점).
 * 검산 4종이 전부 통과한 값이므로 회귀 기준선으로 쓴다.
 */

/** 3품목, PRESCAN 구간, 같은 품번 2줄(693817) */
export const RECEIPT_A: ExtractedReceipt = {
  store_name: '코스트코 코리아 양재점',
  purchased_at: '2026-08-08',
  purchased_time: '09:05',
  register_no: '8',
  receipt_total: 587630,
  total_item_count: 19,
  tax_exempt_total: 0,
  taxable_total: 534209,
  vat: 53421,
  lines: [
    { line_no: 1, item_code: '713160', item_label: 'KS노랑타월36CT', quantity: 17, unit_price: 23990, amount: 407830, is_discount: false, tax_type: 'taxable' },
    { line_no: 2, item_code: '693817', item_label: '콜맨웨건', quantity: 1, unit_price: 89900, amount: 89900, is_discount: false, tax_type: 'taxable' },
    { line_no: 3, item_code: '693817', item_label: '콜맨웨건', quantity: 1, unit_price: 89900, amount: 89900, is_discount: false, tax_type: 'taxable' },
  ],
};

/** 13품목, CPN 할인 2건, 면세 2건, 상품수 소계 3그룹, 같은 품번 2줄(690437) */
export const RECEIPT_B: ExtractedReceipt = {
  store_name: '코스트코 코리아 양재점',
  purchased_at: '2026-08-08',
  purchased_time: '10:16',
  register_no: '17',
  receipt_total: 724310,
  total_item_count: 29,
  tax_exempt_total: 26280,
  taxable_total: 634572,
  vat: 63458,
  lines: [
    { line_no: 1, item_code: '690437', item_label: '아이더호보백', quantity: 9, unit_price: 29990, amount: 269910, is_discount: false, tax_type: 'taxable' },
    { line_no: 2, item_code: '7771922', item_label: 'KS라운드티6매 L', quantity: 5, unit_price: 32990, amount: 164950, is_discount: false, tax_type: 'taxable' },
    { line_no: 3, item_code: '16612', item_label: 'KS 라운드티IRC', quantity: 5, unit_price: 7000, amount: -35000, is_discount: true, tax_type: 'taxable' },
    { line_no: 4, item_code: '7771923', item_label: 'KS라운드티6매XL', quantity: 5, unit_price: 32990, amount: 164950, is_discount: false, tax_type: 'taxable' },
    { line_no: 5, item_code: '16612', item_label: 'KS 라운드티IRC', quantity: 5, unit_price: 7000, amount: -35000, is_discount: true, tax_type: 'taxable' },
    { line_no: 6, item_code: '693791', item_label: '위트빅스프로틴', quantity: 1, unit_price: 14990, amount: 14990, is_discount: false, tax_type: 'taxable' },
    { line_no: 7, item_code: '674362', item_label: 'SEOUL A2+우유2.3', quantity: 1, unit_price: 7590, amount: 7590, is_discount: false, tax_type: 'exempt' },
    { line_no: 8, item_code: '660234', item_label: '소금버터빵 6CT', quantity: 1, unit_price: 11990, amount: 11990, is_discount: false, tax_type: 'taxable' },
    { line_no: 9, item_code: '301904', item_label: 'KS M.쇼비뇽블랑', quantity: 1, unit_price: 11290, amount: 11290, is_discount: false, tax_type: 'taxable' },
    { line_no: 10, item_code: '695917', item_label: '라비오라워시팩', quantity: 3, unit_price: 24990, amount: 74970, is_discount: false, tax_type: 'taxable' },
    { line_no: 11, item_code: '637146', item_label: '동물복지란60개', quantity: 1, unit_price: 18690, amount: 18690, is_discount: false, tax_type: 'exempt' },
    { line_no: 12, item_code: '690437', item_label: '아이더호보백', quantity: 1, unit_price: 29990, amount: 29990, is_discount: false, tax_type: 'taxable' },
    { line_no: 13, item_code: '692519', item_label: 'YALE남성 후디', quantity: 1, unit_price: 24990, amount: 24990, is_discount: false, tax_type: 'taxable' },
  ],
};
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/receipt/__tests__/fixtures.ts
git commit -m "test(receipt): 실제 코스트코 영수증 2장 fixture 추가"
```

---

## Task 4: 검산 1·2 — 총액 합계와 줄별 산술

**Files:**
- Create: `src/lib/receipt/verify.ts`
- Test: `src/lib/receipt/__tests__/verify.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
import { describe, it, expect } from 'vitest';
import { checkTotalSum, checkLineArithmetic } from '@/lib/receipt/verify';
import { RECEIPT_A, RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

describe('checkTotalSum — 품목 금액 합 = 결제 총액', () => {
  it('영수증 A는 통과한다', () => {
    const r = checkTotalSum(RECEIPT_A);
    expect(r.status).toBe('pass');
    expect(r.actual).toBe(587630);
    expect(r.expected).toBe(587630);
  });

  it('영수증 B는 할인 음수를 포함해 통과한다', () => {
    const r = checkTotalSum(RECEIPT_B);
    expect(r.status).toBe('pass');
    expect(r.actual).toBe(724310);
  });

  it('금액이 하나 틀리면 차액과 함께 실패한다', () => {
    const broken = {
      ...RECEIPT_A,
      lines: RECEIPT_A.lines.map((l) => (l.line_no === 1 ? { ...l, amount: 40783 } : l)),
    };
    const r = checkTotalSum(broken);
    expect(r.status).toBe('fail');
    expect(r.diff).toBe(-367047); // 220583 - 587630
  });

  it('결제 총액을 못 읽었으면 건너뛴다', () => {
    const r = checkTotalSum({ ...RECEIPT_A, receipt_total: null });
    expect(r.status).toBe('skipped');
  });
});

describe('checkLineArithmetic — 수량 × 단가 = 금액', () => {
  it('영수증 A는 3줄 전부 통과한다', () => {
    const r = checkLineArithmetic(RECEIPT_A);
    expect(r.status).toBe('pass');
    expect(r.badLineNos).toEqual([]);
  });

  it('영수증 B는 할인 줄(음수)도 절대값으로 통과한다', () => {
    const r = checkLineArithmetic(RECEIPT_B);
    expect(r.status).toBe('pass');
    expect(r.badLineNos).toEqual([]);
  });

  it('틀린 줄의 번호를 짚어준다', () => {
    const broken = {
      ...RECEIPT_B,
      lines: RECEIPT_B.lines.map((l) => (l.line_no === 10 ? { ...l, unit_price: 2499 } : l)),
    };
    const r = checkLineArithmetic(broken);
    expect(r.status).toBe('fail');
    expect(r.badLineNos).toEqual([10]);
  });

  it('단가를 못 읽은 줄은 검사에서 제외한다', () => {
    const partial = {
      ...RECEIPT_A,
      lines: RECEIPT_A.lines.map((l) => (l.line_no === 2 ? { ...l, unit_price: null } : l)),
    };
    const r = checkLineArithmetic(partial);
    expect(r.status).toBe('pass');
    expect(r.badLineNos).toEqual([]);
  });

  it('검사할 줄이 하나도 없으면 건너뛴다', () => {
    const none = {
      ...RECEIPT_A,
      lines: RECEIPT_A.lines.map((l) => ({ ...l, unit_price: null })),
    };
    expect(checkLineArithmetic(none).status).toBe('skipped');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/receipt/__tests__/verify.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/verify"`

- [ ] **Step 3: 최소 구현 작성**

```typescript
import type { ExtractedReceipt } from '@/lib/receipt/types';

/**
 * 검산 4종 (spec §5-6).
 *
 * 코스트코 영수증은 자체 검산 장치를 넷 들고 있다. 전부 쓴다 —
 * Vision 단독 추출의 유일한 약점이 숫자 오독이고, 이것이 방어선이다.
 */

export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface CheckResult {
  status: CheckStatus;
  /** 영수증이 스스로 주장하는 기준값 */
  expected: number | null;
  /** 품목에서 계산한 값 */
  actual: number | null;
  /** actual - expected */
  diff: number | null;
  /** 줄 단위 검사에서 어긋난 줄 번호 */
  badLineNos?: number[];
}

function skipped(): CheckResult {
  return { status: 'skipped', expected: null, actual: null, diff: null };
}

/**
 * 검산 1 — 품목 금액의 합이 결제 총액과 같은가.
 * 할인 줄은 음수이므로 단순 합으로 성립한다.
 */
export function checkTotalSum(receipt: ExtractedReceipt): CheckResult {
  if (receipt.receipt_total == null) return skipped();

  const actual = receipt.lines.reduce((sum, l) => sum + l.amount, 0);
  const expected = receipt.receipt_total;
  const diff = actual - expected;

  return { status: diff === 0 ? 'pass' : 'fail', expected, actual, diff };
}

/**
 * 검산 2 — 줄마다 수량 × 단가가 금액과 같은가.
 *
 * 나머지 검산과 질적으로 다르다. 1·3·4는 "어딘가 틀렸다"까지만 알려주지만
 * 이 검사는 틀린 줄을 특정해준다. 단가를 못 읽은 줄은 검사 대상에서 뺀다.
 */
export function checkLineArithmetic(receipt: ExtractedReceipt): CheckResult {
  const checkable = receipt.lines.filter((l) => l.unit_price != null);
  if (checkable.length === 0) return skipped();

  const badLineNos = checkable
    .filter((l) => Math.round(l.quantity * (l.unit_price as number)) !== Math.abs(l.amount))
    .map((l) => l.line_no);

  return {
    status: badLineNos.length === 0 ? 'pass' : 'fail',
    expected: null,
    actual: null,
    diff: null,
    badLineNos,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/receipt/__tests__/verify.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/verify.ts src/lib/receipt/__tests__/verify.test.ts
git commit -m "feat(receipt): 검산 1·2 — 총액 합계와 줄별 산술"
```

---

## Task 5: 검산 3·4 — 총 상품수와 세금 구분

**Files:**
- Modify: `src/lib/receipt/verify.ts`
- Modify: `src/lib/receipt/__tests__/verify.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`verify.test.ts` 상단 import에 `checkItemCount`, `checkTaxBreakdown`을 추가하고, 파일 끝에 아래를 붙인다.

```typescript
describe('checkItemCount — 수량 합 = 총 판매 상품수', () => {
  it('영수증 A는 17+1+1 = 19로 통과한다', () => {
    const r = checkItemCount(RECEIPT_A);
    expect(r.status).toBe('pass');
    expect(r.actual).toBe(19);
  });

  it('영수증 B는 할인 줄을 빼고 29로 통과한다', () => {
    const r = checkItemCount(RECEIPT_B);
    expect(r.status).toBe('pass');
    expect(r.actual).toBe(29); // 할인 5x 2줄은 제외
  });

  it('할인 줄을 포함하면 틀린다 (회귀 방지)', () => {
    const withDiscounts = RECEIPT_B.lines.reduce((s, l) => s + l.quantity, 0);
    expect(withDiscounts).toBe(39);
    expect(checkItemCount(RECEIPT_B).actual).toBe(29);
  });

  it('수량이 하나 틀리면 실패한다', () => {
    const broken = {
      ...RECEIPT_A,
      lines: RECEIPT_A.lines.map((l) => (l.line_no === 1 ? { ...l, quantity: 7 } : l)),
    };
    const r = checkItemCount(broken);
    expect(r.status).toBe('fail');
    expect(r.diff).toBe(-10);
  });

  it('총 상품수를 못 읽었으면 건너뛴다', () => {
    expect(checkItemCount({ ...RECEIPT_A, total_item_count: null }).status).toBe('skipped');
  });
});

describe('checkTaxBreakdown — 면세 + 과세 + 부가세 = 합계', () => {
  it('영수증 A는 면세 0으로 통과한다', () => {
    expect(checkTaxBreakdown(RECEIPT_A).status).toBe('pass');
  });

  it('영수증 B는 면세 26,280(우유 + 계란)으로 통과한다', () => {
    const r = checkTaxBreakdown(RECEIPT_B);
    expect(r.status).toBe('pass');
    expect(r.actual).toBe(724310);
  });

  it('면세 상품 판정이 틀리면 실패한다', () => {
    const broken = {
      ...RECEIPT_B,
      lines: RECEIPT_B.lines.map((l) => (l.line_no === 7 ? { ...l, tax_type: 'taxable' as const } : l)),
    };
    const r = checkTaxBreakdown(broken);
    expect(r.status).toBe('fail');
    expect(r.badLineNos).toEqual([]); // 어느 줄인지는 특정하지 못한다
  });

  it('세금 항목을 하나라도 못 읽었으면 건너뛴다', () => {
    expect(checkTaxBreakdown({ ...RECEIPT_A, vat: null }).status).toBe('skipped');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/receipt/__tests__/verify.test.ts`
Expected: FAIL — `checkItemCount is not a function`

- [ ] **Step 3: 구현 추가**

`verify.ts` 끝에 붙인다.

```typescript
/**
 * 검산 3 — 품목 수량의 합이 "총 판매 상품수"와 같은가.
 *
 * 총 판매 상품수는 줄 수가 아니라 수량 합계이며, 할인 줄은 여기서 빠진다.
 * 영수증 B에서 실증됐다 — 전체 수량 합은 39이지만 총 판매 상품수는 29다.
 */
export function checkItemCount(receipt: ExtractedReceipt): CheckResult {
  if (receipt.total_item_count == null) return skipped();

  const actual = receipt.lines
    .filter((l) => !l.is_discount)
    .reduce((sum, l) => sum + l.quantity, 0);
  const expected = receipt.total_item_count;
  const diff = actual - expected;

  return { status: diff === 0 ? 'pass' : 'fail', expected, actual, diff };
}

/**
 * 검산 4 — 세금 3종의 합이 결제 총액과 같고, 면세 상품 금액 합이 면세액과 같은가.
 *
 * 두 조건을 함께 본다. 앞은 세 값을 제대로 읽었는지를, 뒤는 줄별 과세 구분이
 * 맞는지를 검사한다. 영수증 B의 면세 26,280원이 우유 7,590 + 계란 18,690으로
 * 정확히 떨어지는 것이 확인됐다.
 */
export function checkTaxBreakdown(receipt: ExtractedReceipt): CheckResult {
  const { tax_exempt_total, taxable_total, vat, receipt_total } = receipt;
  if (tax_exempt_total == null || taxable_total == null || vat == null || receipt_total == null) {
    return skipped();
  }

  const actual = tax_exempt_total + taxable_total + vat;
  const diff = actual - receipt_total;

  const exemptFromLines = receipt.lines
    .filter((l) => l.tax_type === 'exempt')
    .reduce((sum, l) => sum + l.amount, 0);
  const exemptMatches = exemptFromLines === tax_exempt_total;

  return {
    status: diff === 0 && exemptMatches ? 'pass' : 'fail',
    expected: receipt_total,
    actual,
    diff,
    badLineNos: [],
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/receipt/__tests__/verify.test.ts`
Expected: PASS — 18 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/verify.ts src/lib/receipt/__tests__/verify.test.ts
git commit -m "feat(receipt): 검산 3·4 — 총 상품수와 세금 구분"
```

---

## Task 6: 검산 통합 — verifyReceipt

**Files:**
- Modify: `src/lib/receipt/verify.ts`
- Modify: `src/lib/receipt/__tests__/verify.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

import에 `verifyReceipt`를 추가하고 파일 끝에 붙인다.

```typescript
describe('verifyReceipt — 4종 통합 판정', () => {
  it('영수증 A는 matched다', () => {
    const r = verifyReceipt(RECEIPT_A);
    expect(r.status).toBe('matched');
    expect(r.totalSum.status).toBe('pass');
    expect(r.lineArithmetic.status).toBe('pass');
    expect(r.itemCount.status).toBe('pass');
    expect(r.taxBreakdown.status).toBe('pass');
  });

  it('영수증 B는 matched다', () => {
    expect(verifyReceipt(RECEIPT_B).status).toBe('matched');
  });

  it('하나라도 fail이면 mismatch다', () => {
    const broken = {
      ...RECEIPT_A,
      lines: RECEIPT_A.lines.map((l) => (l.line_no === 1 ? { ...l, amount: 40783 } : l)),
    };
    expect(verifyReceipt(broken).status).toBe('mismatch');
  });

  it('기준값이 전부 없으면 unreadable이다', () => {
    const blank = {
      ...RECEIPT_A,
      receipt_total: null,
      total_item_count: null,
      tax_exempt_total: null,
      taxable_total: null,
      vat: null,
      lines: RECEIPT_A.lines.map((l) => ({ ...l, unit_price: null })),
    };
    expect(verifyReceipt(blank).status).toBe('unreadable');
  });

  it('일부만 건너뛰고 나머지가 통과하면 matched다', () => {
    const partial = { ...RECEIPT_A, total_item_count: null };
    const r = verifyReceipt(partial);
    expect(r.status).toBe('matched');
    expect(r.itemCount.status).toBe('skipped');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/receipt/__tests__/verify.test.ts`
Expected: FAIL — `verifyReceipt is not a function`

- [ ] **Step 3: 구현 추가**

`verify.ts` 끝에 붙인다.

```typescript
export type VerifyStatus = 'matched' | 'mismatch' | 'unreadable';

export interface VerifyResult {
  status: VerifyStatus;
  totalSum: CheckResult;
  lineArithmetic: CheckResult;
  itemCount: CheckResult;
  taxBreakdown: CheckResult;
}

/**
 * 검산 4종을 모두 돌려 종합 판정을 낸다.
 *
 * 판정 규칙:
 *   하나라도 fail  → mismatch
 *   전부 skipped   → unreadable (읽은 게 없어 검증 자체가 불가능)
 *   그 외          → matched
 *
 * mismatch라고 확정을 막지는 않는다. 봉투값 하나 때문에 기능 전체가 잠기면
 * 아무도 쓰지 않는다. 막는 것이 아니라 보이게 하는 것이 목적이다 (spec §5-6).
 */
export function verifyReceipt(receipt: ExtractedReceipt): VerifyResult {
  const totalSum = checkTotalSum(receipt);
  const lineArithmetic = checkLineArithmetic(receipt);
  const itemCount = checkItemCount(receipt);
  const taxBreakdown = checkTaxBreakdown(receipt);

  const all = [totalSum, lineArithmetic, itemCount, taxBreakdown];

  let status: VerifyStatus;
  if (all.some((c) => c.status === 'fail')) {
    status = 'mismatch';
  } else if (all.every((c) => c.status === 'skipped')) {
    status = 'unreadable';
  } else {
    status = 'matched';
  }

  return { status, totalSum, lineArithmetic, itemCount, taxBreakdown };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/receipt/__tests__/verify.test.ts`
Expected: PASS — 23 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/verify.ts src/lib/receipt/__tests__/verify.test.ts
git commit -m "feat(receipt): 검산 4종 통합 판정 verifyReceipt"
```

---

## Task 7: 할인 귀속

**Files:**
- Create: `src/lib/receipt/discount.ts`
- Test: `src/lib/receipt/__tests__/discount.test.ts`

할인 줄은 원 품목과 품번도 상품명도 다르다. 잇는 단서는 "바로 앞 줄"이라는 위치뿐이다. 귀속하지 않으면 매입가가 할인 전 금액이 된다 (spec §5-7).

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
import { describe, it, expect } from 'vitest';
import { attributeDiscounts, netAmountOf } from '@/lib/receipt/discount';
import { RECEIPT_A, RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

describe('attributeDiscounts', () => {
  it('할인 줄을 직전 비할인 줄에 연결한다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(lines.find((l) => l.line_no === 3)?.applies_to_line_no).toBe(2);
    expect(lines.find((l) => l.line_no === 5)?.applies_to_line_no).toBe(4);
  });

  it('비할인 줄의 귀속 대상은 null이다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(lines.find((l) => l.line_no === 2)?.applies_to_line_no).toBeNull();
  });

  it('할인이 없는 영수증은 전부 null이다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    expect(lines.every((l) => l.applies_to_line_no === null)).toBe(true);
  });

  it('첫 줄이 할인이면 귀속 대상이 없어 null로 둔다', () => {
    const orphan = [
      { line_no: 1, item_code: '16612', item_label: 'CPN', quantity: 1, unit_price: 1000, amount: -1000, is_discount: true, tax_type: 'taxable' as const },
    ];
    expect(attributeDiscounts(orphan)[0].applies_to_line_no).toBeNull();
  });

  it('할인 줄 다음의 할인 줄도 같은 품목에 붙는다', () => {
    const twoDiscounts = [
      { line_no: 1, item_code: 'A', item_label: '상품', quantity: 1, unit_price: 10000, amount: 10000, is_discount: false, tax_type: 'taxable' as const },
      { line_no: 2, item_code: 'C1', item_label: '쿠폰1', quantity: 1, unit_price: 1000, amount: -1000, is_discount: true, tax_type: 'taxable' as const },
      { line_no: 3, item_code: 'C2', item_label: '쿠폰2', quantity: 1, unit_price: 2000, amount: -2000, is_discount: true, tax_type: 'taxable' as const },
    ];
    const lines = attributeDiscounts(twoDiscounts);
    expect(lines[1].applies_to_line_no).toBe(1);
    expect(lines[2].applies_to_line_no).toBe(1);
  });
});

describe('netAmountOf — 할인 반영 금액', () => {
  it('할인이 붙은 품목은 차감된 금액을 낸다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(netAmountOf(lines, 2)).toBe(129950); // 164,950 - 35,000
    expect(netAmountOf(lines, 4)).toBe(129950);
  });

  it('할인이 없는 품목은 원래 금액 그대로다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(netAmountOf(lines, 1)).toBe(269910);
  });

  it('할인이 두 건 붙으면 모두 차감한다', () => {
    const twoDiscounts = attributeDiscounts([
      { line_no: 1, item_code: 'A', item_label: '상품', quantity: 1, unit_price: 10000, amount: 10000, is_discount: false, tax_type: 'taxable' as const },
      { line_no: 2, item_code: 'C1', item_label: '쿠폰1', quantity: 1, unit_price: 1000, amount: -1000, is_discount: true, tax_type: 'taxable' as const },
      { line_no: 3, item_code: 'C2', item_label: '쿠폰2', quantity: 1, unit_price: 2000, amount: -2000, is_discount: true, tax_type: 'taxable' as const },
    ]);
    expect(netAmountOf(twoDiscounts, 1)).toBe(7000);
  });

  it('없는 줄 번호를 물으면 0을 낸다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    expect(netAmountOf(lines, 999)).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/receipt/__tests__/discount.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/discount"`

- [ ] **Step 3: 구현 작성**

```typescript
import type { ExtractedLine } from '@/lib/receipt/types';

/**
 * 할인 귀속 (spec §5-7).
 *
 * 추출 단계에서는 할인을 독립 줄로 둔다 — 할인 줄이 원 품목과 다른 품번·상품명을
 * 갖기 때문에, 모델에게 합치게 하면 틀린 귀속이 조용히 섞인다. 대신 여기서
 * 위치 기반으로 귀속을 제안하고, 사람이 검토 화면에서 확인한다.
 */

export interface AttributedLine extends ExtractedLine {
  /** 이 할인 줄이 귀속되는 품목 줄의 line_no. 품목 줄이면 null */
  applies_to_line_no: number | null;
}

/**
 * 할인 줄을 직전 비할인 줄에 연결한다.
 * 앞에 품목 줄이 없으면 null로 둔다 — 귀속할 곳이 없다는 사실 자체를 남긴다.
 */
export function attributeDiscounts(lines: ExtractedLine[]): AttributedLine[] {
  let lastItemLineNo: number | null = null;

  return lines.map((line) => {
    if (!line.is_discount) {
      lastItemLineNo = line.line_no;
      return { ...line, applies_to_line_no: null };
    }
    return { ...line, applies_to_line_no: lastItemLineNo };
  });
}

/**
 * 품목 줄의 할인 반영 금액.
 *
 * 단가 차감이 아니라 금액 합산으로 계산한다. 확인된 쿠폰은 원 품목과 수량이
 * 같았지만(5x ↔ 5x), 수량이 다르거나 정액인 할인 형태를 아직 못 봤다.
 * 금액 합산이면 어떤 형태가 와도 성립한다.
 */
export function netAmountOf(lines: AttributedLine[], lineNo: number): number {
  const target = lines.find((l) => l.line_no === lineNo && !l.is_discount);
  if (!target) return 0;

  const discounts = lines
    .filter((l) => l.is_discount && l.applies_to_line_no === lineNo)
    .reduce((sum, l) => sum + l.amount, 0);

  return target.amount + discounts;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/receipt/__tests__/discount.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/discount.ts src/lib/receipt/__tests__/discount.test.ts
git commit -m "feat(receipt): CPN 할인 자동 귀속과 할인 반영 금액 계산"
```

---

## Task 8: 입고 페이로드 생성

**Files:**
- Create: `src/lib/receipt/entry-payload.ts`
- Test: `src/lib/receipt/__tests__/entry-payload.test.ts`

기존 `POST /api/cost-management/products/[id]/entries`가 받는 형태로 변환한다. 소분 계산과 이월 갱신은 그 API가 이미 하므로 여기서 다시 만들지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
import { describe, it, expect } from 'vitest';
import { buildEntryPayload } from '@/lib/receipt/entry-payload';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { calculateSubdivision } from '@/lib/cost-management/subdivision';
import { RECEIPT_A, RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

describe('buildEntryPayload — 일반 입고', () => {
  it('할인이 붙은 품목은 차감된 단가를 낸다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    const payload = buildEntryPayload({
      lines,
      lineNo: 2,
      receivedAt: '2026-08-08',
      entryType: 'normal',
    });
    // (164,950 - 35,000) / 5 = 25,990
    expect(payload).toEqual({
      received_at: '2026-08-08',
      quantity: 5,
      unit_cost: 25990,
      unit_shipping_fee: 0,
    });
  });

  it('할인 전 단가(32,990)를 쓰지 않는다 — 원가 오염 회귀 방지', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    const payload = buildEntryPayload({ lines, lineNo: 2, receivedAt: '2026-08-08', entryType: 'normal' });
    expect(payload.unit_cost).not.toBe(32990);
  });

  it('할인이 없으면 영수증 단가와 같다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    const payload = buildEntryPayload({ lines, lineNo: 1, receivedAt: '2026-08-08', entryType: 'normal' });
    expect(payload.unit_cost).toBe(29990);
  });

  it('나누어떨어지지 않으면 반올림한다', () => {
    const lines = attributeDiscounts([
      { line_no: 1, item_code: 'A', item_label: '상품', quantity: 3, unit_price: 1000, amount: 3001, is_discount: false, tax_type: 'taxable' as const },
    ]);
    const payload = buildEntryPayload({ lines, lineNo: 1, receivedAt: '2026-08-08', entryType: 'normal' });
    expect(payload.unit_cost).toBe(1000); // round(3001/3) = round(1000.33)
  });
});

describe('buildEntryPayload — 소분 입고', () => {
  it('총 구매가와 사입 총량을 낸다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    const payload = buildEntryPayload({
      lines,
      lineNo: 1,
      receivedAt: '2026-08-08',
      entryType: 'subdivision',
      itemsPerBox: 36,
      subdivisionUnit: 10,
    });
    expect(payload).toEqual({
      received_at: '2026-08-08',
      unit_cost: 407830,          // 총 구매가
      purchase_quantity: 612,     // 17박스 × 36개
      subdivision_unit: 10,
      unit_shipping_fee: 0,
      unit_rg_shipping_fee: 0,
    });
  });

  it('기존 소분 계산기에 그대로 넘어간다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    const payload = buildEntryPayload({
      lines, lineNo: 1, receivedAt: '2026-08-08',
      entryType: 'subdivision', itemsPerBox: 36, subdivisionUnit: 10,
    });
    const calc = calculateSubdivision({
      purchaseQuantity: payload.purchase_quantity as number,
      totalPurchaseCost: payload.unit_cost,
      subdivisionUnit: payload.subdivision_unit as number,
      carryoverQuantity: 0,
      carryoverUnitCost: 0,
    });
    expect(calc.sellablePacks).toBe(61);
    expect(calc.newCarryoverQuantity).toBe(2);
    expect(calc.packUnitCost).toBe(6664);
  });

  it('소분인데 포장당 개수가 없으면 예외를 던진다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    expect(() =>
      buildEntryPayload({ lines, lineNo: 1, receivedAt: '2026-08-08', entryType: 'subdivision', subdivisionUnit: 10 }),
    ).toThrow('itemsPerBox');
  });
});

describe('buildEntryPayload — 거부해야 하는 입력', () => {
  it('할인 줄로는 입고를 만들지 않는다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(() =>
      buildEntryPayload({ lines, lineNo: 3, receivedAt: '2026-08-08', entryType: 'normal' }),
    ).toThrow('할인 줄');
  });

  it('없는 줄 번호는 예외를 던진다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    expect(() =>
      buildEntryPayload({ lines, lineNo: 999, receivedAt: '2026-08-08', entryType: 'normal' }),
    ).toThrow('찾을 수 없');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/receipt/__tests__/entry-payload.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/entry-payload"`

- [ ] **Step 3: 구현 작성**

```typescript
import type { AttributedLine } from '@/lib/receipt/discount';
import { netAmountOf } from '@/lib/receipt/discount';

/**
 * 영수증 줄 → 입고 API 페이로드 (spec §5-7).
 *
 * 기존 POST /api/cost-management/products/[id]/entries가 받는 형태로 맞춘다.
 * 소분 팩 수·팩당 단가·이월 계산은 그 API가 calculateSubdivision()으로 이미
 * 수행하므로 여기서 다시 만들지 않는다.
 */

export interface NormalEntryPayload {
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
}

export interface SubdivisionEntryPayload {
  received_at: string;
  /** 소분 모드에서는 총 구매가를 담는다 */
  unit_cost: number;
  /** 사입 총량 = 구매 수량 × 포장당 개수 */
  purchase_quantity: number;
  subdivision_unit: number;
  unit_shipping_fee: number;
  unit_rg_shipping_fee: number;
}

export type EntryPayload = NormalEntryPayload | SubdivisionEntryPayload;

export interface BuildEntryPayloadInput {
  lines: AttributedLine[];
  lineNo: number;
  receivedAt: string;
  entryType: 'normal' | 'subdivision';
  /** 소분일 때 필수 */
  itemsPerBox?: number;
  /** 소분일 때 필수 */
  subdivisionUnit?: number;
}

export function buildEntryPayload(input: BuildEntryPayloadInput): EntryPayload {
  const { lines, lineNo, receivedAt, entryType, itemsPerBox, subdivisionUnit } = input;

  const line = lines.find((l) => l.line_no === lineNo);
  if (!line) throw new Error(`줄 ${lineNo}을 찾을 수 없습니다.`);
  if (line.is_discount) throw new Error(`줄 ${lineNo}은 할인 줄입니다. 입고를 만들 수 없습니다.`);

  // 할인 반영 후 실결제액. 사용자가 정한 원가 기준이다
  const netAmount = netAmountOf(lines, lineNo);

  if (entryType === 'normal') {
    return {
      received_at: receivedAt,
      quantity: line.quantity,
      unit_cost: Math.round(netAmount / line.quantity),
      unit_shipping_fee: 0,
    };
  }

  if (!itemsPerBox) throw new Error('소분 입고에는 itemsPerBox가 필요합니다.');
  if (!subdivisionUnit) throw new Error('소분 입고에는 subdivisionUnit이 필요합니다.');

  return {
    received_at: receivedAt,
    unit_cost: netAmount,
    purchase_quantity: Math.round(line.quantity * itemsPerBox),
    subdivision_unit: subdivisionUnit,
    unit_shipping_fee: 0,
    unit_rg_shipping_fee: 0,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/receipt/__tests__/entry-payload.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/entry-payload.ts src/lib/receipt/__tests__/entry-payload.test.ts
git commit -m "feat(receipt): 영수증 줄을 입고 API 페이로드로 변환"
```

---

## Task 9: 포장 수량 추출

**Files:**
- Create: `src/lib/receipt/pack-size.ts`
- Test: `src/lib/receipt/__tests__/pack-size.test.ts`

상품명에 포장 수량이 들어 있는 경우가 많다 (spec §6-3-1). 매핑 등록 시 입력란의 초깃값으로만 쓰고 자동 확정하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
import { describe, it, expect } from 'vitest';
import { extractPackSize } from '@/lib/receipt/pack-size';

describe('extractPackSize', () => {
  it.each([
    ['KS노랑타월36CT', 36],
    ['소금버터빵 6CT', 6],
    ['KS라운드티6매 L', 6],
    ['KS라운드티6매XL', 6],
    ['동물복지란60개', 60],
    ['커클랜드 물티슈 12PK', 12],
    ['생수 2입', 2],
  ])('%s → %i', (label, expected) => {
    expect(extractPackSize(label)).toBe(expected);
  });

  it.each([
    ['아이더호보백'],
    ['KS M.쇼비뇽블랑'],
    ['YALE남성 후디'],
    ['위트빅스프로틴'],
    ['SEOUL A2+우유2.3'],
  ])('%s → null', (label) => {
    expect(extractPackSize(label)).toBeNull();
  });

  it('여러 개 나오면 마지막 것을 쓴다', () => {
    expect(extractPackSize('2단 선반 6개')).toBe(6);
  });

  it('빈 문자열은 null이다', () => {
    expect(extractPackSize('')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/receipt/__tests__/pack-size.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/pack-size"`

- [ ] **Step 3: 구현 작성**

```typescript
/**
 * 상품명에서 포장당 개수를 뽑는다 (spec §6-3-1).
 *
 * 어디까지나 제안이다. `36CT`가 판매 소분 단위와 같지는 않으므로
 * 입력란의 초깃값으로만 쓰고 자동 확정하지 않는다.
 */

// 단위를 이 다섯으로 한정한다. 단독 "P"는 넣지 않는다 —
// 상품명에 흔한 알파벳이라 "A2P" 같은 표기를 포장 수량으로 오인한다
const PACK_PATTERN = /(\d+)\s*(CT|PK|개|매|입)/gi;

export function extractPackSize(label: string): number | null {
  const matches = [...label.matchAll(PACK_PATTERN)];
  if (matches.length === 0) return null;

  // 여러 개 나오면 마지막 것이 포장 단위일 가능성이 높다 ("2단 선반 6개")
  const last = matches[matches.length - 1];
  const value = Number.parseInt(last[1], 10);

  return Number.isFinite(value) && value > 0 ? value : null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/receipt/__tests__/pack-size.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/pack-size.ts src/lib/receipt/__tests__/pack-size.test.ts
git commit -m "feat(receipt): 상품명에서 포장 수량 추출"
```

---

## Task 10: 전체 회귀 확인

**Files:**
- 없음 (검증 전용)

- [ ] **Step 1: 신규 테스트 전체 실행**

Run: `npx vitest run src/lib/receipt`
Expected: PASS — 4 files, 55 tests

- [ ] **Step 2: 기존 테스트가 깨지지 않았는지 확인**

Run: `npx vitest run`
Expected: 이 계획 착수 전과 같은 결과 + 신규 55건. 실패 0

착수 전 개수를 모른다면 먼저 `git stash`로 되돌려 한 번 재보고 비교한다.

- [ ] **Step 3: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 4: 린트**

Run: `npx eslint src/lib/receipt`
Expected: 오류 없음

- [ ] **Step 5: 커밋 (변경이 있을 때만)**

```bash
git add -A src/lib/receipt
git commit -m "chore(receipt): 린트·타입 정리"
```

---

## 완료 기준

이 계획이 끝나면 다음이 성립한다.

| 항목 | 확인 방법 |
|---|---|
| 스키마 3테이블 + 컬럼 1개가 DB에 있다 | `\d receipt_drafts` 등으로 확인 |
| 검산 4종이 실제 영수증 2장에서 통과한다 | `npx vitest run src/lib/receipt/__tests__/verify.test.ts` |
| 할인이 원 품목에 귀속돼 단가가 25,990원으로 나온다 | `entry-payload.test.ts`의 첫 테스트 |
| 소분 페이로드가 기존 계산기와 맞물린다 | `entry-payload.test.ts`의 `calculateSubdivision` 연동 테스트 |
| 포장 수량 자동 제안이 동작한다 | `pack-size.test.ts` |

**아직 없는 것** — Vision 호출, 이미지 업로드, DB 읽고 쓰기, 화면. 2편과 3편에서 만든다.

## Open Questions

- 마이그레이션을 적용할 DB가 `SOURCING_DATABASE_URL` 하나인지, Supabase 대시보드와 별개인지 확인이 필요하다. `076` 주석은 "DB에 직접 적용됨"이라고만 적혀 있다.
- `receipt_draft_lines.applies_to_line_id`는 uuid 자기참조인데 순수 함수 계층은 `line_no`로 다룬다. 2편에서 저장할 때 변환한다 — 그 매핑을 어느 쪽에 둘지는 2편에서 정한다.
