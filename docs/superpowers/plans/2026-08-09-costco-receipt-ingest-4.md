# 코스트코 영수증 자동 입고 — 4편: 화면

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매장에서 영수증을 찍고, 집에 와서 폰으로 확정한다. 서버는 3편에서 다 됐고 **사람이 쓸 입구가 없다.**

**Architecture:** 화면이 판단하지 않는다. 상태 배지·진행률·줄 수정 유효성을 전부 순수 함수로 빼고 컴포넌트는 그 결과를 그린다. `/m` 하위 관례(인라인 스타일·최대 480px·고정 헤더)를 따른다.

**Tech Stack:** Next.js App Router · React client components · `pg` · vitest

**Spec:** `docs/superpowers/specs/2026-08-08-costco-receipt-ingest-design.md`
**전편:** 1편 순수로직 · 2편 업로드/추출 · 3편 확정·cron — 전부 main 병합, 마이그레이션 101·102 운영 적용

---

## 범위 — 데스크탑은 5편이다

스펙은 확정 위치를 **폰과 데스크탑 둘 다**로 정했다. 이 편은 **모바일만** 만든다.

이유는 두 가지다. 사용자의 최초 요청이 *"모바일 채널을 만들어줘"*였고, 데스크탑 확정은 수익원가 탭이라는 **다른 화면 체계**에 붙는 작업이라 같은 계획에 넣으면 둘 다 어중간해진다. **이 편이 만드는 API 6개는 데스크탑이 그대로 쓴다** — 5편은 화면만 얹으면 된다.

**이 스코프 축소가 마음에 들지 않으면 지금 말해야 한다.** 데스크탑을 같이 원하면 계획을 다시 짠다.

---

## 3편까지 있는 것

| 경로 | 하는 일 |
|---|---|
| `POST /api/receipts` | 업로드. multipart, 필드명 `files`, 최대 5장·장당 15MB |
| `POST /api/receipts/[id]/parse` | 수동 판독 |
| `GET /api/cron/parse-receipts` | cron 판독 (10분) |
| `POST /api/receipts/[id]/confirm` | 확정. body `{ line_nos?: number[] }` |
| `src/lib/receipt/confirm.ts` | `selectConfirmable()` · `mappingUpsertFrom()` |
| `src/lib/receipt/discount.ts` | `netAmountOf(lines, lineNo)` — 할인 반영 금액 |

DB 상태값:
- `receipt_drafts.ocr_status` — `pending` · `parsing` · `parsed` · `failed`
- `receipt_drafts.verify_status` — `matched` · `mismatch` · `unreadable`
- `receipt_drafts.status` — `draft` · `done` · `discarded`
- `receipt_draft_lines.decision` — `pending` · `ingest` · `skip`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/receipt/view.ts` | 상태 배지 · 진행률. **순수** |
| `src/lib/receipt/line-patch.ts` | 줄 수정 유효성. **순수** |
| `src/app/api/receipts/route.ts` | `GET` 목록 추가 (POST는 그대로) |
| `src/app/api/receipts/[id]/route.ts` | `GET` 상세 · `DELETE` 폐기 |
| `src/app/api/receipts/[id]/lines/[lineNo]/route.ts` | `PATCH` 줄 수정 |
| `src/app/api/receipts/[id]/retry/route.ts` | `POST` 재판독 |
| `src/app/api/cost-management/products/options/route.ts` | 상품 선택지 (경량) |
| `src/app/m/receipt/layout.tsx` | 헤더 |
| `src/app/m/receipt/page.tsx` | 목록 |
| `src/app/m/receipt/[id]/page.tsx` | 상세 |
| `src/components/receipt/ReceiptList.tsx` | 목록 + 촬영 |
| `src/components/receipt/ReceiptDetail.tsx` | 검토 + 확정 |
| `src/components/receipt/ReceiptLineRow.tsx` | 줄 하나 |

---

## Task 1: 상태 배지와 진행률

**Files:**
- Create: `src/lib/receipt/view.ts`
- Test: `src/lib/receipt/__tests__/view.test.ts`

화면이 "이 초안이 지금 어떤 상태인가"를 판단하지 않게 한다. 상태 조합이 `ocr_status` 4종 × `verify_status` 3종 × `status` 3종이라 컴포넌트 안에서 `if`로 풀면 반드시 빠뜨린다.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { draftBadge, draftProgress, type DraftLike, type ProgressLine } from '@/lib/receipt/view';

function draft(over: Partial<DraftLike> = {}): DraftLike {
  return { ocr_status: 'parsed', verify_status: 'matched', status: 'draft', ...over };
}

describe('draftBadge', () => {
  it('판독 대기는 대기로 표시한다', () => {
    expect(draftBadge(draft({ ocr_status: 'pending' }))).toEqual({
      label: '판독 대기', tone: 'neutral', busy: true,
    });
  });

  it('판독 중은 진행 표시를 켠다', () => {
    const b = draftBadge(draft({ ocr_status: 'parsing' }));
    expect(b.label).toBe('판독 중');
    expect(b.busy).toBe(true);
  });

  it('판독 실패가 검산 상태보다 우선한다', () => {
    const b = draftBadge(draft({ ocr_status: 'failed', verify_status: 'matched' }));
    expect(b.label).toBe('판독 실패');
    expect(b.tone).toBe('danger');
    expect(b.busy).toBe(false);
  });

  it('검산 통과', () => {
    expect(draftBadge(draft())).toEqual({ label: '검산 통과', tone: 'ok', busy: false });
  });

  it('검산 불일치는 경고다 — 막지는 않는다', () => {
    const b = draftBadge(draft({ verify_status: 'mismatch' }));
    expect(b.label).toBe('검산 불일치');
    expect(b.tone).toBe('warn');
  });

  it('검산 불가는 중립이다 — 합계를 못 읽었을 뿐 틀렸다는 뜻이 아니다', () => {
    expect(draftBadge(draft({ verify_status: 'unreadable' })).tone).toBe('neutral');
  });

  it('완료와 폐기는 판독·검산보다 우선한다', () => {
    expect(draftBadge(draft({ status: 'done' })).label).toBe('입고 완료');
    expect(draftBadge(draft({ status: 'discarded' })).label).toBe('폐기');
  });
});

describe('draftProgress', () => {
  const L = (over: Partial<ProgressLine>): ProgressLine => ({
    is_discount: false, decision: 'ingest', product_cost_id: 'p', cost_entry_id: null, ...over,
  });

  it('빈 초안', () => {
    expect(draftProgress([])).toEqual({ total: 0, confirmed: 0, ready: 0, blocked: 0, undecided: 0 });
  });

  it('할인 줄은 어디에도 세지 않는다', () => {
    const r = draftProgress([L({ is_discount: true, decision: 'skip', product_cost_id: null })]);
    expect(r.total).toBe(0);
  });

  it('확정된 줄과 확정 가능한 줄을 나눈다', () => {
    const r = draftProgress([
      L({ cost_entry_id: 'e1' }),
      L({}),
      L({}),
    ]);
    expect(r).toEqual({ total: 3, confirmed: 1, ready: 2, blocked: 0, undecided: 0 });
  });

  it('상품이 없으면 막힌 줄이다', () => {
    const r = draftProgress([L({ product_cost_id: null })]);
    expect(r.blocked).toBe(1);
    expect(r.ready).toBe(0);
  });

  it('아직 정하지 않은 줄을 따로 센다 — 사람이 손대야 할 곳이다', () => {
    const r = draftProgress([L({ decision: 'pending', product_cost_id: null })]);
    expect(r.undecided).toBe(1);
    expect(r.blocked).toBe(0);
  });

  it('제외한 줄은 총계에 들어가되 어디에도 안 걸린다', () => {
    const r = draftProgress([L({ decision: 'skip', product_cost_id: null })]);
    expect(r).toEqual({ total: 1, confirmed: 0, ready: 0, blocked: 0, undecided: 0 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/receipt/__tests__/view.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/receipt/view"`

