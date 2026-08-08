# 코스트코 영수증 자동 입고 — 2편: 업로드와 추출

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영수증 사진을 올리면 서버가 뒤에서 읽어 검산·할인귀속·매핑까지 끝난 초안을 만든다. 화면 없이 API로 완결된다.

**Architecture:** 업로드와 추출을 분리한다 — 업로드는 즉시 반환하고 추출은 별도 호출로 돈다(실측 판독 12~14초). 매핑 자동채움은 DB에서 떼어낸 순수 함수로 만들어 테스트한다.

**Tech Stack:** Next.js App Router · `@anthropic-ai/sdk` · `pg` (`getSourcingPool`) · Supabase Storage · vitest

**Spec:** `docs/superpowers/specs/2026-08-08-costco-receipt-ingest-design.md`
**전편:** `2026-08-08-costco-receipt-ingest.md` (스키마 + 순수 로직, 완료)
**후속:** 3편 확정·조회 API · 4편 화면

---

## 전편에서 이미 있는 것

| 모듈 | 쓸 것 |
|---|---|
| `src/lib/receipt/types.ts` | `ExtractedReceipt`, `ExtractedLine`, `TaxType` |
| `src/lib/receipt/verify.ts` | `verifyReceipt()` → `VerifyResult` |
| `src/lib/receipt/discount.ts` | `attributeDiscounts()`, `AttributedLine` |
| `src/lib/receipt/pack-size.ts` | `extractPackSize()` |
| DB | `receipt_drafts` · `receipt_draft_lines` · `costco_item_map` (적용 완료) |

기존 저장소 관례:
- 인증 — `getCurrentUser()` from `@/lib/auth` → `{ userId, email } | null`, 없으면 401
- DB — `getSourcingPool()` from `@/lib/sourcing/db` (pg Pool)
- 응답 — `{ success: true, data }` / `{ success: false, error }`
- Storage — `uploadToStorage(path, arrayBuffer, mime, size)` from `@/lib/supabase/server`, 공개 URL 반환
- Anthropic — `getAnthropicClient()` from `@/lib/ai/claude`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/receipt/mapping.ts` | 매핑 적용 — 추출 줄 + `costco_item_map` → 저장할 줄. **순수 함수** |
| `src/lib/receipt/extract.ts` | Vision 호출 + zod 스키마. 외부 의존 격리 |
| `src/lib/receipt/storage-path.ts` | 이미지 저장 경로 규칙. **순수 함수** |
| `src/app/api/receipts/route.ts` | `POST` 업로드 → 초안 생성 |
| `src/app/api/receipts/[id]/parse/route.ts` | `POST` 추출 → 검산 → 귀속 → 매핑 → 줄 저장 |

순수 함수(`mapping.ts`, `storage-path.ts`)를 먼저 만들고 테스트한다. 라우트는 그것들을 엮는 얇은 층이 된다.

---

## Task 1: 이미지 저장 경로

**Files:**
- Create: `src/lib/receipt/storage-path.ts`
- Test: `src/lib/receipt/__tests__/storage-path.test.ts`

영수증 이미지는 공개 버킷에 들어간다(스펙 §7 수용된 위험). 완화책이 경로 추측 불가능성뿐이므로 규칙을 명시적으로 만들고 테스트한다.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { receiptImagePath } from '@/lib/receipt/storage-path';

describe('receiptImagePath', () => {
  const uid = '11111111-2222-3333-4444-555555555555';
  const did = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('user·draft uuid와 순번으로 경로를 만든다', () => {
    expect(receiptImagePath(uid, did, 0, 'image/jpeg')).toBe(
      `receipts/${uid}/${did}/0.jpg`,
    );
  });

  it('png는 확장자가 png다', () => {
    expect(receiptImagePath(uid, did, 1, 'image/png')).toBe(
      `receipts/${uid}/${did}/1.png`,
    );
  });

  it('webp는 확장자가 webp다', () => {
    expect(receiptImagePath(uid, did, 2, 'image/webp')).toBe(
      `receipts/${uid}/${did}/2.webp`,
    );
  });

  it('draft uuid가 경로에 들어간다 — 추측 불가능성의 근거', () => {
    const path = receiptImagePath(uid, did, 0, 'image/jpeg');
    expect(path).toContain(did);
  });

  it('순번이 음수면 예외를 던진다', () => {
    expect(() => receiptImagePath(uid, did, -1, 'image/jpeg')).toThrow('index');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/receipt/__tests__/storage-path.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/storage-path"`