- [ ] **Step 3: 구현**

```typescript
/**
 * 화면이 상태를 판단하지 않게 한다.
 *
 * 초안 하나의 상태는 ocr_status(4) × verify_status(3) × status(3) 조합이라
 * 컴포넌트 안에서 if로 풀면 반드시 빠뜨린다. 우선순위를 여기 한 곳에 둔다.
 */

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral';

export interface Badge {
  label: string;
  tone: BadgeTone;
  /** true면 화면이 폴링해야 한다 */
  busy: boolean;
}

export interface DraftLike {
  ocr_status: 'pending' | 'parsing' | 'parsed' | 'failed';
  verify_status: 'matched' | 'mismatch' | 'unreadable';
  status: 'draft' | 'done' | 'discarded';
}

/**
 * 우선순위: 종결 상태 → 판독 상태 → 검산 상태.
 * 완료된 초안의 검산 결과는 더 이상 행동을 바꾸지 않으므로 뒤로 밀린다.
 */
export function draftBadge(draft: DraftLike): Badge {
  if (draft.status === 'discarded') return { label: '폐기', tone: 'neutral', busy: false };
  if (draft.status === 'done') return { label: '입고 완료', tone: 'ok', busy: false };

  if (draft.ocr_status === 'pending') return { label: '판독 대기', tone: 'neutral', busy: true };
  if (draft.ocr_status === 'parsing') return { label: '판독 중', tone: 'neutral', busy: true };
  if (draft.ocr_status === 'failed') return { label: '판독 실패', tone: 'danger', busy: false };

  if (draft.verify_status === 'mismatch') return { label: '검산 불일치', tone: 'warn', busy: false };
  if (draft.verify_status === 'unreadable') return { label: '검산 불가', tone: 'neutral', busy: false };
  return { label: '검산 통과', tone: 'ok', busy: false };
}

export interface ProgressLine {
  is_discount: boolean;
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  cost_entry_id: string | null;
}

export interface Progress {
  /** 할인 줄을 뺀 품목 줄 수 */
  total: number;
  confirmed: number;
  /** 지금 확정 버튼을 누르면 들어갈 줄 */
  ready: number;
  /** 입고하기로 했는데 상품이 안 붙은 줄 */
  blocked: number;
  /** 입고인지 제외인지 아직 안 정한 줄 */
  undecided: number;
}

/**
 * 할인 줄은 총계에서 뺀다. 사람이 손댈 대상이 아니고,
 * 세면 "13줄 중 11줄 확정"처럼 영원히 끝나지 않는 표시가 된다.
 */
export function draftProgress(lines: ProgressLine[]): Progress {
  const items = lines.filter((l) => !l.is_discount);
  const p: Progress = { total: items.length, confirmed: 0, ready: 0, blocked: 0, undecided: 0 };

  for (const l of items) {
    if (l.cost_entry_id != null) { p.confirmed++; continue; }
    if (l.decision === 'skip') continue;
    if (l.decision === 'pending') { p.undecided++; continue; }
    if (!l.product_cost_id) { p.blocked++; continue; }
    p.ready++;
  }

  return p;
}
```

- [ ] **Step 4: 통과 확인** — `13 passed`

- [ ] **Step 5: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/lib/receipt/view.ts src/lib/receipt/__tests__/view.test.ts && \
git commit -m "feat(receipt): 초안 상태 배지와 진행률" -- src/lib/receipt/view.ts src/lib/receipt/__tests__/view.test.ts
```

---

## Task 2: 줄 수정 유효성

**Files:**
- Create: `src/lib/receipt/line-patch.ts`
- Test: `src/lib/receipt/__tests__/line-patch.test.ts`

**부분 수정이라 현재 값과 합쳐서 판정해야 한다.** `entry_type`만 `subdivision`으로 바꾸는 요청은, 이미 `items_per_box`가 저장돼 있으면 유효하고 없으면 무효다. 라우트 안에서 즉흥으로 짜면 이 조합을 놓친다.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { validateLinePatch, type LineState, type LinePatch } from '@/lib/receipt/line-patch';

const cur = (over: Partial<LineState> = {}): LineState => ({
  is_discount: false,
  decision: 'pending',
  product_cost_id: null,
  entry_type: null,
  items_per_box: null,
  subdivision_unit: null,
  cost_entry_id: null,
  ...over,
});

function ok(patch: LinePatch, state = cur()) {
  const r = validateLinePatch(patch, state);
  expect(r.errors).toEqual([]);
  return r.next;
}

describe('validateLinePatch', () => {
  it('빈 패치는 현재 값을 그대로 낸다', () => {
    expect(ok({})).toEqual(cur());
  });

  it('패치가 현재 값 위에 덮인다', () => {
    const next = ok({ decision: 'ingest', product_cost_id: 'p1', entry_type: 'normal' });
    expect(next.decision).toBe('ingest');
    expect(next.product_cost_id).toBe('p1');
  });

  it('확정된 줄은 고칠 수 없다', () => {
    const r = validateLinePatch({ decision: 'skip' }, cur({ cost_entry_id: 'e1' }));
    expect(r.errors).toContain('이미 입고로 확정된 줄은 수정할 수 없습니다.');
  });

  it('할인 줄은 고칠 수 없다', () => {
    const r = validateLinePatch({ decision: 'ingest' }, cur({ is_discount: true }));
    expect(r.errors).toContain('할인 줄은 입고 대상이 아닙니다.');
  });

  it('입고로 정하려면 상품이 있어야 한다', () => {
    const r = validateLinePatch({ decision: 'ingest', entry_type: 'normal' }, cur());
    expect(r.errors).toContain('입고할 상품을 선택해야 합니다.');
  });

  it('입고로 정하려면 입고 방식이 있어야 한다', () => {
    const r = validateLinePatch({ decision: 'ingest', product_cost_id: 'p1' }, cur());
    expect(r.errors).toContain('입고 방식을 선택해야 합니다.');
  });

  it('🔴 현재 값과 합쳐서 판정한다 — 방식만 바꿔도 통과한다', () => {
    const state = cur({ decision: 'ingest', product_cost_id: 'p1', entry_type: 'normal' });
    const next = ok({ entry_type: 'subdivision', items_per_box: 36, subdivision_unit: 10 }, state);
    expect(next.entry_type).toBe('subdivision');
    expect(next.product_cost_id).toBe('p1');
  });

  it('🔴 저장된 소분 값이 있으면 방식만 바꿔도 유효하다', () => {
    const state = cur({
      decision: 'ingest', product_cost_id: 'p1', entry_type: 'normal',
      items_per_box: 36, subdivision_unit: 10,
    });
    expect(validateLinePatch({ entry_type: 'subdivision' }, state).errors).toEqual([]);
  });

  it('소분인데 값이 없으면 거절한다', () => {
    const state = cur({ decision: 'ingest', product_cost_id: 'p1' });
    const r = validateLinePatch({ entry_type: 'subdivision' }, state);
    expect(r.errors).toContain('소분 입고에는 박스당 개수와 소분 단위가 모두 필요합니다.');
  });

  it('소분 값은 양수여야 한다', () => {
    const state = cur({ decision: 'ingest', product_cost_id: 'p1' });
    const r = validateLinePatch(
      { entry_type: 'subdivision', items_per_box: 0, subdivision_unit: 10 }, state);
    expect(r.errors).toContain('박스당 개수는 1 이상이어야 합니다.');
  });

  it('제외로 정할 때는 상품이 없어도 된다', () => {
    expect(ok({ decision: 'skip' }).decision).toBe('skip');
  });

  it('상품을 null로 지우는 것과 안 보내는 것을 구분한다', () => {
    const state = cur({ product_cost_id: 'p1', decision: 'skip' });
    expect(ok({}, state).product_cost_id).toBe('p1');
    expect(ok({ product_cost_id: null }, state).product_cost_id).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `Failed to resolve import`

- [ ] **Step 3: 구현**

```typescript
/**
 * 줄 수정 유효성.
 *
 * 부분 수정이므로 **패치 단독이 아니라 현재 값과 합친 결과**를 판정한다.
 * entry_type만 subdivision으로 바꾸는 요청은 이미 items_per_box가 저장돼
 * 있으면 유효하고 없으면 무효다 — 패치만 보면 이 구분을 할 수 없다.
 */

export interface LineState {
  is_discount: boolean;
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
  cost_entry_id: string | null;
}

/** 보내지 않은 필드는 그대로 두고, null은 "지운다"는 뜻이다 */
export interface LinePatch {
  decision?: 'pending' | 'ingest' | 'skip';
  product_cost_id?: string | null;
  entry_type?: 'normal' | 'subdivision' | null;
  items_per_box?: number | null;
  subdivision_unit?: number | null;
}

export interface ValidateResult {
  next: LineState;
  errors: string[];
}

function pick<T>(patch: Record<string, unknown>, key: string, current: T): T {
  return key in patch ? (patch[key] as T) : current;
}

export function validateLinePatch(patch: LinePatch, current: LineState): ValidateResult {
  const p = patch as Record<string, unknown>;

  const next: LineState = {
    is_discount: current.is_discount,
    cost_entry_id: current.cost_entry_id,
    decision: pick(p, 'decision', current.decision),
    product_cost_id: pick(p, 'product_cost_id', current.product_cost_id),
    entry_type: pick(p, 'entry_type', current.entry_type),
    items_per_box: pick(p, 'items_per_box', current.items_per_box),
    subdivision_unit: pick(p, 'subdivision_unit', current.subdivision_unit),
  };

  const errors: string[] = [];

  // 확정된 줄을 고치면 cost_entries와 초안이 어긋난다
  if (current.cost_entry_id != null) {
    errors.push('이미 입고로 확정된 줄은 수정할 수 없습니다.');
    return { next: current, errors };
  }
  if (current.is_discount) {
    errors.push('할인 줄은 입고 대상이 아닙니다.');
    return { next: current, errors };
  }

  if (next.decision === 'ingest') {
    if (!next.product_cost_id) errors.push('입고할 상품을 선택해야 합니다.');
    if (!next.entry_type) errors.push('입고 방식을 선택해야 합니다.');
  }

  if (next.entry_type === 'subdivision') {
    if (next.items_per_box != null && next.items_per_box < 1) {
      errors.push('박스당 개수는 1 이상이어야 합니다.');
    }
    if (next.subdivision_unit != null && next.subdivision_unit < 1) {
      errors.push('소분 단위는 1 이상이어야 합니다.');
    }
    if (!next.items_per_box || !next.subdivision_unit) {
      if (!errors.some((e) => e.includes('1 이상'))) {
        errors.push('소분 입고에는 박스당 개수와 소분 단위가 모두 필요합니다.');
      }
    }
  }

  return { next, errors };
}
```

- [ ] **Step 4: 통과 확인** — `12 passed`

- [ ] **Step 5: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/lib/receipt/line-patch.ts src/lib/receipt/__tests__/line-patch.test.ts && \
git commit -m "feat(receipt): 줄 수정 유효성 — 현재 값과 합쳐 판정" -- src/lib/receipt/line-patch.ts src/lib/receipt/__tests__/line-patch.test.ts
```

---

## Task 3: 조회 API

**Files:**
- Modify: `src/app/api/receipts/route.ts` (GET 추가, POST 유지)
- Create: `src/app/api/receipts/[id]/route.ts`

- [ ] **Step 1: 목록 GET 추가**

`src/app/api/receipts/route.ts` **맨 위 import에 추가**하고, 파일 **끝에** GET을 붙인다. 기존 POST는 한 줄도 건드리지 마라.

```typescript
import { draftBadge, draftProgress, type ProgressLine } from '@/lib/receipt/view';
```

```typescript
/**
 * GET /api/receipts — 초안 목록
 *
 * 쿼리: `?status=draft|done|discarded|all` (기본 draft), `?limit=` (기본 30)
 *
 * 목록은 줄 전체를 내려보내지 않는다. 카드에 필요한 건 진행률뿐이라
 * 줄은 집계용 최소 필드만 조인한다.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? 'draft';
  const limit = Math.min(Number(searchParams.get('limit') ?? 30) || 30, 100);

  const pool = getSourcingPool();

  const { rows: drafts } = await pool.query(
    `SELECT id, image_paths, purchased_at, store_name, receipt_total, total_item_count,
            verify_status, ocr_status, status, parse_attempts, created_at
     FROM receipt_drafts
     WHERE user_id = $1 ${status === 'all' ? '' : 'AND status = $3'}
     ORDER BY created_at DESC
     LIMIT $2`,
    status === 'all' ? [user.userId, limit] : [user.userId, limit, status],
  );

  if (drafts.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const { rows: lines } = await pool.query(
    `SELECT draft_id, is_discount, decision, product_cost_id, cost_entry_id
     FROM receipt_draft_lines WHERE draft_id = ANY($1)`,
    [drafts.map((d) => d.id)],
  );

  const byDraft = new Map<string, ProgressLine[]>();
  for (const l of lines as ({ draft_id: string } & ProgressLine)[]) {
    const arr = byDraft.get(l.draft_id) ?? [];
    arr.push(l);
    byDraft.set(l.draft_id, arr);
  }

  const data = drafts.map((d) => ({
    ...d,
    image_count: (d.image_paths ?? []).length,
    image_paths: undefined,
    badge: draftBadge(d),
    progress: draftProgress(byDraft.get(d.id) ?? []),
  }));

  return NextResponse.json({ success: true, data });
}
```

- [ ] **Step 2: 상세 GET + 폐기 DELETE**

`src/app/api/receipts/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { draftBadge, draftProgress, type ProgressLine } from '@/lib/receipt/view';
import { netAmountOf } from '@/lib/receipt/discount';
import type { AttributedLine } from '@/lib/receipt/discount';

/**
 * 저장 경로를 공개 URL로 바꾼다.
 *
 * `uploadToStorage`가 업로드 직후 쓰는 것과 같은 SDK 호출이다.
 * 조회 시점에는 업로드가 없으므로 URL 변환만 따로 한다.
 */
function publicUrls(paths: string[]): string[] {
  const supabase = getSupabaseServerClient();
  return paths.map(
    (p) => supabase.storage.from(STORAGE_BUCKET).getPublicUrl(p).data.publicUrl,
  );
}

/**
 * GET /api/receipts/[id] — 초안 상세
 *
 * 각 줄에 **할인 반영 금액**(`net_amount`)을 얹어 내려보낸다.
 * 화면에서 다시 계산하면 확정 경로와 값이 갈릴 수 있다 — 원가가
 * 어느 경로로 계산됐는지에 따라 달라지는 것이 이 기능의 최대 위험이다.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows: drafts } = await pool.query(
    `SELECT id, image_paths, purchased_at, purchased_time, store_name, register_no,
            receipt_total, total_item_count, tax_exempt_total, taxable_total, vat,
            verify_status, verify_detail, ocr_status, status, parse_attempts, created_at
     FROM receipt_drafts WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (drafts.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const draft = drafts[0];

  const { rows } = await pool.query(
    `SELECT id, line_no, item_code, item_label, quantity, unit_price, amount,
            is_discount, applies_to_line_id, tax_type, decision, product_cost_id,
            entry_type, items_per_box, subdivision_unit, cost_entry_id
     FROM receipt_draft_lines WHERE draft_id = $1 ORDER BY line_no`,
    [id],
  );

  // 할인 귀속을 line_no로 되돌린다 — netAmountOf가 그 형태를 쓴다
  const lineNoById = new Map<string, number>(rows.map((l) => [l.id, l.line_no]));
  const attributed: AttributedLine[] = rows.map((l) => ({
    line_no: l.line_no,
    item_code: l.item_code,
    item_label: l.item_label,
    quantity: Number(l.quantity),
    unit_price: l.unit_price,
    amount: l.amount,
    is_discount: l.is_discount,
    tax_type: l.tax_type,
    applies_to_line_no: l.applies_to_line_id ? (lineNoById.get(l.applies_to_line_id) ?? null) : null,
  }));

  const lines = rows.map((l) => ({
    ...l,
    quantity: Number(l.quantity),
    applies_to_line_no: l.applies_to_line_id ? (lineNoById.get(l.applies_to_line_id) ?? null) : null,
    net_amount: l.is_discount ? l.amount : netAmountOf(attributed, l.line_no),
  }));

  return NextResponse.json({
    success: true,
    data: {
      ...draft,
      image_urls: publicUrls(draft.image_paths ?? []),
      image_paths: undefined,
      badge: draftBadge(draft),
      progress: draftProgress(rows as ProgressLine[]),
      lines,
    },
  });
}