- [ ] **Step 3: 구현**

```typescript
import type { AllowedMimeType } from '@/lib/ai/claude-vision';

/**
 * 영수증 이미지의 Storage 경로.
 *
 * 공개 버킷에 저장하므로(spec §7 수용된 위험) 완화책은 경로 추측 불가능성뿐이다.
 * draft uuid를 경로에 넣어 순번만으로는 다른 영수증에 도달할 수 없게 한다.
 */

const EXT: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function receiptImagePath(
  userId: string,
  draftId: string,
  index: number,
  mimeType: AllowedMimeType,
): string {
  if (index < 0 || !Number.isInteger(index)) {
    throw new Error(`index는 0 이상의 정수여야 합니다: ${index}`);
  }
  return `receipts/${userId}/${draftId}/${index}.${EXT[mimeType]}`;
}
```

- [ ] **Step 4: 통과 확인** — `5 tests passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/storage-path.ts src/lib/receipt/__tests__/storage-path.test.ts
git commit -m "feat(receipt): 영수증 이미지 저장 경로 규칙" -- src/lib/receipt/storage-path.ts src/lib/receipt/__tests__/storage-path.test.ts
```

> `git commit`에 경로를 반드시 명시한다. 경로 없이 커밋하면 인덱스 전체가 들어간다.

---

## Task 2: 매핑 자동채움

**Files:**
- Create: `src/lib/receipt/mapping.ts`
- Test: `src/lib/receipt/__tests__/mapping.test.ts`