/**
 * DELETE /api/receipts/[id] — 초안 폐기
 *
 * 행을 지우지 않고 `status='discarded'`로 둔다. 이미 확정된 줄이 있으면
 * 그 `cost_entries`가 근거를 잃기 때문이다.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rowCount } = await pool.query(
    `UPDATE receipt_drafts SET status = 'discarded', updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'draft'`,
    [id, user.userId],
  );
  if (rowCount === 0) {
    return NextResponse.json(
      { success: false, error: '폐기할 수 있는 초안이 아닙니다.' }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: 타입 검사**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit > /tmp/t3.log 2>&1; echo "exit=$?"; grep -E "api/receipts" /tmp/t3.log || echo "내 파일 오류 없음"
```

- [ ] **Step 4: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/app/api/receipts/route.ts "src/app/api/receipts/[id]/route.ts" && \
git commit -m "feat(receipt): 초안 목록·상세 조회와 폐기" -- src/app/api/receipts/route.ts "src/app/api/receipts/[id]/route.ts"
```

---

## Task 4: 줄 수정 · 재판독 API

**Files:**
- Create: `src/app/api/receipts/[id]/lines/[lineNo]/route.ts`
- Create: `src/app/api/receipts/[id]/retry/route.ts`

- [ ] **Step 1: 줄 수정**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { validateLinePatch, type LineState, type LinePatch } from '@/lib/receipt/line-patch';

/**
 * PATCH /api/receipts/[id]/lines/[lineNo] — 줄 하나 수정
 *
 * Body: `{ decision?, product_cost_id?, entry_type?, items_per_box?, subdivision_unit? }`
 * 보내지 않은 필드는 그대로 두고, null은 지운다는 뜻이다.
 *
 * `remember: true`를 함께 보내면 이 결정을 품번에 기억시킨다.
 * 확정 경로(3편)는 확정할 때만 기억시키므로, **"이 품번은 개인용이라 항상 제외"**
 * 같은 결정은 이 경로로만 저장할 수 있다.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineNo: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id, lineNo } = await params;
  const n = Number(lineNo);
  if (!Number.isInteger(n)) {
    return NextResponse.json({ success: false, error: 'line_no가 정수가 아닙니다.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const remember = body?.remember === true;
  const patch: LinePatch = {};
  for (const k of ['decision', 'product_cost_id', 'entry_type', 'items_per_box', 'subdivision_unit'] as const) {
    if (k in (body ?? {})) (patch as Record<string, unknown>)[k] = body[k];
  }

  const pool = getSourcingPool();

  // 소유권은 초안을 통해 확인한다 — 줄에는 user_id가 없다
  const { rows: cur } = await pool.query(
    `SELECT l.id, l.item_code, l.item_label, l.is_discount, l.decision, l.product_cost_id,
            l.entry_type, l.items_per_box, l.subdivision_unit, l.cost_entry_id
     FROM receipt_draft_lines l
     JOIN receipt_drafts d ON d.id = l.draft_id
     WHERE l.draft_id = $1 AND l.line_no = $2 AND d.user_id = $3`,
    [id, n, user.userId],
  );
  if (cur.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const row = cur[0];

  const { next, errors } = validateLinePatch(patch, row as LineState);
  if (errors.length > 0) {
    return NextResponse.json({ success: false, error: errors.join(' '), errors }, { status: 422 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE receipt_draft_lines SET
         decision = $2, product_cost_id = $3, entry_type = $4,
         items_per_box = $5, subdivision_unit = $6
       WHERE id = $1`,
      [row.id, next.decision, next.product_cost_id, next.entry_type,
       next.items_per_box, next.subdivision_unit],
    );

    if (remember && row.item_code) {
      // 확정 경로와 달리 skip도 기억한다 — "이 품번은 늘 개인용"을 저장할 유일한 경로다
      const decisionToRemember =
        next.decision === 'pending' ? 'ask' : next.decision;
      await client.query(
        `INSERT INTO costco_item_map
           (user_id, item_code, item_label, product_cost_id, default_decision,
            default_entry_type, items_per_box, subdivision_unit, times_used, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,now())
         ON CONFLICT (user_id, item_code) DO UPDATE SET
           item_label = EXCLUDED.item_label,
           product_cost_id = EXCLUDED.product_cost_id,
           default_decision = EXCLUDED.default_decision,
           default_entry_type = EXCLUDED.default_entry_type,
           items_per_box = EXCLUDED.items_per_box,
           subdivision_unit = EXCLUDED.subdivision_unit,
           last_seen_at = now(),
           updated_at = now()`,
        [user.userId, row.item_code, row.item_label, next.product_cost_id,
         decisionToRemember, next.entry_type, next.items_per_box, next.subdivision_unit],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : '수정 실패';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({ success: true, data: next });
}
```

- [ ] **Step 2: 재판독**

`src/app/api/receipts/[id]/retry/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

/**
 * POST /api/receipts/[id]/retry — 판독 실패 초안을 다시 큐에 올린다
 *
 * cron은 `failed`를 절대 다시 집지 않는다(3편). 흐릿한 사진 하나가
 * 영원히 돈을 태우는 것을 막는 장치이므로, 되돌리는 것은 사람만 할 수 있다.
 * `parse_attempts`를 0으로 되돌려 다시 3회의 기회를 준다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rowCount } = await pool.query(
    `UPDATE receipt_drafts SET
       ocr_status = 'pending', parse_attempts = 0, parse_started_at = NULL, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'draft' AND ocr_status = 'failed'`,
    [id, user.userId],
  );
  if (rowCount === 0) {
    return NextResponse.json(
      { success: false, error: '재판독할 수 있는 상태가 아닙니다.' }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: 타입 검사 · 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit > /tmp/t4.log 2>&1; echo "exit=$?"
```

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add "src/app/api/receipts/[id]/lines/[lineNo]/route.ts" "src/app/api/receipts/[id]/retry/route.ts" && \
git commit -m "feat(receipt): 줄 수정과 재판독 API" -- "src/app/api/receipts/[id]/lines/[lineNo]/route.ts" "src/app/api/receipts/[id]/retry/route.ts"
```

---

## Task 5: 상품 선택지 API

**Files:**
- Create: `src/app/api/cost-management/products/options/route.ts`

기존 `GET /api/cost-management/products`는 상품마다 FIFO를 돌려 수익 지표를 만든다. 드롭다운 하나 채우자고 그걸 부를 수 없다.

- [ ] **Step 1: 구현**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

/**
 * GET /api/cost-management/products/options — 상품 선택지
 *
 * 기존 목록 API는 상품마다 FIFO를 계산하므로 드롭다운용으로 쓸 수 없다.
 * 여기서는 이름과 소분 기본값만 낸다.
 *
 * 라우트 경로가 `[id]`와 형제이나 Next.js는 정적 세그먼트를 먼저 맞추고
 * 상품 id는 uuid라 `options`와 충돌하지 않는다.
 */
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT id, product_name, subdivision_unit
     FROM product_costs
     WHERE user_id = $1 AND hidden = false
     ORDER BY product_name`,
    [user.userId],
  );

  return NextResponse.json({ success: true, data: rows });
}
```

- [ ] **Step 2: 실제로 도는지 확인**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && set -a; . ./.env.local 2>/dev/null; set +a
psql "$SOURCING_DATABASE_URL" -tAc "SELECT count(*) FROM product_costs WHERE hidden = false;"
```
Expected: 양수. 0이면 화면의 상품 드롭다운이 비어 확정 자체가 불가능하므로 **여기서 멈추고 보고하라.**

- [ ] **Step 3: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/app/api/cost-management/products/options/route.ts && \
git commit -m "feat(cost): 상품 선택지 경량 조회" -- src/app/api/cost-management/products/options/route.ts
```

---

## Task 6: 목록 화면

**Files:**
- Create: `src/app/m/receipt/layout.tsx`
- Create: `src/app/m/receipt/page.tsx`
- Create: `src/components/receipt/ReceiptList.tsx`

`/m` 하위는 **인라인 스타일**을 쓴다(`src/app/m/costco/layout.tsx` 참고). Tailwind를 새로 들이지 마라.

- [ ] **Step 1: 레이아웃**

```tsx
/**
 * 영수증 모바일 레이아웃 — 상단 고정 헤더 52px
 * src/app/m/costco/layout.tsx와 같은 구조다
 */
import React from 'react';

export default function ReceiptLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f4f4f4' }}>
      <header
        style={{
          position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: '480px', height: '52px',
          backgroundColor: '#ffffff', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', padding: '0 16px',
          zIndex: 100, boxSizing: 'border-box',
        }}
      >
        <span style={{ fontSize: '16px', fontWeight: 700, color: '#1a1c1c', letterSpacing: '-0.3px' }}>
          영수증 입고
        </span>
      </header>
      <main style={{ paddingTop: '52px' }}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: 페이지**

```tsx
/**
 * 영수증 초안 목록
 */
import ReceiptList from '@/components/receipt/ReceiptList';

export default function ReceiptPage() {
  return <ReceiptList />;
}
```

- [ ] **Step 3: 목록 컴포넌트**

```tsx
'use client';

/**
 * 영수증 초안 목록 + 촬영 업로드
 *
 * 판독 중인 초안이 하나라도 있으면 5초마다 다시 조회한다.
 * cron이 10분 주기라 대기가 길 수 있으므로 상태를 계속 보여준다.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Badge } from '@/lib/receipt/view';

interface DraftCard {
  id: string;
  purchased_at: string | null;
  store_name: string | null;
  receipt_total: number | null;
  image_count: number;
  created_at: string;
  badge: Badge;
  progress: { total: number; confirmed: number; ready: number; blocked: number; undecided: number };
}

const TONE: Record<string, { bg: string; fg: string }> = {
  ok: { bg: '#e7f6ec', fg: '#1a7f37' },
  warn: { bg: '#fff4e5', fg: '#b45309' },
  danger: { bg: '#fdecec', fg: '#b91c1c' },
  neutral: { bg: '#eef0f2', fg: '#4b5563' },
};

function won(n: number | null) {
  return n == null ? '—' : `${n.toLocaleString('ko-KR')}원`;
}

export default function ReceiptList() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/receipts?status=draft');
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '조회 실패');
      setDrafts(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 판독 대기·판독 중이 있으면 폴링한다
  useEffect(() => {
    if (!drafts.some((d) => d.badge.busy)) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [drafts, load]);

  async function upload(files: FileList) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const res = await fetch('/api/receipts', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '업로드 실패');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 실패');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div style={{ padding: '16px' }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); }}
      />

      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{
          width: '100%', height: '56px', borderRadius: '12px', border: 'none',
          backgroundColor: uploading ? '#9ca3af' : '#1a7f37', color: '#fff',
          fontSize: '16px', fontWeight: 700, marginBottom: '16px',
        }}
      >
        {uploading ? '업로드 중…' : '영수증 촬영'}
      </button>

      {error && (
        <div style={{
          padding: '12px', borderRadius: '8px', backgroundColor: '#fdecec',
          color: '#b91c1c', fontSize: '13px', marginBottom: '12px',
        }}>{error}</div>
      )}

      {loading && <div style={{ color: '#6b7280', fontSize: '14px' }}>불러오는 중…</div>}

      {!loading && drafts.length === 0 && (
        <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px', padding: '48px 0' }}>
          대기 중인 영수증이 없습니다.<br />장을 보고 오면 여기에 쌓입니다.
        </div>
      )}

      {drafts.map((d) => {
        const tone = TONE[d.badge.tone] ?? TONE.neutral;
        return (
          <div
            key={d.id}
            onClick={() => router.push(`/m/receipt/${d.id}`)}
            style={{
              backgroundColor: '#fff', borderRadius: '12px', padding: '14px',
              marginBottom: '10px', border: '1px solid #e5e7eb', cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#1a1c1c' }}>
                {d.purchased_at ? String(d.purchased_at).slice(0, 10) : '날짜 미확인'}
              </span>
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px',
                backgroundColor: tone.bg, color: tone.fg,
              }}>{d.badge.label}</span>
            </div>

            <div style={{ marginTop: '6px', fontSize: '13px', color: '#4b5563' }}>
              {d.store_name ?? '매장 미확인'} · {won(d.receipt_total)} · 사진 {d.image_count}장
            </div>

            {d.progress.total > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                품목 {d.progress.total} · 확정 {d.progress.confirmed}
                {d.progress.ready > 0 && <span style={{ color: '#1a7f37', fontWeight: 700 }}> · 확정 대기 {d.progress.ready}</span>}
                {d.progress.undecided > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}> · 미정 {d.progress.undecided}</span>}
                {d.progress.blocked > 0 && <span style={{ color: '#b91c1c', fontWeight: 700 }}> · 상품 미지정 {d.progress.blocked}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: 빌드 확인**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit > /tmp/t6.log 2>&1; echo "exit=$?"; grep -E "m/receipt|components/receipt" /tmp/t6.log || echo "내 파일 오류 없음"
```

- [ ] **Step 5: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/app/m/receipt/layout.tsx src/app/m/receipt/page.tsx src/components/receipt/ReceiptList.tsx && \
git commit -m "feat(receipt): 모바일 목록 화면과 촬영 업로드" -- src/app/m/receipt/layout.tsx src/app/m/receipt/page.tsx src/components/receipt/ReceiptList.tsx
```

---

## Task 7: 상세·확정 화면

**Files:**
- Create: `src/app/m/receipt/[id]/page.tsx`
- Create: `src/components/receipt/ReceiptDetail.tsx`
- Create: `src/components/receipt/ReceiptLineRow.tsx`

- [ ] **Step 1: 페이지**

```tsx
/**
 * 영수증 초안 상세 — 검토 후 확정
 */
import ReceiptDetail from '@/components/receipt/ReceiptDetail';

export default async function ReceiptDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptDetail draftId={id} />;
}
```

- [ ] **Step 2: 줄 컴포넌트**

```tsx
'use client';

/**
 * 영수증 줄 하나. 결정·상품·소분 파라미터를 여기서 고친다.
 *
 * 금액은 **서버가 계산한 net_amount**를 그대로 보여준다.
 * 화면에서 다시 계산하면 확정 경로와 값이 갈릴 수 있고,
 * 그 어긋남은 원가에 그대로 들어간다.
 */

import { useState } from 'react';

export interface LineData {
  id: string;
  line_no: number;
  item_code: string | null;
  item_label: string;
  quantity: number;
  amount: number;
  net_amount: number;
  is_discount: boolean;
  applies_to_line_no: number | null;
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
  cost_entry_id: string | null;
}