`costco_item_map`을 조회해 각 줄의 `decision`·`product_cost_id`·소분 파라미터를 미리 채운다. **DB 접근은 호출자가 하고 이 함수는 데이터만 받는다** — 그래야 테스트할 수 있다.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { applyMappings, type ItemMapRow } from '@/lib/receipt/mapping';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { RECEIPT_A, RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

const MAPS: ItemMapRow[] = [
  {
    item_code: '713160',
    product_cost_id: 'prod-towel',
    default_decision: 'ingest',
    default_entry_type: 'subdivision',
    items_per_box: 36,
    subdivision_unit: 10,
  },
  {
    item_code: '674362',
    product_cost_id: null,
    default_decision: 'skip',
    default_entry_type: null,
    items_per_box: null,
    subdivision_unit: null,
  },
  {
    item_code: '690437',
    product_cost_id: 'prod-bag',
    default_decision: 'ask',
    default_entry_type: 'normal',
    items_per_box: null,
    subdivision_unit: null,
  },
];

describe('applyMappings', () => {
  it('매핑된 품목은 결정과 상품을 물려받는다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_A.lines), MAPS);
    const towel = rows.find((r) => r.line_no === 1)!;
    expect(towel.decision).toBe('ingest');
    expect(towel.product_cost_id).toBe('prod-towel');
    expect(towel.entry_type).toBe('subdivision');
    expect(towel.items_per_box).toBe(36);
    expect(towel.subdivision_unit).toBe(10);
  });

  it('개인용으로 기억된 품목은 skip이다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    expect(rows.find((r) => r.line_no === 7)!.decision).toBe('skip');
  });

  it('ask로 기억된 품목은 pending으로 둔다 — 매번 묻는다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    const bag = rows.find((r) => r.line_no === 1)!;
    expect(bag.decision).toBe('pending');
    expect(bag.product_cost_id).toBe('prod-bag');
  });

  it('매핑이 없는 품목은 pending이고 상품이 비어 있다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    const wine = rows.find((r) => r.line_no === 9)!;
    expect(wine.decision).toBe('pending');
    expect(wine.product_cost_id).toBeNull();
  });

  it('할인 줄은 항상 skip이다 — 입고를 만들지 않는다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    expect(rows.find((r) => r.line_no === 3)!.decision).toBe('skip');
    expect(rows.find((r) => r.line_no === 5)!.decision).toBe('skip');
  });

  it('할인 줄의 귀속 대상 line_no를 보존한다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    expect(rows.find((r) => r.line_no === 3)!.applies_to_line_no).toBe(2);
  });

  it('품번이 없는 줄은 매핑을 찾지 않고 pending이다', () => {
    const noCode = attributeDiscounts([
      { line_no: 1, item_code: null, item_label: '봉투', quantity: 1, unit_price: 100, amount: 100, is_discount: false, tax_type: 'taxable' as const },
    ]);
    const rows = applyMappings(noCode, MAPS);
    expect(rows[0].decision).toBe('pending');
    expect(rows[0].product_cost_id).toBeNull();
  });

  it('매핑에 포장 수량이 없으면 상품명에서 뽑아 제안한다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    // 11번 동물복지란60개 — 매핑 없음, 상품명에서 60
    expect(rows.find((r) => r.line_no === 11)!.items_per_box).toBe(60);
  });

  it('매핑의 포장 수량이 상품명 추출보다 우선한다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_A.lines), MAPS);
    // KS노랑타월36CT — 상품명은 36, 매핑도 36. 매핑 값을 쓴다
    const towel = rows.find((r) => r.line_no === 1)!;
    expect(towel.items_per_box).toBe(36);
  });

  it('줄 순서와 개수를 보존한다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    const rows = applyMappings(lines, MAPS);
    expect(rows).toHaveLength(13);
    expect(rows.map((r) => r.line_no)).toEqual(lines.map((l) => l.line_no));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/receipt/__tests__/mapping.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/mapping"`

- [ ] **Step 3: 구현**

```typescript
import type { AttributedLine } from '@/lib/receipt/discount';
import { extractPackSize } from '@/lib/receipt/pack-size';

/**
 * 매핑 자동채움.
 *
 * `costco_item_map`이 기억한 결정을 각 줄에 미리 입힌다. 재구매가 반복되는
 * 코스트코 특성상 서너 번 장을 보고 나면 대부분의 품목이 자동으로 채워진다.
 *
 * DB 접근은 호출자가 한다. 이 함수는 데이터만 받아 순수하게 계산한다.
 */

/** `costco_item_map`에서 읽어온 행 중 이 함수가 쓰는 필드만 */
export interface ItemMapRow {
  item_code: string;
  product_cost_id: string | null;
  default_decision: 'ingest' | 'skip' | 'ask';
  default_entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
}

/** `receipt_draft_lines`에 넣을 값 */
export interface DraftLineRow {
  line_no: number;
  item_code: string | null;
  item_label: string;
  quantity: number;
  unit_price: number | null;
  amount: number;
  is_discount: boolean;
  applies_to_line_no: number | null;
  tax_type: 'taxable' | 'exempt' | 'unknown';
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
}

export function applyMappings(
  lines: AttributedLine[],
  maps: ItemMapRow[],
): DraftLineRow[] {
  const byCode = new Map(maps.map((m) => [m.item_code, m]));

  return lines.map((line) => {
    const base = {
      line_no: line.line_no,
      item_code: line.item_code,
      item_label: line.item_label,
      quantity: line.quantity,
      unit_price: line.unit_price,
      amount: line.amount,
      is_discount: line.is_discount,
      applies_to_line_no: line.applies_to_line_no,
      tax_type: line.tax_type,
    };

    // 할인 줄은 입고를 만들지 않는다. 값은 귀속된 품목의 단가에만 반영된다
    if (line.is_discount) {
      return {
        ...base,
        decision: 'skip' as const,
        product_cost_id: null,
        entry_type: null,
        items_per_box: null,
        subdivision_unit: null,
      };
    }

    const map = line.item_code ? byCode.get(line.item_code) : undefined;

    // 'ask'는 "매번 물어봐"라는 뜻이므로 pending으로 둔다.
    // 같은 품번을 어떤 날은 팔고 어떤 날은 집에서 쓰는 경우를 위한 3상태다.
    const decision =
      map?.default_decision === 'ingest' ? ('ingest' as const)
      : map?.default_decision === 'skip' ? ('skip' as const)
      : ('pending' as const);

    // 포장 수량은 매핑이 우선, 없으면 상품명에서 제안한다
    const itemsPerBox = map?.items_per_box ?? extractPackSize(line.item_label);

    return {
      ...base,
      decision,
      product_cost_id: map?.product_cost_id ?? null,
      entry_type: map?.default_entry_type ?? null,
      items_per_box: itemsPerBox,
      subdivision_unit: map?.subdivision_unit ?? null,
    };
  });
}
```

- [ ] **Step 4: 통과 확인** — `10 tests passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/mapping.ts src/lib/receipt/__tests__/mapping.test.ts
git commit -m "feat(receipt): costco_item_map 자동채움" -- src/lib/receipt/mapping.ts src/lib/receipt/__tests__/mapping.test.ts
```

---

## Task 3: Vision 추출 모듈

**Files:**
- Create: `src/lib/receipt/extract.ts`
- Test: `src/lib/receipt/__tests__/extract.test.ts`

실제 모델 호출은 테스트하지 않는다. **스키마와 프롬프트 상수만 검증**한다 — 스키마가 깨지면 추출 계약이 무너지기 때문이다.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { RECEIPT_SCHEMA, RECEIPT_PROMPT } from '@/lib/receipt/extract';
import { RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

describe('RECEIPT_SCHEMA', () => {
  it('실제 추출 결과를 통과시킨다', () => {
    const parsed = RECEIPT_SCHEMA.safeParse(RECEIPT_B);
    expect(parsed.success).toBe(true);
  });

  it('nullable 필드에 null을 허용한다', () => {
    const blank = {
      ...RECEIPT_B,
      store_name: null, purchased_at: null, purchased_time: null,
      register_no: null, receipt_total: null, total_item_count: null,
      tax_exempt_total: null, taxable_total: null, vat: null,
    };
    expect(RECEIPT_SCHEMA.safeParse(blank).success).toBe(true);
  });

  it('line의 unit_price에 null을 허용한다 — 못 읽은 줄', () => {
    const partial = {
      ...RECEIPT_B,
      lines: RECEIPT_B.lines.map((l) => ({ ...l, unit_price: null })),
    };
    expect(RECEIPT_SCHEMA.safeParse(partial).success).toBe(true);
  });

  it('amount가 없으면 거부한다 — 검산의 근거라 필수다', () => {
    const broken = {
      ...RECEIPT_B,
      lines: [{ ...RECEIPT_B.lines[0], amount: undefined }],
    };
    expect(RECEIPT_SCHEMA.safeParse(broken).success).toBe(false);
  });

  it('tax_type에 정의되지 않은 값을 거부한다', () => {
    const broken = {
      ...RECEIPT_B,
      lines: [{ ...RECEIPT_B.lines[0], tax_type: 'zero_rated' }],
    };
    expect(RECEIPT_SCHEMA.safeParse(broken).success).toBe(false);
  });
});

describe('RECEIPT_PROMPT', () => {
  it('추측 금지 원칙을 담고 있다', () => {
    expect(RECEIPT_PROMPT).toContain('추측');
    expect(RECEIPT_PROMPT).toContain('null');
  });

  it('회원번호·카드번호 추출 금지를 담고 있다', () => {
    expect(RECEIPT_PROMPT).toContain('회원번호');
    expect(RECEIPT_PROMPT).toContain('카드번호');
  });

  it('두 줄 구조와 CPN 규칙을 담고 있다', () => {
    expect(RECEIPT_PROMPT).toContain('CPN');
    expect(RECEIPT_PROMPT).toContain('상품수 소계');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/receipt/__tests__/extract.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/extract"`

- [ ] **Step 3: 구현**

```typescript
import sharp from 'sharp';
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import type { AllowedMimeType } from '@/lib/ai/claude-vision';
import type { ExtractedReceipt } from '@/lib/receipt/types';

/**
 * 영수증 Vision 추출 (spec §5).
 *
 * 실측 (2026-08-08, 실제 코스트코 영수증 2장): 장당 약 67원, 12~14초.
 * 검산 4종과 줄 검산 16줄이 전부 통과했다.
 */

/** claude-opus-5 고해상도 상한. 더 줄이면 숫자 오독이 는다 */
const MAX_EDGE = 2576;

const nullableNum = z.number().int().nullable();

export const RECEIPT_LINE_SCHEMA = z.object({
  line_no: z.number().int(),
  item_code: z.string().nullable(),
  item_label: z.string(),
  quantity: z.number(),
  unit_price: nullableNum,
  amount: z.number().int(),
  is_discount: z.boolean(),
  tax_type: z.enum(['taxable', 'exempt', 'unknown']),
});

export const RECEIPT_SCHEMA = z.object({
  store_name: z.string().nullable(),
  purchased_at: z.string().nullable(),
  purchased_time: z.string().nullable(),
  register_no: z.string().nullable(),
  receipt_total: nullableNum,
  total_item_count: nullableNum,
  tax_exempt_total: nullableNum,
  taxable_total: nullableNum,
  vat: nullableNum,
  lines: z.array(RECEIPT_LINE_SCHEMA),
});

export const RECEIPT_PROMPT = `이 코스트코(COSTCO) 영수증 사진에서 품목을 추출한다.

읽히지 않으면 null. 절대 추측하지 마라. 흐릿하거나 가려진 값을 그럴듯하게 채우는 것은 최악의 실패다.

코스트코 영수증 구조:
- 품목은 두 줄로 찍힌다: 윗줄에 상품명, 아랫줄에 "품번 수량x 단가 금액 과세마커".
- 과세 상품은 금액 뒤에 T가 붙는다. 면세 상품은 붙지 않는다.
- 쿠폰 할인은 CPN 마커 뒤에 별도 줄로 찍히고, 자체 품번과 자체 상품명을 가지며, 금액 뒤에 마이너스 부호가 붙는다. 할인 줄도 lines에 담되 is_discount=true, amount는 음수로.
- "상품수 소계", "PRESCAN 상품 시작/종료", "COUPON TOTAL" 같은 구분선은 품목이 아니다. 담지 마라.
- 같은 품번이 여러 줄에 나올 수 있다. 합치지 말고 나온 순서대로 각각 담아라.
- 봉투값 등 품번 없는 줄은 item_code를 null로 두고 담아라. 버리면 합계가 안 맞는다.

purchased_at은 YYYY-MM-DD. 영수증 날짜는 MM/DD/YYYY 형식이다.
purchased_time은 HH:MM. register_no는 "REG:8"의 8.
receipt_total은 "합계 (VAT 포함)" 값. total_item_count는 "총 판매 상품수"(줄 수가 아니라 수량 합계).

회원번호와 카드번호는 절대 추출하지 마라.`;

export interface ExtractInput {
  images: { data: Buffer; mimeType: AllowedMimeType }[];
}

/**
 * 영수증을 claude-opus-5 고해상도 상한(2,576px)에 맞춘다.
 *
 * 기존 `resizeForClaude`를 쓰지 않는 이유: 상한이 7500px로 하드코딩되어 있고
 * 인자로 바꿀 수 없다. 그 크기로 보내면 이미지 토큰이 크게 늘어 비용이 뛴다.
 * 반대로 2,576px보다 줄이면 조밀한 숫자 오독이 는다 — Vision 단독 추출의
 * 유일한 약점이 거기다.
 */
async function fitForReceipt(
  data: Buffer,
): Promise<{ base64: string; mimeType: AllowedMimeType }> {
  const meta = await sharp(data).metadata();
  const needsResize = (meta.width ?? 0) > MAX_EDGE || (meta.height ?? 0) > MAX_EDGE;

  // EXIF 자동 회전만 하고 인위적 회전은 하지 않는다 —
  // 실측에서 프레임 안에 가로로 누운 사진도 전 줄 정확히 읽혔다
  const pipeline = sharp(data).rotate();
  const out = needsResize
    ? await pipeline.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
    : await pipeline.jpeg({ quality: 90 }).toBuffer();

  return { base64: out.toString('base64'), mimeType: 'image/jpeg' };
}

/**
 * 영수증 이미지에서 구조화된 결과를 뽑는다.
 * 긴 영수증은 여러 장을 한 번에 넣어 하나의 lines 배열로 받는다.
 */
export async function extractReceipt(input: ExtractInput): Promise<ExtractedReceipt> {
  const client = getAnthropicClient();

  const contents = await Promise.all(
    input.images.map(async (img) => {
      const fitted = await fitForReceipt(img.data);
      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: fitted.mimeType,
          data: fitted.base64,
        },
      };
    }),
  );

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: z.toJSONSchema(RECEIPT_SCHEMA) },
    },
    messages: [
      { role: 'user', content: [...contents, { type: 'text', text: RECEIPT_PROMPT }] },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  return RECEIPT_SCHEMA.parse(JSON.parse(text)) as ExtractedReceipt;
}
```

> **확인 완료 (2026-08-08).** `z.toJSONSchema`는 zod 4.3.6에 존재한다. `resizeForClaude`는 **쓰지 않는다** — base64 문자열을 받고 상한이 7500px로 하드코딩되어 인자로 바꿀 수 없다. 위 `fitForReceipt`가 그 자리를 대신한다.

- [ ] **Step 4: 통과 확인** — `8 tests passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/receipt/extract.ts src/lib/receipt/__tests__/extract.test.ts
git commit -m "feat(receipt): Vision 추출 스키마와 프롬프트" -- src/lib/receipt/extract.ts src/lib/receipt/__tests__/extract.test.ts
```

---

## Task 4: 업로드 API

**Files:**
- Create: `src/app/api/receipts/route.ts`

업로드가 끝나면 **즉시 반환한다.** 추출은 별도 호출(Task 5)로 돈다 — 실측 12~14초를 매장에서 기다리게 할 수 없다.

- [ ] **Step 1: 라우트 작성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { uploadToStorage } from '@/lib/supabase/server';
import { receiptImagePath } from '@/lib/receipt/storage-path';
import { ALLOWED_MIME_TYPES, type AllowedMimeType } from '@/lib/ai/claude-vision';

/** 장당 최대 크기. 아이폰 원본이 6MB 안팎이다 */
const MAX_FILE_SIZE = 15 * 1024 * 1024;
/** 긴 영수증은 나눠 찍으므로 여러 장을 받는다 */
const MAX_FILES = 5;

/**
 * POST /api/receipts — 영수증 이미지 업로드
 *
 * 업로드만 하고 즉시 반환한다. 판독은 POST /api/receipts/[id]/parse가 한다.
 * 매장 주차장에서 12~14초를 기다리게 하지 않기 위한 분리다 (spec §3-1).
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      { success: false, error: 'Content-Type은 multipart/form-data여야 합니다.' },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'FormData 파싱 실패' }, { status: 400 });
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ success: false, error: 'files 필드가 비어 있습니다.' }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { success: false, error: `이미지는 최대 ${MAX_FILES}장까지입니다.` },
      { status: 400 },
    );
  }

  for (const f of files) {
    if (!ALLOWED_MIME_TYPES.includes(f.type as AllowedMimeType)) {
      return NextResponse.json(
        { success: false, error: `지원하지 않는 형식: ${f.type}` },
        { status: 415 },
      );
    }
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `파일이 너무 큽니다: ${f.name}` },
        { status: 413 },
      );
    }
  }

  // draft id를 먼저 만든다 — 저장 경로에 들어가야 하기 때문이다
  const draftId = randomUUID();

  let imagePaths: string[];
  try {
    imagePaths = await Promise.all(
      files.map(async (f, i) => {
        const mime = f.type as AllowedMimeType;
        const path = receiptImagePath(user.userId, draftId, i, mime);
        const buf = await f.arrayBuffer();
        await uploadToStorage(path, buf, mime, f.size);
        return path;
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : '업로드 실패';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `INSERT INTO receipt_drafts (id, user_id, image_paths, ocr_status, status)
     VALUES ($1, $2, $3, 'pending', 'draft')
     RETURNING id, ocr_status, status, created_at`,
    [draftId, user.userId, imagePaths],
  );

  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
}
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

`getCurrentUser`, `getSourcingPool`, `uploadToStorage`, `ALLOWED_MIME_TYPES`의 실제 시그니처를 먼저 읽고 위 코드를 맞춰라. 특히 `uploadToStorage`의 인자 순서와 반환형을 확인하라.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/receipts/route.ts
git commit -m "feat(receipt): 영수증 업로드 API" -- src/app/api/receipts/route.ts
```

---

## Task 5: 판독 API

**Files:**
- Create: `src/app/api/receipts/[id]/parse/route.ts`

업로드된 이미지를 읽어 검산·할인귀속·매핑까지 끝낸 줄들을 저장한다. 이 태스크가 2편의 종착점이다.

- [ ] **Step 1: 라우트 작성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extractReceipt } from '@/lib/receipt/extract';
import { verifyReceipt } from '@/lib/receipt/verify';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { applyMappings, type ItemMapRow } from '@/lib/receipt/mapping';
import type { AllowedMimeType } from '@/lib/ai/claude-vision';

function mimeOf(path: string): AllowedMimeType {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * POST /api/receipts/[id]/parse — 업로드된 영수증을 판독한다.
 *
 * 추출 → 검산 4종 → 할인 귀속 → 매핑 자동채움 → 줄 저장.
 * 실패해도 초안과 이미지는 남긴다. 재시도할 수 있어야 하기 때문이다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows: drafts } = await pool.query(
    `SELECT id, image_paths, ocr_status FROM receipt_drafts WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (drafts.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const draft = drafts[0];

  // 이미 판독된 초안을 다시 판독하면 줄이 중복된다
  if (draft.ocr_status === 'parsed') {
    return NextResponse.json(
      { success: false, error: '이미 판독된 영수증입니다.' },
      { status: 409 },
    );
  }

  // 1) 이미지 내려받기
  const supabase = getSupabaseServerClient();
  const images: { data: Buffer; mimeType: AllowedMimeType }[] = [];
  for (const path of draft.image_paths as string[]) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
    if (error || !data) {
      return NextResponse.json(
        { success: false, error: `이미지를 읽지 못했습니다: ${path}` },
        { status: 500 },
      );
    }
    images.push({ data: Buffer.from(await data.arrayBuffer()), mimeType: mimeOf(path) });
  }

  // 2) 추출 — 실패하면 상태만 failed로 남기고 초안은 보존한다
  let extracted;
  try {
    extracted = await extractReceipt({ images });
  } catch (err) {
    await pool.query(`UPDATE receipt_drafts SET ocr_status = 'failed', updated_at = now() WHERE id = $1`, [id]);
    const msg = err instanceof Error ? err.message : '판독 실패';
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }

  // 3) 검산 → 4) 할인 귀속 → 5) 매핑 자동채움
  const verify = verifyReceipt(extracted);
  const attributed = attributeDiscounts(extracted.lines);

  const codes = attributed.map((l) => l.item_code).filter((c): c is string => c != null);
  const { rows: maps } = codes.length
    ? await pool.query(
        `SELECT item_code, product_cost_id, default_decision, default_entry_type,
                items_per_box, subdivision_unit
         FROM costco_item_map WHERE user_id = $1 AND item_code = ANY($2)`,
        [user.userId, codes],
      )
    : { rows: [] };

  const draftLines = applyMappings(attributed, maps as ItemMapRow[]);

  // 6) 저장 — 헤더와 줄을 한 트랜잭션으로
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE receipt_drafts SET
         purchased_at = $2, purchased_time = $3, register_no = $4, store_name = $5,
         receipt_total = $6, total_item_count = $7,
         tax_exempt_total = $8, taxable_total = $9, vat = $10,
         verify_status = $11, verify_detail = $12,
         ocr_status = 'parsed', raw_ocr = $13, updated_at = now()
       WHERE id = $1`,
      [
        id, extracted.purchased_at, extracted.purchased_time, extracted.register_no,
        extracted.store_name, extracted.receipt_total, extracted.total_item_count,
        extracted.tax_exempt_total, extracted.taxable_total, extracted.vat,
        verify.status, JSON.stringify(verify), JSON.stringify(extracted),
      ],
    );

    // line_no → uuid 매핑을 만들며 순서대로 넣는다
    const idByLineNo = new Map<number, string>();
    for (const row of draftLines) {
      const { rows: inserted } = await client.query(
        `INSERT INTO receipt_draft_lines
           (draft_id, line_no, item_code, item_label, quantity, unit_price, amount,
            is_discount, tax_type, decision, product_cost_id, entry_type,
            items_per_box, subdivision_unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          id, row.line_no, row.item_code, row.item_label, row.quantity, row.unit_price,
          row.amount, row.is_discount, row.tax_type, row.decision, row.product_cost_id,
          row.entry_type, row.items_per_box, row.subdivision_unit,
        ],
      );
      idByLineNo.set(row.line_no, inserted[0].id);
    }

    // 할인 귀속은 uuid가 다 생긴 뒤에 건다 — 자기참조라 순서가 필요하다
    for (const row of draftLines) {
      if (row.applies_to_line_no == null) continue;
      const targetId = idByLineNo.get(row.applies_to_line_no);
      if (!targetId) continue;
      await client.query(
        `UPDATE receipt_draft_lines SET applies_to_line_id = $1 WHERE draft_id = $2 AND line_no = $3`,
        [targetId, id, row.line_no],
      );
    }

    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  return NextResponse.json({
    success: true,
    data: { id, verify_status: verify.status, verify: verify, line_count: draftLines.length },
  });
}
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

`getSupabaseServerClient`와 `STORAGE_BUCKET`이 실제로 export되는지 확인하고, `download`의 반환형에 맞춰라.

- [ ] **Step 3: 커밋**

```bash
git add "src/app/api/receipts/[id]/parse/route.ts"
git commit -m "feat(receipt): 영수증 판독 API — 추출·검산·귀속·매핑" -- "src/app/api/receipts/[id]/parse/route.ts"
```

---

## Task 6: 전체 회귀 + 실물 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 신규 테스트**

Run: `npx vitest run src/lib/receipt`
Expected: PASS — 7 files, 78 tests (전편 55 + 경로 5 + 매핑 10 + 추출 8)

- [ ] **Step 2: 전체 회귀**

Run: `npx vitest run`
Expected: **14 failed / 3,038 passed** — 실패가 14에서 늘지 않아야 한다

베이스라인 14건은 이 기능과 무관한 기존 실패다. 하나라도 늘면 이 작업 탓이다.

- [ ] **Step 3: 타입·린트**

```bash
npx tsc --noEmit && echo "tsc OK"
npx eslint src/lib/receipt src/app/api/receipts && echo "eslint OK"
```

- [ ] **Step 4: 실물 영수증으로 왕복 확인**

`/private/tmp/IMG_3460.JPG`와 `/private/tmp/IMG_3461.JPG`가 실제 코스트코 영수증이다. 개발 서버를 띄우고 실제로 올려 판독까지 돌린다.

인증이 필요하므로 로그인 세션 쿠키가 있어야 한다. 세션을 못 만들면 그 사실을 보고하고 이 단계를 건너뛴다 — 우회로를 만들지 마라.

확인할 것:
- 업로드가 즉시 반환되는가 (판독을 기다리지 않는가)
- 판독 후 `verify_status`가 `matched`인가
- `receipt_draft_lines`가 13줄 들어갔는가 (IMG_3461 기준)
- 할인 2줄의 `applies_to_line_id`가 채워졌는가
- 회원번호·카드번호가 `raw_ocr` 어디에도 없는가

마지막 항목이 특히 중요하다. 프롬프트가 실제로 지켜지는지는 실물로만 확인된다.

---

## 완료 기준

| 항목 | 확인 |
|---|---|
| 이미지를 올리면 초안이 생기고 즉시 반환된다 | `POST /api/receipts` 201 |
| 판독하면 검산 결과가 저장된다 | `verify_status` = `matched` |
| 할인 줄이 원 품목에 연결된다 | `applies_to_line_id` 채워짐 |
| 기억된 품번은 결정이 미리 채워진다 | `decision` ≠ `pending` |
| 회원번호·카드번호가 DB에 없다 | `raw_ocr` 검색 |

**아직 없는 것** — 확정(입고 생성), 조회 목록, 매핑 학습, 화면. 3편·4편에서 만든다.

## Open Questions

- **판독을 누가 촉발하는가** — 지금은 클라이언트가 업로드 후 `parse`를 따로 호출하는 구조다. 매장에서 업로드 직후 앱을 닫으면 판독이 시작되지 않는다. 4편에서 화면이 자동 호출할지, cron이 `pending` 초안을 줍게 할지 정해야 한다
- **이미지 보관 기간** — 무기한인가, 확정 후 N개월인가. 공개 버킷에 두기로 한 만큼(§7 수용된 위험) 오래 남길수록 노출 창이 길어진다
- **`raw_ocr`에 원본 응답을 통째로 넣는 것이 맞는가** — 역추적에는 유용하지만 회원번호가 프롬프트를 뚫고 들어온 경우 그대로 영구 저장된다. Task 6의 실물 검증에서 확인한 뒤 판단한다