export interface ProductOption {
  id: string;
  product_name: string;
  subdivision_unit: number | null;
}

interface Props {
  line: LineData;
  products: ProductOption[];
  onPatch: (lineNo: number, patch: Record<string, unknown>) => Promise<void>;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export default function ReceiptLineRow({ line, products, onPatch }: Props) {
  const [busy, setBusy] = useState(false);
  const locked = line.cost_entry_id != null;

  async function patch(p: Record<string, unknown>) {
    setBusy(true);
    try { await onPatch(line.line_no, p); } finally { setBusy(false); }
  }

  if (line.is_discount) {
    return (
      <div style={{
        padding: '8px 14px', fontSize: '12px', color: '#b45309',
        backgroundColor: '#fffaf0', borderLeft: '3px solid #f59e0b',
      }}>
        할인 {won(line.amount)}
        {line.applies_to_line_no != null && ` → ${line.applies_to_line_no}번 줄에 반영됨`}
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: '#fff', borderRadius: '10px', padding: '12px',
      marginBottom: '8px', border: '1px solid #e5e7eb',
      opacity: busy ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#1a1c1c', flex: 1 }}>
          {line.item_label}
        </span>
        <span style={{ fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {won(line.net_amount)}
        </span>
      </div>

      <div style={{ marginTop: '3px', fontSize: '11px', color: '#6b7280' }}>
        {line.item_code ?? '품번 없음'} · {line.quantity}개
        {line.net_amount !== line.amount && (
          <span style={{ color: '#b45309', fontWeight: 700 }}> · 할인 전 {won(line.amount)}</span>
        )}
      </div>

      {locked ? (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#1a7f37', fontWeight: 700 }}>
          입고 완료 — 수정할 수 없습니다
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            {(['ingest', 'skip'] as const).map((d) => (
              <button
                key={d}
                disabled={busy}
                onClick={() => void patch({ decision: d })}
                style={{
                  flex: 1, height: '34px', borderRadius: '8px', fontSize: '13px', fontWeight: 700,
                  border: line.decision === d ? 'none' : '1px solid #d1d5db',
                  backgroundColor: line.decision === d ? (d === 'ingest' ? '#1a7f37' : '#6b7280') : '#fff',
                  color: line.decision === d ? '#fff' : '#4b5563',
                }}
              >
                {d === 'ingest' ? '입고' : '제외'}
              </button>
            ))}
          </div>

          {line.decision === 'ingest' && (
            <>
              <select
                disabled={busy}
                value={line.product_cost_id ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  const prod = products.find((p) => p.id === id);
                  void patch({
                    product_cost_id: id,
                    entry_type: line.entry_type ?? 'normal',
                    subdivision_unit: line.subdivision_unit ?? prod?.subdivision_unit ?? null,
                  });
                }}
                style={{
                  width: '100%', height: '38px', marginTop: '8px', borderRadius: '8px',
                  border: line.product_cost_id ? '1px solid #d1d5db' : '1px solid #f87171',
                  padding: '0 8px', fontSize: '13px', backgroundColor: '#fff',
                }}
              >
                <option value="">상품 선택…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.product_name}</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                {(['normal', 'subdivision'] as const).map((t) => (
                  <button
                    key={t}
                    disabled={busy}
                    onClick={() => void patch({ entry_type: t })}
                    style={{
                      flex: 1, height: '30px', borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                      border: line.entry_type === t ? 'none' : '1px solid #d1d5db',
                      backgroundColor: line.entry_type === t ? '#374151' : '#fff',
                      color: line.entry_type === t ? '#fff' : '#4b5563',
                    }}
                  >
                    {t === 'normal' ? '일반' : '소분'}
                  </button>
                ))}
              </div>

              {line.entry_type === 'subdivision' && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <label style={{ flex: 1, fontSize: '11px', color: '#6b7280' }}>
                    박스당 개수
                    <input
                      type="number" min={1} inputMode="numeric"
                      defaultValue={line.items_per_box ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v !== line.items_per_box) void patch({ items_per_box: v });
                      }}
                      style={{ width: '100%', height: '34px', borderRadius: '8px',
                               border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px' }}
                    />
                  </label>
                  <label style={{ flex: 1, fontSize: '11px', color: '#6b7280' }}>
                    소분 단위
                    <input
                      type="number" min={1} inputMode="numeric"
                      defaultValue={line.subdivision_unit ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v !== line.subdivision_unit) void patch({ subdivision_unit: v });
                      }}
                      style={{ width: '100%', height: '34px', borderRadius: '8px',
                               border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px' }}
                    />
                  </label>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 상세 컴포넌트**

```tsx
'use client';

/**
 * 영수증 초안 상세 — 검토하고 확정한다.
 *
 * 판독이 안 끝난 초안은 5초마다 다시 조회한다.
 * 검산이 깨졌다고 확정을 막지는 않는다 — 사람이 보고 판단할 정보를 줄 뿐이다.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Badge } from '@/lib/receipt/view';
import ReceiptLineRow, { type LineData, type ProductOption } from './ReceiptLineRow';

interface Detail {
  id: string;
  purchased_at: string | null;
  store_name: string | null;
  receipt_total: number | null;
  total_item_count: number | null;
  ocr_status: string;
  verify_status: string;
  verify_detail: Record<string, { status: string; expected: number | null; actual: number | null; diff: number | null; badLineNos?: number[] }> | null;
  status: string;
  image_urls: string[];
  badge: Badge;
  progress: { total: number; confirmed: number; ready: number; blocked: number; undecided: number };
  lines: LineData[];
}

const CHECK_LABEL: Record<string, string> = {
  totalSum: '품목 합계',
  lineArithmetic: '줄별 수량×단가',
  itemCount: '총 상품수',
  taxBreakdown: '과세·면세 구분',
};

const won = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('ko-KR')}원`);

export default function ReceiptDetail({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/receipts/${draftId}`);
    const json = await res.json();
    if (!json.success) { setError(json.error ?? '조회 실패'); return; }
    setD(json.data);
  }, [draftId]);

  useEffect(() => {
    void load();
    void (async () => {
      const res = await fetch('/api/cost-management/products/options');
      const json = await res.json();
      if (json.success) setProducts(json.data);
    })();
  }, [load]);

  useEffect(() => {
    if (!d?.badge.busy) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [d, load]);

  const patchLine = useCallback(async (lineNo: number, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/receipts/${draftId}/lines/${lineNo}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!json.success) { setError(json.error ?? '수정 실패'); return; }
    setError(null);
    await load();
  }, [draftId, load]);

  async function confirm() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/receipts/${draftId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '확정 실패');
      const { created, failed } = json.data;
      setResult(
        failed.length > 0
          ? `${created.length}건 입고, ${failed.length}건 실패: ${failed.map((f: {line_no: number; error: string}) => `${f.line_no}번 ${f.error}`).join(' / ')}`
          : `${created.length}건 입고 완료`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '확정 실패');
    } finally {
      setConfirming(false);
    }
  }

  async function retry() {
    const res = await fetch(`/api/receipts/${draftId}/retry`, { method: 'POST' });
    const json = await res.json();
    if (!json.success) { setError(json.error ?? '재판독 실패'); return; }
    await load();
  }

  if (error && !d) return <div style={{ padding: '16px', color: '#b91c1c' }}>{error}</div>;
  if (!d) return <div style={{ padding: '16px', color: '#6b7280' }}>불러오는 중…</div>;

  const failedChecks = Object.entries(d.verify_detail ?? {})
    .filter(([k, v]) => k !== 'status' && v?.status === 'fail');

  return (
    <div style={{ padding: '16px', paddingBottom: '96px' }}>
      <button onClick={() => router.push('/m/receipt')}
        style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: '13px',
                 padding: 0, marginBottom: '12px' }}>← 목록</button>

      <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '14px',
                    border: '1px solid #e5e7eb', marginBottom: '12px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700 }}>
          {d.purchased_at ? String(d.purchased_at).slice(0, 10) : '날짜 미확인'}
          {d.store_name && <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 400 }}> · {d.store_name}</span>}
        </div>
        <div style={{ marginTop: '4px', fontSize: '13px', color: '#4b5563' }}>
          합계 {won(d.receipt_total)} · 총 {d.total_item_count ?? '—'}개 · 품목 {d.progress.total}줄
        </div>
      </div>

      {d.ocr_status === 'failed' && (
        <div style={{ backgroundColor: '#fdecec', borderRadius: '10px', padding: '12px',
                      marginBottom: '12px' }}>
          <div style={{ color: '#b91c1c', fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>
            판독에 3번 실패했습니다.
          </div>
          <div style={{ color: '#7f1d1d', fontSize: '12px', marginBottom: '10px' }}>
            사진이 흐리거나 잘렸을 수 있습니다. 다시 찍는 편이 빠를 수도 있습니다.
          </div>
          <button onClick={() => void retry()}
            style={{ width: '100%', height: '38px', borderRadius: '8px', border: 'none',
                     backgroundColor: '#b91c1c', color: '#fff', fontSize: '13px', fontWeight: 700 }}>
            다시 판독
          </button>
        </div>
      )}

      {failedChecks.length > 0 && (
        <div style={{ backgroundColor: '#fff4e5', borderRadius: '10px', padding: '12px',
                      marginBottom: '12px', fontSize: '12px', color: '#7c2d12' }}>
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>검산이 맞지 않습니다 — 확정 전에 확인하세요</div>
          {failedChecks.map(([k, v]) => (
            <div key={k} style={{ marginTop: '3px' }}>
              · {CHECK_LABEL[k] ?? k}
              {v.badLineNos?.length ? ` — ${v.badLineNos.join(', ')}번 줄` : ''}
              {v.diff != null ? ` — 차액 ${v.diff.toLocaleString('ko-KR')}원` : ''}
            </div>
          ))}
        </div>
      )}

      {d.badge.busy && (
        <div style={{ backgroundColor: '#eef0f2', borderRadius: '10px', padding: '14px',
                      textAlign: 'center', color: '#4b5563', fontSize: '13px', marginBottom: '12px' }}>
          {d.badge.label}입니다. 10분 주기로 자동 처리됩니다.
        </div>
      )}

      {result && (
        <div style={{ backgroundColor: '#e7f6ec', borderRadius: '10px', padding: '12px',
                      marginBottom: '12px', fontSize: '13px', color: '#1a7f37', fontWeight: 700 }}>
          {result}
        </div>
      )}

      {error && (
        <div style={{ backgroundColor: '#fdecec', borderRadius: '10px', padding: '12px',
                      marginBottom: '12px', fontSize: '13px', color: '#b91c1c' }}>{error}</div>
      )}

      {d.lines.map((l) => (
        <ReceiptLineRow key={l.id} line={l} products={products} onPatch={patchLine} />
      ))}

      {d.progress.ready > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: '480px', padding: '12px 16px',
          backgroundColor: '#fff', borderTop: '1px solid #e5e7eb', boxSizing: 'border-box',
        }}>
          <button
            onClick={() => void confirm()}
            disabled={confirming}
            style={{
              width: '100%', height: '50px', borderRadius: '12px', border: 'none',
              backgroundColor: confirming ? '#9ca3af' : '#1a7f37', color: '#fff',
              fontSize: '16px', fontWeight: 700,
            }}
          >
            {confirming ? '입고 중…' : `${d.progress.ready}건 입고 확정`}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 타입 검사**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit > /tmp/t7.log 2>&1; echo "exit=$?"; grep -E "receipt" /tmp/t7.log || echo "내 파일 오류 없음"
```

- [ ] **Step 5: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add "src/app/m/receipt/[id]/page.tsx" src/components/receipt/ReceiptDetail.tsx src/components/receipt/ReceiptLineRow.tsx && \
git commit -m "feat(receipt): 모바일 검토·확정 화면" -- "src/app/m/receipt/[id]/page.tsx" src/components/receipt/ReceiptDetail.tsx src/components/receipt/ReceiptLineRow.tsx
```

---

## Task 8: 미뤄둔 숙제 — entries 라우트 테스트

**Files:**
- Create: `src/__tests__/api/cost-management-entries-post.test.ts`

3편에서 `POST /api/cost-management/products/[id]/entries`를 리팩터했는데, **이 라우트를 호출하는 테스트가 코드베이스에 하나도 없다.** 리팩터의 근거가 tsc와 코드 대조뿐이었다. 여기서 메운다.

- [ ] **Step 1: 테스트 작성**

```typescript
// @vitest-environment node
/**
 * POST /api/cost-management/products/[id]/entries
 *
 * 3편에서 createCostEntry()로 로직을 추출했으나 이 라우트를 호출하는
 * 테스트가 없었다. DB를 모킹해 라우트 자신의 분기(검증·응답·에러 매핑)를 고정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query, release }));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: async () => ({ userId: 'u1', email: 't@t' }),
}));
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query, connect }),
}));

const { POST } = await import('@/app/api/cost-management/products/[id]/entries/route');

function req(body: unknown) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never;
}
const ctx = { params: Promise.resolve({ id: 'prod-1' }) };

beforeEach(() => {
  query.mockReset();
  release.mockReset();
});

describe('POST entries', () => {
  it('필수 필드가 없으면 400이다', async () => {
    const res = await POST(req({ received_at: '2026-08-09' }), ctx);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('수량이 0 이하면 400이다', async () => {
    const res = await POST(req({ received_at: '2026-08-09', quantity: 0, unit_cost: 100 }), ctx);
    expect(res.status).toBe(400);
  });

  it('없는 상품이면 404이고 트랜잭션을 롤백한다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM product_costs')) return { rows: [] };
      return { rows: [] };
    });
    const res = await POST(req({ received_at: '2026-08-09', quantity: 1, unit_cost: 100 }), ctx);
    expect(res.status).toBe(404);
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });

  it('일반 입고가 201로 생성된다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM product_costs')) {
        return { rows: [{ id: 'prod-1', subdivision_unit: null, subdivision_carryover: 0, subdivision_carryover_unit_cost: 0 }] };
      }
      if (sql.includes('INSERT INTO cost_entries')) {
        return { rows: [{ id: 'entry-1', quantity: 3, unit_cost: 1000 }] };
      }
      return { rows: [] };
    });

    const res = await POST(req({ received_at: '2026-08-09', quantity: 3, unit_cost: 1000 }), ctx);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('entry-1');
    expect(json).not.toHaveProperty('carryover_out');

    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('COMMIT');

    // 🔴 source_receipt_line_id는 이 경로에서 null이어야 한다
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO cost_entries'))!;
    expect((insert[1] as unknown[]).at(-1)).toBeNull();
  });

  it('소분 입고는 이월을 갱신하고 carryover_out을 응답에 넣는다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM product_costs')) {
        return { rows: [{ id: 'prod-1', subdivision_unit: 10, subdivision_carryover: 0, subdivision_carryover_unit_cost: 0 }] };
      }
      if (sql.includes('INSERT INTO cost_entries')) return { rows: [{ id: 'entry-2' }] };
      return { rows: [] };
    });

    const res = await POST(
      req({ received_at: '2026-08-09', unit_cost: 36000, purchase_quantity: 72 }), ctx);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.carryover_out).toBe(2);

    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('UPDATE product_costs SET subdivision_carryover'))).toBe(true);
  });

  it('팩을 못 채우면 400이고 메시지가 보존된다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM product_costs')) {
        return { rows: [{ id: 'prod-1', subdivision_unit: 100, subdivision_carryover: 0, subdivision_carryover_unit_cost: 0 }] };
      }
      return { rows: [] };
    });

    const res = await POST(
      req({ received_at: '2026-08-09', unit_cost: 5000, purchase_quantity: 3 }), ctx);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('팩을 완성하기에 수량이 부족합니다');
  });
});
```

- [ ] **Step 2: 실행**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx vitest run src/__tests__/api/cost-management-entries-post.test.ts 2>&1 | tail -25
```

**하나라도 실패하면 테스트가 아니라 구현을 의심하라.** 이 테스트들은 3편 리팩터 이전 동작을 기술한 것이다. 실패한다면 리팩터가 동작을 바꿨다는 뜻이고, 그게 이 태스크가 존재하는 이유다. **실패 내용을 그대로 보고하고 멈춰라.**

- [ ] **Step 3: 커밋**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && \
git add src/__tests__/api/cost-management-entries-post.test.ts && \
git commit -m "test(cost): 입고 생성 라우트 회귀 고정" -- src/__tests__/api/cost-management-entries-post.test.ts
```

---

## Task 9: 회귀와 실물 통과

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 회귀**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx vitest run > /tmp/full4.log 2>&1; echo "exit=$?"; grep -E "Test Files|Tests  " /tmp/full4.log | tail -3
```

Expected: **14 failed에서 늘지 않는다.** 통과는 신규 분(view 13 + line-patch 12 + entries 6 = 31)만큼 는다.

기존 14건은 이 기능과 무관한 사전 실패다(삭제된 네이버 탭 5건, `cleanup-image-region` 회귀 1건, 키워드 5건, 기타 3건).

- [ ] **Step 2: 빌드**

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npx tsc --noEmit && echo "tsc OK"
cd /Users/seungminlee/dev/smart_seller_studio && npx next build > /tmp/build4.log 2>&1; echo "exit=$?"; grep -E "m/receipt|Error|error" /tmp/build4.log | head -20
```

**`next build`를 반드시 돌려라.** 클라이언트 컴포넌트의 `'use client'` 누락이나 서버/클라이언트 경계 위반은 `tsc`가 잡지 못한다.

- [ ] **Step 3: 실물 통과 — 사람이 한다**

에이전트가 할 수 없다. 사용자에게 아래를 요청하고 결과를 받아라.

```bash
cd /Users/seungminlee/dev/smart_seller_studio && npm run dev
```

폰이나 브라우저에서 `http://localhost:3000/m/receipt`를 연다.

| 순서 | 확인할 것 |
|---|---|
| 1 | 「영수증 촬영」으로 실물 영수증을 올린다 → 카드가 「판독 대기」로 뜬다 |
| 2 | 판독을 기다리지 말고 `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/parse-receipts`로 당긴다 |
| 3 | 카드가 「검산 통과」로 바뀌고 품목 수가 뜬다 |
| 4 | 카드를 눌러 상세로 들어간다. **할인 줄이 별도 줄로 보이고, 원 품목의 금액이 할인 반영 후 값인가** |
| 5 | 품목에 상품을 지정하고 「입고」로 바꾼다 → 하단에 「N건 입고 확정」이 나타난다 |
| 6 | 확정을 누른다 → 「N건 입고 완료」, 각 줄이 「입고 완료」로 잠긴다 |
| 7 | 수익원가 탭에서 그 상품의 입고가 실제로 늘었는가 |
| 8 | 목록으로 돌아가면 그 초안이 사라진다(status=done) |

**4번과 7번이 이 기능의 존재 이유다.** 나머지가 다 되어도 그 둘이 틀리면 실패다.

---

## 완료 기준

| 항목 | 확인 |
|---|---|
| 폰으로 영수증을 올릴 수 있다 | Task 6 |
| 앱을 닫아도 판독된다 | 3편 cron + 목록 폴링 |
| 할인 반영 금액이 화면에 보인다 | Task 7 · 서버 계산값을 그대로 표시 |
| 품목마다 상품을 지정할 수 있다 | Task 7 |
| 확정하면 실제 입고가 된다 | 3편 확정 API |
| 판독 실패를 되살릴 수 있다 | Task 4 |
| 기존 입고 라우트가 테스트로 고정됐다 | Task 8 |

**아직 없는 것** — 데스크탑 확정 화면(5편), 이미지 보관 정책, 초안 검색·기간 필터.

## Open Questions

- **`remember` 체크박스를 화면에 노출할 것인가.** API는 Task 4에서 지원하나 화면은 아직 안 쓴다. **"이 품번은 늘 개인용"을 저장할 유일한 경로**이므로 쓸모가 크지만, 줄마다 체크박스를 더하면 화면이 복잡해진다. 실사용 몇 번 뒤에 정하는 편이 낫다
- **폴링 5초가 맞는가.** cron이 10분 주기라 사실상 화면을 열어두는 내내 헛돈다. 판독 대기 중에는 30초로 늘리는 편이 나을 수 있다
- **이미지 보관 기간.** 공개 버킷이라(스펙 §7) 오래 둘수록 노출 창이 길어진다. 상세 화면이 `image_urls`를 내려받기 시작하므로 이제 URL이 실제로 브라우저 히스토리에 남는다

---

## 실행 결과 (2026-08-09)

전 태스크 완료. 계획과 달라진 것과, 계획이 사람에게 미룬 것을 어디까지 자동화했는지 남긴다.

### 계획과 달라진 것

| 항목 | 계획 | 실제 | 이유 |
|---|---|---|---|
| 폴링 주기 | 5초 | **20초** | cron이 10분 주기라 5초 폴링은 대부분 헛돈다. 계획의 Open Question을 착수 전에 닫았다 |
| `getPublicUrl` | 있다고 가정 | **없음** | `src/lib/supabase/server.ts`에 없어 `publicUrls()` 지역 헬퍼로 대체. `uploadToStorage`와 같은 SDK 호출을 쓴다 |
| `verify_detail` 필터 | 타입 술어 | 일반 필터 + 캐스팅 | `TS1230: A type predicate cannot reference element 'v' in a binding pattern` |

### Task 9 — 사람이 하기로 한 것을 어디까지 대체했나

계획은 8단계 수동 확인을 사람에게 미뤘다. 그중 **API 층은 전부 자동화했고, 화면 층은 컴포넌트 테스트로 덮었다.**

| 계획의 수동 확인 | 대체 방법 | 결과 |
|---|---|---|
| 업로드 → 카드 생성 | 컴포넌트 테스트 (fetch 스파이로 `files` 필드 확인) | ✅ |
| 판독 상태 표시 | 컴포넌트 테스트 | ✅ |
| **할인 반영 금액 표시** | 컴포넌트 + 실DB API | ✅ 32,990 → **25,990** |
| 상품 지정 → 확정 버튼 | 실DB: PATCH 후 `progress.ready` 1로 전이 | ✅ |
| **확정 → 실제 입고** | 실DB: `cost_entries.unit_cost = 25990` | ✅ |
| 확정 후 줄 잠금 | 실DB: 재수정 시 422 | ✅ |
| 목록에서 사라짐 | 실DB: `status='done'`, 목록 미포함 | ✅ |
| 수익원가 탭에서 확인 | — | 🔴 **미확인. 사람이 봐야 한다** |

실DB 검증 12건은 실제 라우트 핸들러를 호출했고(인증만 모킹), 끝나고 생성한 데이터를 전부 지웠다. `cost_entries` 총계는 251건으로 변동 없다.

**남은 진짜 수동 확인은 두 가지다.** ① 폰 실물에서 카메라가 열리고 레이아웃이 480px에 맞는가 ② 만들어진 입고가 수익원가 탭에 제대로 보이는가. 둘 다 렌더링·기기 문제라 자동화로 대체할 수 없다.

### 최종 수치

| 항목 | 값 |
|---|---|
| 커밋 | 9 |
| 신규 테스트 | 50 (순수 25 · entries 6 · 화면 19) |
| 회귀 | 14 failed / 3,051 passed — **실패는 기준선과 동일** |
| `tsc --noEmit` | exit 0 |
| `next build` | exit 0 · 라우트 9개 등록 확인 |
