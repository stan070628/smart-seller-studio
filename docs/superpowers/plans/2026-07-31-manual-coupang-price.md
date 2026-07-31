# 쿠팡 실판가 수동 입력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 쇼핑 검색 API 종료로 자동 시세가 끊긴 상태에서, 발굴 탭 한 화면에서 후보를 보고 쿠팡 실판가를 직접 넣어 판정하고 소싱리스트에 담을 수 있게 한다.

**Architecture:** 죽은 `estimateCoupangPrice` 호출을 판정 경로에서 걷어내고 **저장된 수동 p25**를 쓰도록 바꾼 뒤, 발굴 탭이 실행 결과를 폴링으로 받아 표시하고 거기서 가격 입력·담기를 처리한다. 손익분기 계산은 순수 함수라 그대로 재사용하며 브라우저에서도 같은 산식을 쓴다.

**Tech Stack:** Next.js App Router (`after` from `next/server`), TypeScript, Vitest, Postgres(`getSourcingPool`), 도매꾹 API

**Spec:** `docs/superpowers/specs/2026-07-31-manual-coupang-price-design.md`

---

## 배경 — 왜 이 계획이 필요한가

네이버 쇼핑 검색 API가 2026-07-31자로 영구 종료됐다(개발자센터 공지 32530). 유예 없음, 대체 없음, 기존 키도 호출 불가.

- `GET /v1/search/shop.json` → HTTP 404 `SE05`, 같은 키로 `blog.json`은 200
- `sourcing_shortlist` 중 `coupang_p25 IS NOT NULL` → **0건. 한 번도 채워진 적 없음**

따라서 `estimateCoupangPrice`는 **영구히 `null`을 반환**한다. 그 결과 모든 후보가 `unknown`이 되고, `keyword-pipeline`의 자동 적재 조건(`verdict === 'pass'`)이 발동하지 않아 소싱리스트가 영원히 비어 있다.

**`breakEvenPrice`는 순수 함수라 살아 있다.** 없어진 것은 "쿠팡에서 얼마에 팔리나" 한 값뿐이다.

---

## File Structure

**신규 파일**

| 경로 | 책임 |
|---|---|
| `src/app/api/sourcing/agent/run/status/route.ts` | 실행 상태·결과 폴링 조회 |
| `src/__tests__/api/sourcing-agent-run-status.test.ts` | 위 라우트 테스트 |
| `src/__tests__/lib/sourcing/shortlist-verify-manual-price.test.ts` | 수동 p25 보존 검증 |
| `supabase/migrations/097_keyword_results_unit_deli_fee.sql` | 후보 개당 배송비 컬럼 |
| `src/__tests__/lib/sourcing-agent/keyword-db.test.ts` | 배송비 저장 검증 |

**수정 파일**

| 경로 | 변경 |
|---|---|
| `src/lib/sourcing/shortlist-verify.ts` | `buildVerifyResult`가 저장된 p25를 받게. `estimateCoupangPrice` 호출 제거 |
| `src/lib/sourcing/shortlist-db.ts` | `VerifyTarget`·`listForVerify`에 `coupangP25` 추가, `ShortlistPatch`에 `coupangP25` |
| `src/app/api/sourcing/shortlist/[itemNo]/route.ts` | `coupangP25` 검증·수용 |
| `src/app/api/sourcing/agent/run/route.ts` | `createRequest` 선행 호출, `runs` 응답 |
| `src/lib/sourcing-agent/keyword-pipeline.ts` | `requestId` 인자 수용, 자동 적재 블록 제거, 배송비 저장 |
| `src/lib/sourcing-agent/keyword-db.ts` | `KeywordResultInsert`에 `unit_deli_fee` |
| `src/components/sourcing/DiscoveryTab.tsx` | 결과 폴링·표시·가격 입력·담기 |
| `src/components/sourcing/ShortlistTab.tsx` | 쿠팡가 입력칸 |

---

## Task 1: 재검증이 저장된 수동 p25를 쓰게 한다

**Files:**
- Modify: `src/lib/sourcing/shortlist-verify.ts:152-158, 242`
- Test: `src/__tests__/lib/sourcing/shortlist-verify-manual-price.test.ts`

`buildVerifyResult`의 `title` 인자는 **오직 `estimateCoupangPrice(title)`를 위해서만** 쓰인다. 그 호출을 걷어내면 인자가 불필요해지고, 대신 행에 저장된 p25를 받아 판정한다. 도매꾹 가격·재고 갱신은 그대로 살고 사람이 넣은 값은 보존된다.

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/sourcing/shortlist-verify-manual-price.test.ts` 신규 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { buildVerifyResult, type DomeSnapshot } from '@/lib/sourcing/shortlist-verify';

const dome: DomeSnapshot = {
  status: '판매중',
  price: 3300,
  inventory: 500,
  moq: 1,
  deli: { who: 'P', fee: '3000' },
};

describe('buildVerifyResult — 수동 입력 p25 사용', () => {
  it('저장된 p25로 판정한다 (외부 시세 조회 없음)', async () => {
    const r = await buildVerifyResult(dome, 10, 'xsmall', 10500);

    expect(r.coupangP25).toBe(10500);
    expect(r.effectiveCost).toBe(3600);   // 3300 + ceil(3000/10)
    expect(r.breakEvenPrice).toBe(9471);  // 2026-07-31 원가 모델
    expect(r.verdict).toBe('pass');       // 10500 >= 9471
  });

  it('p25가 null이면 unknown이되 원가·손익분기는 채운다', async () => {
    const r = await buildVerifyResult(dome, 10, 'xsmall', null);

    expect(r.coupangP25).toBeNull();
    expect(r.verdict).toBe('unknown');
    expect(r.effectiveCost).toBe(3600);
    expect(r.breakEvenPrice).toBe(9471);  // 시세를 몰라도 손익분기는 계산된다
    expect(r.margin).toBeNull();
  });

  it('손익분기 미달이면 fail이다', async () => {
    const r = await buildVerifyResult(dome, 10, 'xsmall', 9000);
    expect(r.verdict).toBe('fail');
  });

  it('삭제된 상품은 p25가 있어도 dead다', async () => {
    const r = await buildVerifyResult(null, 10, 'xsmall', 10500);
    expect(r.verdict).toBe('dead');
    expect(r.domeStatus).toBe('삭제됨');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-verify-manual-price.test.ts`
Expected: FAIL — 인자 개수 불일치 또는 `Expected 4 arguments, but got 4` 타입 오류

- [ ] **Step 3: 구현**

`src/lib/sourcing/shortlist-verify.ts`에서 `estimateCoupangPrice` import를 제거한다:

```typescript
import { breakEvenPrice, marginOf } from '@/lib/sourcing/coupang-price';
```

`buildVerifyResult` 시그니처를 교체한다:

```typescript
/**
 * 검증 결과를 계산한다.
 *
 * 2026-07-31 변경: 네이버 쇼핑 검색 API가 종료돼 estimateCoupangPrice가 영구히
 * null을 반환한다. 시세는 사용자가 직접 입력해 행에 저장되므로, 그 값을 인자로
 * 받아 판정한다. 이 함수는 이제 외부 호출이 전혀 없다.
 *
 * title 인자를 없앤 이유: 오직 estimateCoupangPrice(title)를 위해서만 쓰였다.
 *
 * @param dome null이면 도매꾹에서 삭제된 상품
 * @param storedCoupangP25 행에 저장된 쿠팡 실판가. null이면 판정 불가(unknown)
 */
export async function buildVerifyResult(
  dome: DomeSnapshot | null,
  orderQty: number,
  logisticsSize: LogisticsSize,
  storedCoupangP25: number | null,
): Promise<VerifyResult> {
```

본문의 `const estimate = await estimateCoupangPrice(title);` 줄을 삭제하고, 그 아래 두 분기를 교체한다:

```typescript
  // 시세 미입력 — 판정 불가. fail과 구분한다.
  // 원가·손익분기는 시세와 무관하게 계산되므로 여기서도 채운다.
  if (storedCoupangP25 === null) {
    return {
      domeStatus: dome.status,
      domePrice: dome.price,
      domeInventory: dome.inventory,
      domeMoq: dome.moq,
      deliIsFree: policy.isFree,
      deliType: policy.type,
      deliUnitQty: policy.unitQty,
      deliFee: policy.fee,
      coupangP25: null,
      coupangSampleN: null,
      unitDeliFee: unitDeli,
      effectiveCost,
      breakEvenPrice: be,
      margin: null,
      marginRate: null,
      verdict: 'unknown',
    };
  }

  const margin = marginOf(storedCoupangP25, effectiveCost, logisticsSize);

  return {
    domeStatus: dome.status,
    domePrice: dome.price,
    domeInventory: dome.inventory,
    domeMoq: dome.moq,
    deliIsFree: policy.isFree,
    deliType: policy.type,
    deliUnitQty: policy.unitQty,
    deliFee: policy.fee,
    coupangP25: storedCoupangP25,
    coupangSampleN: null,
    unitDeliFee: unitDeli,
    effectiveCost,
    breakEvenPrice: be,
    margin,
    marginRate: Math.round((margin / storedCoupangP25) * 1000) / 10,
    verdict: storedCoupangP25 >= be ? 'pass' : 'fail',
  };
```

> `coupangSampleN`은 이제 항상 `null`이다. 표본 개념이 사라졌다(사람이 눈으로 본 값 1건). 컬럼은 남기되 채우지 않는다.

`DomeSnapshot`이 export되어 있지 않으면 `export`를 붙인다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-verify-manual-price.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: 기존 테스트 갱신**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-verify.test.ts`

기존 테스트는 `estimateCoupangPrice`를 mock하고 `buildVerifyResult(title, dome, qty, size)`로 호출한다. **mock을 걷어내고** 네 번째 인자로 값을 직접 넘기도록 고친다. 기대값은 그대로여야 한다 — mock이 주던 `p25: 9900`을 인자로 옮기는 것뿐이다. 값이 바뀌면 멈추고 보고한다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sourcing/shortlist-verify.ts \
        src/__tests__/lib/sourcing/shortlist-verify-manual-price.test.ts \
        src/__tests__/lib/sourcing/shortlist-verify.test.ts
git commit -m "fix(sourcing): 재검증이 저장된 수동 쿠팡가를 쓰도록 교체

네이버 쇼핑 검색 API 종료로 estimateCoupangPrice가 영구히 null을
반환한다. buildVerifyResult에서 그 호출을 걷어내고 행에 저장된 p25를
받아 판정한다. 도매꾹 가격·재고 갱신은 그대로 유지되고 사람이 입력한
시세는 보존된다."
```

---

## Task 2: 검증 큐가 저장된 p25를 함께 읽어오게 한다

**Files:**
- Modify: `src/lib/sourcing/shortlist-db.ts` (`VerifyTarget`, `listForVerify`)
- Modify: `src/lib/sourcing/shortlist-verify.ts` (`verifyOne`)
- Test: `src/__tests__/lib/sourcing/shortlist-db.test.ts`

Task 1이 `buildVerifyResult`에 p25를 요구하게 됐으니, 호출부가 그 값을 가져와야 한다.

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/sourcing/shortlist-db.test.ts` 맨 아래에 추가:

```typescript
describe('listForVerify — 저장된 쿠팡가 동반 조회', () => {
  it('SELECT에 coupang_p25가 포함된다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listForVerify(5);
    const [sql] = mockQuery.mock.calls[0];
    // 재검증이 수동 입력값을 인자로 받아야 하므로 큐 조회가 함께 가져와야 한다
    expect(sql).toContain('coupang_p25');
  });
});
```

파일 상단 import에 `listForVerify`를 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-db.test.ts -t 'coupang_p25'`
Expected: FAIL — SELECT 목록에 없음

- [ ] **Step 3: 구현**

`src/lib/sourcing/shortlist-db.ts`의 `VerifyTarget` 반환 타입과 SELECT에 컬럼을 추가한다:

```typescript
export async function listForVerify(
  limit: number,
): Promise<{
  itemNo: number;
  title: string;
  orderQty: number;
  logisticsSize: LogisticsSize;
  coupangP25: number | null;
}[]> {
```

SELECT 목록에 `coupang_p25`를 넣고, 매핑에 `coupangP25: r.coupang_p25`를 추가한다. 행 타입에도 `coupang_p25: number | null`을 넣는다.

`src/lib/sourcing/shortlist-verify.ts`의 `VerifyTarget`에 필드를 추가한다:

```typescript
export interface VerifyTarget {
  itemNo: number;
  title: string;
  orderQty: number;
  logisticsSize: LogisticsSize;
  /** 행에 저장된 쿠팡 실판가. 사용자가 직접 입력한 값 */
  coupangP25: number | null;
}
```

`verifyOne` 안의 호출을 교체한다:

```typescript
  const result = await buildVerifyResult(dome, target.orderQty, target.logisticsSize, target.coupangP25);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-db.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 에러 없음. `verifyOne` 호출부가 `coupangP25`를 안 넘기면 여기서 드러난다 — 전부 채운다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/shortlist-db.ts src/lib/sourcing/shortlist-verify.ts \
        src/__tests__/lib/sourcing/shortlist-db.test.ts
git commit -m "feat(sourcing): 검증 큐가 저장된 쿠팡가를 함께 조회"
```

---

## Task 3: PATCH로 쿠팡가를 저장하고 판정을 재계산한다

**Files:**
- Modify: `src/lib/sourcing/shortlist-db.ts:128-152` (`ShortlistPatch`, `patchShortlist`)
- Modify: `src/app/api/sourcing/shortlist/[itemNo]/route.ts`
- Test: `src/__tests__/api/shortlist-patch-coupang-price.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/api/shortlist-patch-coupang-price.test.ts` 신규 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'u1' }),
}));

const patchShortlist = vi.fn();
const getShortlistItem = vi.fn();
vi.mock('@/lib/sourcing/shortlist-db', () => ({
  patchShortlist: (...a: unknown[]) => patchShortlist(...a),
  getShortlistItem: (...a: unknown[]) => getShortlistItem(...a),
}));

const verifyOne = vi.fn();
vi.mock('@/lib/sourcing/shortlist-verify', () => ({
  verifyOne: (...a: unknown[]) => verifyOne(...a),
}));

import { PATCH } from '@/app/api/sourcing/shortlist/[itemNo]/route';

function req(body: unknown) {
  return new Request('http://localhost/api/sourcing/shortlist/55788793', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ itemNo: '55788793' }) };

describe('PATCH /api/sourcing/shortlist/[itemNo] — coupangP25', () => {
  beforeEach(() => {
    patchShortlist.mockReset();
    verifyOne.mockReset().mockResolvedValue(true);
    getShortlistItem.mockReset().mockResolvedValue({
      itemNo: 55788793, title: 't', orderQty: 10, logisticsSize: 'xsmall', coupangP25: 10500,
    });
  });

  it('정상값을 저장하고 재검증을 돌린다', async () => {
    const res = await PATCH(req({ coupangP25: 10500 }), ctx);
    expect(res.status).toBe(200);
    expect(patchShortlist).toHaveBeenCalledWith(55788793, { coupangP25: 10500 });
    // 시세가 바뀌면 판정·마진이 달라지므로 반드시 재계산되어야 한다
    expect(verifyOne).toHaveBeenCalled();
  });

  it('null로 지울 수 있다', async () => {
    const res = await PATCH(req({ coupangP25: null }), ctx);
    expect(res.status).toBe(200);
    expect(patchShortlist).toHaveBeenCalledWith(55788793, { coupangP25: null });
  });

  it('음수는 400이다', async () => {
    const res = await PATCH(req({ coupangP25: -1 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('소수는 400이다', async () => {
    const res = await PATCH(req({ coupangP25: 1000.5 }), ctx);
    expect(res.status).toBe(400);
  });

  it('1,000만원 초과는 400이다', async () => {
    const res = await PATCH(req({ coupangP25: 10_000_001 }), ctx);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/shortlist-patch-coupang-price.test.ts`
Expected: FAIL — `coupangP25`가 무시되어 `patchShortlist`가 빈 객체로 불리거나 호출되지 않음

- [ ] **Step 3: 구현**

`src/lib/sourcing/shortlist-db.ts`의 `ShortlistPatch`에 필드를 추가한다:

```typescript
export interface ShortlistPatch {
  memo?: string;
  logisticsSize?: LogisticsSize;
  orderQty?: number;
  isArchived?: boolean;
  /** 사용자가 쿠팡에서 직접 확인해 입력한 실판가. null이면 지운다 */
  coupangP25?: number | null;
}
```

`patchShortlist` 본문의 `isArchived` 줄 아래에 추가한다:

```typescript
  if (patch.coupangP25 !== undefined) { sets.push(`coupang_p25 = $${i++}`); vals.push(patch.coupangP25); }
```

`src/app/api/sourcing/shortlist/[itemNo]/route.ts`의 body 타입에 필드를 추가한다:

```typescript
    coupangP25?: number | null;
```

검증을 `orderQty` 블록 아래에 추가한다:

```typescript
  /** 쿠팡 실판가 상한 — 오타로 자릿수가 밀린 값을 거른다 */
  const MAX_COUPANG_PRICE = 10_000_000;

  if (body.coupangP25 !== undefined && body.coupangP25 !== null) {
    if (!Number.isInteger(body.coupangP25) || body.coupangP25 < 0) {
      return NextResponse.json({ error: '쿠팡 실판가는 0 이상의 정수여야 합니다.' }, { status: 400 });
    }
    if (body.coupangP25 > MAX_COUPANG_PRICE) {
      return NextResponse.json(
        { error: `쿠팡 실판가는 ${MAX_COUPANG_PRICE.toLocaleString()}원 이하여야 합니다.` },
        { status: 400 },
      );
    }
  }
```

재검증 조건에 `coupangP25`를 넣는다 — 시세가 바뀌면 판정·마진이 달라진다:

```typescript
    if (
      body.logisticsSize !== undefined ||
      body.orderQty !== undefined ||
      body.coupangP25 !== undefined
    ) {
      const item = await getShortlistItem(no);
      if (item) {
        await verifyOne({
          itemNo: no,
          title: item.title,
          orderQty: item.orderQty,
          logisticsSize: item.logisticsSize,
          coupangP25: item.coupangP25,
        });
      }
    }
```

`ShortlistItem`에 `coupangP25`가 없으면 `src/types/shortlist.ts`에 추가하고 `toItem`에 매핑한다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/api/shortlist-patch-coupang-price.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/shortlist-db.ts \
        "src/app/api/sourcing/shortlist/[itemNo]/route.ts" \
        src/types/shortlist.ts \
        src/__tests__/api/shortlist-patch-coupang-price.test.ts
git commit -m "feat(sourcing): 쿠팡 실판가 수동 입력 API"
```

---

## Task 4: 실행 라우트가 requestId를 먼저 만들어 응답한다

**Files:**
- Modify: `src/app/api/sourcing/agent/run/route.ts`
- Modify: `src/lib/sourcing-agent/keyword-pipeline.ts:147` (`runKeywordPipeline`)
- Test: `src/__tests__/api/sourcing-agent-run.test.ts`

지금은 `after()` 안에서 `createRequest`가 요청 행을 만들어 **라우트가 ID를 모른다.** 그래서 폴링이 남의 실행과 섞인다. 라우트가 먼저 만들어 응답에 담는다.

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/api/sourcing-agent-run.test.ts`의 기존 `describe` 안에 추가:

```typescript
  it('키워드마다 requestId를 만들어 응답에 담는다', async () => {
    mockRun.mockResolvedValue(undefined);
    const res = await POST(req({ keywords: ['등산 스틱', '방한 장갑'] }));
    const body = await res.json();

    expect(body.data.runs).toHaveLength(2);
    expect(body.data.runs[0].keyword).toBe('등산 스틱');
    expect(typeof body.data.runs[0].requestId).toBe('number');

    // 폴링이 이 ID로 조회하므로 파이프라인이 같은 행을 써야 한다
    await Promise.all(afterTasks);
    expect(mockRun).toHaveBeenCalledWith('등산 스틱', '', body.data.runs[0].requestId);
  });
```

파일 상단 mock에 `createRequest`를 추가한다.

**`vi.hoisted`를 반드시 쓴다.** `vi.mock` 팩토리는 파일 최상단으로 호이스팅되므로
팩토리 안에서 참조하는 값도 함께 끌어올려야 한다. 평범한 `let nextId = 100`을 밖에
두고 팩토리에서 쓰면 `ReferenceError: Cannot access 'nextId' before initialization`이
난다 — 이 파일 상단 주석이 경고하는 바로 그 함정이다.

```typescript
const { mockCreateRequest } = vi.hoisted(() => {
  let nextId = 100;
  return { mockCreateRequest: vi.fn(async () => nextId++) };
});

vi.mock('@/lib/sourcing-agent/keyword-db', () => ({
  createRequest: mockCreateRequest,
}));

// 이 팩토리는 바깥 변수를 참조하지 않으므로 hoisted가 필요 없다
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: vi.fn() }),
}));
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/sourcing-agent-run.test.ts -t 'requestId'`
Expected: FAIL — `body.data.runs` is undefined

- [ ] **Step 3: 구현**

`src/lib/sourcing-agent/keyword-pipeline.ts`의 `runKeywordPipeline`을 교체한다:

```typescript
/**
 * @param existingRequestId 이미 만들어 둔 요청 행 ID. 웹 실행은 폴링을 위해
 *   라우트가 먼저 만들어 응답에 담으므로 그 ID를 그대로 이어 쓴다.
 *   없으면(텔레그램 경로) 여기서 만든다.
 */
export async function runKeywordPipeline(
  keyword: string,
  chatId: string,
  existingRequestId?: number,
): Promise<void> {
  const pool = getSourcingPool();

  await notify(chatId, `🔍 분석 시작합니다\n📦 ${keyword}\n잠시만 기다려주세요...`);

  const requestId = existingRequestId ?? (await createRequest(pool, keyword, chatId));
```

`src/app/api/sourcing/agent/run/route.ts`의 import에 추가한다:

```typescript
import { createRequest } from '@/lib/sourcing-agent/keyword-db';
import { getSourcingPool } from '@/lib/sourcing/db';
```

`after(...)` 블록 앞에 요청 행 선행 생성을 넣고 응답을 바꾼다:

```typescript
  // 폴링이 "이번 실행분"만 보게 하려면 라우트가 ID를 알아야 한다.
  // after() 안에서 만들면 응답에 담을 수 없다.
  const pool = getSourcingPool();
  const runs: { keyword: string; requestId: number }[] = [];
  for (const kw of keywords) {
    runs.push({ keyword: kw, requestId: await createRequest(pool, kw, NO_TELEGRAM_CHAT) });
  }

  // 응답을 먼저 돌려주고 백그라운드에서 순차 실행한다.
  // 동시 실행하면 도매꾹 API에 순간 부하가 몰린다.
  after(
    (async () => {
      for (const run of runs) {
        try {
          await runKeywordPipeline(run.keyword, NO_TELEGRAM_CHAT, run.requestId);
        } catch (err) {
          console.error('[api/sourcing/agent/run] 파이프라인 실패:', run.keyword, err);
        }
      }
    })(),
  );

  return Response.json({ success: true, data: { accepted: runs.length, runs } });
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/api/sourcing-agent-run.test.ts`
Expected: PASS — 기존 5건 + 신규 1건

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/agent/run/route.ts src/lib/sourcing-agent/keyword-pipeline.ts \
        src/__tests__/api/sourcing-agent-run.test.ts
git commit -m "feat(sourcing): 실행 라우트가 requestId를 선행 생성해 응답

폴링이 이번 실행분만 조회하려면 라우트가 요청 행 ID를 알아야 한다.
after() 안에서 만들면 응답에 담을 수 없어 라우트가 먼저 만든다."
```

---

## Task 5: 상태 조회 API

**Files:**
- Create: `src/app/api/sourcing/agent/run/status/route.ts`
- Test: `src/__tests__/api/sourcing-agent-run-status.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/api/sourcing-agent-run-status.test.ts` 신규 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'u1' }),
}));

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: () => ({ query: mockQuery }) }));

import { GET } from '@/app/api/sourcing/agent/run/status/route';

const url = (qs: string) => new Request(`http://localhost/api/sourcing/agent/run/status?${qs}`);

describe('GET /api/sourcing/agent/run/status', () => {
  beforeEach(() => mockQuery.mockReset());

  it('요청한 id의 상태와 결과를 반환한다', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 12, keyword: '등산 스틱', status: 'done', error_message: null }],
      })
      .mockResolvedValueOnce({
        rows: [{ request_id: 12, domeggook_product_name: '경량 등산스틱', domeggook_price: 12800 }],
      });

    const res = await GET(url('ids=12'));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.runs).toHaveLength(1);
    expect(body.data.runs[0].status).toBe('done');
    expect(body.data.runs[0].results).toHaveLength(1);
  });

  it('ids가 없으면 400이다', async () => {
    const res = await GET(url(''));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('숫자가 아닌 id는 걸러낸다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = await GET(url('ids=12,abc,13'));
    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toEqual([12, 13]);
  });

  it('id가 전부 비정상이면 400이다', async () => {
    const res = await GET(url('ids=abc,def'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/sourcing-agent-run-status.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/sourcing/agent/run/status/route'`

- [ ] **Step 3: 구현**

`src/app/api/sourcing/agent/run/status/route.ts` 신규 생성:

```typescript
/**
 * GET /api/sourcing/agent/run/status?ids=12,13
 * 발굴 탭 폴링용 — 이번 실행분의 진행 상태와 결과를 돌려준다.
 *
 * POST /run이 응답에 담아준 requestId만 조회하므로 다른 실행과 섞이지 않는다.
 * 조회 전용이지만 결과에 소싱 후보가 담기므로 인증을 건다.
 */

import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

/** 한 번에 조회할 수 있는 실행 수 — POST /run의 MAX_KEYWORDS와 같다 */
const MAX_IDS = 10;

export async function GET(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return Response.json(
      { success: false, error: '조회할 실행 ID를 지정하세요.' },
      { status: 400 },
    );
  }

  try {
    const pool = getSourcingPool();

    const { rows: requests } = await pool.query(
      `SELECT id, keyword, status, error_message
         FROM keyword_sourcing_requests
        WHERE id = ANY($1::int[])`,
      [ids],
    );

    const { rows: results } = await pool.query(
      `SELECT * FROM keyword_sourcing_results
        WHERE request_id = ANY($1::int[])
        ORDER BY request_id, rank`,
      [ids],
    );

    const byRequest = new Map<number, unknown[]>();
    for (const r of results as { request_id: number }[]) {
      const list = byRequest.get(r.request_id) ?? [];
      list.push(r);
      byRequest.set(r.request_id, list);
    }

    return Response.json({
      success: true,
      data: {
        runs: (requests as { id: number; keyword: string; status: string; error_message: string | null }[]).map((q) => ({
          requestId: q.id,
          keyword: q.keyword,
          status: q.status,
          errorMessage: q.error_message,
          results: byRequest.get(q.id) ?? [],
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/sourcing/agent/run/status] 조회 실패:', message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/api/sourcing-agent-run-status.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/agent/run/status/route.ts \
        src/__tests__/api/sourcing-agent-run-status.test.ts
git commit -m "feat(sourcing): 발굴 실행 상태 폴링 API"
```

---

## Task 6: 죽은 자동 적재 블록을 제거한다

**Files:**
- Modify: `src/lib/sourcing-agent/keyword-pipeline.ts:224-244`

`if (v.verdict === 'pass')` 블록은 p25가 영원히 `null`이라 절대 발동하지 않는다. 죽은 코드로 남기면 다음 사람이 "왜 안 쌓이지"를 다시 판다.

- [ ] **Step 1: 제거**

`if (v.verdict === 'pass') { await upsertShortlistCandidate(...) }` 블록 전체를 삭제하고, 그 자리에 이유를 남긴다:

```typescript
      // 자동 적재는 하지 않는다. 네이버 쇼핑 검색 API 종료(2026-07-31)로
      // coupangP25가 영원히 null이라 pass 판정이 나올 수 없기 때문이다.
      // 사용자가 발굴 탭에서 쿠팡 실판가를 확인하고 직접 담는다.
      // 자동 시세가 복구되면 이 자리에 되살린다.
```

`upsertShortlistCandidate` import가 더 이상 쓰이지 않으면 제거한다. **`shortlist-db.ts`의 함수 자체는 남긴다** — Task 8의 담기 경로가 쓴다.

- [ ] **Step 2: 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

Run: `npx vitest run src/__tests__/lib/sourcing-agent/keyword-pipeline.test.ts`
Expected: PASS — `evaluateCandidate` 테스트는 판정 로직만 보므로 영향 없다

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing-agent/keyword-pipeline.ts
git commit -m "chore(sourcing): 발동 불가능한 자동 적재 블록 제거

coupangP25가 영원히 null이라 pass 판정이 나올 수 없다.
죽은 코드로 남기면 '왜 안 쌓이지'를 다시 파게 된다."
```

---

## Task 7: 후보의 개당 배송비를 저장한다

**Files:**
- Create: `supabase/migrations/097_keyword_results_unit_deli_fee.sql`
- Modify: `src/lib/sourcing-agent/keyword-db.ts` (`KeywordResultInsert`, `saveKeywordResults`)
- Modify: `src/lib/sourcing-agent/keyword-pipeline.ts` (후보 루프의 `resultRows.push`)

발굴 탭이 손익분기를 내려면 **실효원가 = 도매가 + 개당 배송비**가 필요하다. 그런데 `keyword_sourcing_results`에 배송비 컬럼이 없다(2026-08-01 실제 스키마 확인). 파이프라인은 이미 `parseUnitDeliFee(item)`로 계산해 놓고 **저장만 하지 않는다.**

배송비를 빼고 손익분기를 내면 **실제보다 낮게** 나온다. 개당 300원이면 손익분기가 약 500~700원 낮아지고, 그만큼 **통과하면 안 될 후보가 통과한다.** 판단 화면이 낙관 방향으로 틀리는 것이라 그냥 둘 수 없다.

> 테이블명 주의: `keyword_results`가 아니라 **`keyword_sourcing_results`** 다. 마이그레이션 파일이 없는 테이블이라 실제 DB 스키마로 확인했다.

- [ ] **Step 1: 마이그레이션 작성**

`supabase/migrations/097_keyword_results_unit_deli_fee.sql` 신규 생성:

```sql
-- 발굴 탭이 손익분기를 계산하려면 실효원가(도매가 + 개당 배송비)가 필요하다.
-- 파이프라인은 parseUnitDeliFee로 이미 계산하고 있었으나 저장하지 않았다.
-- 기존 행은 NULL로 남으며, 소비자는 NULL을 0으로 보지 말고 "모름"으로 다뤄야 한다.
ALTER TABLE public.keyword_sourcing_results
  ADD COLUMN IF NOT EXISTS unit_deli_fee integer;

COMMENT ON COLUMN public.keyword_sourcing_results.unit_deli_fee IS
  '개당 배송비 (사입 10개 기준 환산). deli-policy.unitDeliveryFee 결과';
```

이 저장소에는 마이그레이션 자동 적용 장치가 없다. 소싱 DB에 직접 적용한다.

```bash
npx tsx --env-file=.env.local -e "
import { getSourcingPool } from './src/lib/sourcing/db';
import { readFileSync } from 'node:fs';
(async () => {
  const pool = getSourcingPool();
  await pool.query(readFileSync('supabase/migrations/097_keyword_results_unit_deli_fee.sql', 'utf8'));
  const { rows } = await pool.query(
    \"SELECT column_name FROM information_schema.columns \" +
    \"WHERE table_name='keyword_sourcing_results' AND column_name='unit_deli_fee'\");
  console.log(rows.length === 1 ? 'OK - 컬럼 추가됨' : 'FAIL - 컬럼 없음');
  await pool.end();
})();
"
```
Expected: `OK - 컬럼 추가됨`

- [ ] **Step 2: 실패 테스트 작성**

`src/__tests__/lib/sourcing-agent/keyword-db.test.ts` 신규 생성:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { saveKeywordResults, type KeywordResultInsert } from '@/lib/sourcing-agent/keyword-db';

const row: KeywordResultInsert = {
  rank: 1,
  naver_price: null,
  naver_url: null,
  domeggook_product_name: '캠핑 버너 받침대',
  domeggook_price: 7650,
  domeggook_url: 'http://domeggook.com/39371034',
  domeggook_image_url: null,
  domeggook_margin_rate: null,
  china_product_name: null,
  china_price_krw: null,
  china_url: null,
  china_margin_rate: null,
  unit_deli_fee: 300,
};

describe('saveKeywordResults', () => {
  it('개당 배송비를 함께 저장한다', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await saveKeywordResults({ query } as never, 12, [row]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('unit_deli_fee');
    expect(sql).toContain('keyword_sourcing_results');
    expect(params).toContain(300);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing-agent/keyword-db.test.ts`
Expected: FAIL — `unit_deli_fee`가 `KeywordResultInsert`에 없어 타입 오류

- [ ] **Step 4: 구현**

`src/lib/sourcing-agent/keyword-db.ts`의 `KeywordResultInsert`에 필드를 추가한다:

```typescript
  /** 개당 배송비 (사입 10개 기준 환산). 모르면 null */
  unit_deli_fee: number | null;
```

`saveKeywordResults`의 INSERT 컬럼 목록과 VALUES 자리표시자, 파라미터 배열에 `unit_deli_fee`를 추가한다. 자리표시자 번호가 밀리므로 **끝에 붙이는 것이 가장 안전하다.**

`KeywordResult`(조회용 타입)에도 같은 필드를 추가한다.

`src/lib/sourcing-agent/keyword-pipeline.ts`의 `resultRows.push({...})`에 추가한다:

```typescript
        unit_deli_fee: deli,
```

`deli`는 같은 루프에서 이미 `parseUnitDeliFee(item)`로 계산돼 있다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing-agent/keyword-db.test.ts`
Expected: PASS — 1 test

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/097_keyword_results_unit_deli_fee.sql \
        src/lib/sourcing-agent/keyword-db.ts \
        src/lib/sourcing-agent/keyword-pipeline.ts \
        src/__tests__/lib/sourcing-agent/keyword-db.test.ts
git commit -m "feat(sourcing): 후보의 개당 배송비를 저장

발굴 탭이 손익분기를 내려면 실효원가(도매가 + 개당 배송비)가 필요한데
keyword_sourcing_results에 배송비 컬럼이 없었다. 파이프라인은 이미
parseUnitDeliFee로 계산하고 저장만 하지 않고 있었다.

배송비를 빼면 손익분기가 실제보다 낮게 나와 통과하면 안 될 후보가
통과한다 — 낙관 방향 오류라 판단 화면에 두면 안 된다."
```

---

## Task 8: 발굴 탭 — 결과 폴링과 표시

**Files:**
- Modify: `src/components/sourcing/DiscoveryTab.tsx`

- [ ] **Step 1: 실행 응답 수용과 폴링 상태 추가**

`run()`이 `body.data.runs`를 받아 폴링을 시작하게 한다. 컴포넌트 상단에 상태를 추가한다:

```tsx
interface RunResult {
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  naver_price: number | null;
  /** Task 7에서 저장하기 시작한 값. 그 이전 행은 null이다 */
  unit_deli_fee: number | null;
}
interface Run {
  requestId: number;
  keyword: string;
  status: 'pending' | 'done' | 'error';
  errorMessage: string | null;
  results: RunResult[];
}

const [runs, setRuns] = useState<Run[]>([]);
const [polling, setPolling] = useState(false);
const [pollError, setPollError] = useState<string | null>(null);
```

- [ ] **Step 2: 폴링 훅 추가**

```tsx
/** 마지막으로 상태가 바뀐 뒤 이만큼 변화가 없으면 폴링을 접는다.
 *  실행 시작 기준이 아니다 — 키워드 10개면 정상 실행도 3분 반이 걸린다 */
const STALL_MS = 3 * 60 * 1000;
const POLL_MS = 3000;

useEffect(() => {
  if (!polling || runs.length === 0) return;

  const ids = runs.map((r) => r.requestId).join(',');
  let lastChange = Date.now();
  let stopped = false;

  const tick = async () => {
    try {
      const res = await fetch(`/api/sourcing/agent/run/status?ids=${ids}`);
      if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
      const body = await res.json();
      if (!body.success) throw new Error(body.error ?? '조회 실패');

      const next: Run[] = body.data.runs;
      setRuns((prev) => {
        if (JSON.stringify(prev) !== JSON.stringify(next)) lastChange = Date.now();
        return next;
      });

      const finished = next.every((r) => r.status === 'done' || r.status === 'error');
      if (finished) { setPolling(false); return; }

      if (Date.now() - lastChange > STALL_MS) {
        setPolling(false);
        setPollError('3분간 진행이 없습니다. 아직 실행 중일 수 있으니 새로고침해 보세요.');
        return;
      }
    } catch (e) {
      setPolling(false);
      setPollError(
        `진행 상황을 불러오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  };

  let timer = setTimeout(tick, POLL_MS);
  return () => { stopped = true; clearTimeout(timer); };
}, [polling, runs.length]);
```

- [ ] **Step 3: `run()`에서 폴링 시작**

성공 분기에서 `setRuns`와 `setPolling(true)`를 호출한다:

```tsx
      if (body.success) {
        setRuns(
          body.data.runs.map((r: { requestId: number; keyword: string }) => ({
            ...r, status: 'pending' as const, errorMessage: null, results: [],
          })),
        );
        setPollError(null);
        setPolling(true);
        setChecked(new Set());
        setManual('');
      }
```

- [ ] **Step 4: 진행 표시와 결과 목록 렌더**

`message` 아래에 추가한다:

```tsx
{runs.length > 0 && (
  <section style={{ marginTop: 20 }}>
    {polling && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                    background: '#fafafa', border: `1px solid ${C.border}`, borderRadius: 6,
                    fontSize: 13, marginBottom: 12 }}>
        <Loader2 size={14} className="animate-spin" />
        <span>분석 중 <b>{runs.filter((r) => r.status !== 'pending').length} / {runs.length}</b> 완료</span>
      </div>
    )}
    {pollError && (
      <p style={{ color: C.warning, fontSize: 13, marginBottom: 12 }}>{pollError}</p>
    )}

    <p style={{ fontSize: 12.5, color: C.textSub, marginBottom: 12 }}>
      모든 손익분기가는 <b>10개 사입 · 극소형</b> 기준입니다. 담은 뒤 소싱리스트에서 조정할 수 있습니다.
    </p>

    {runs.map((r) => (
      <article key={r.requestId} style={{ border: `1px solid ${C.border}`, borderRadius: 8,
                                          marginBottom: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px',
                      background: '#fafafa', borderBottom: `1px solid ${C.border}`, fontSize: 13.5 }}>
          <span style={{ fontWeight: 700 }}>{r.keyword}</span>
          {r.status === 'done' && <span style={{ color: C.textSub }}>후보 {r.results.length}개</span>}
          {r.status === 'pending' && <Loader2 size={13} className="animate-spin" />}
          {r.status === 'error' && (
            <span style={{ color: C.warning }}>실패 — {r.errorMessage ?? '알 수 없는 오류'}</span>
          )}
        </div>
        {r.results.map((c, i) => (
          <CandidateRow key={i} c={c} />
        ))}
      </article>
    ))}
  </section>
)}
```

- [ ] **Step 5: 확인**

Run: `npx tsc --noEmit`
Expected: `CandidateRow` 미정의 오류 — Task 8에서 만든다. 이 단계에서는 임시로 `<div>{c.domeggook_product_name}</div>`를 인라인으로 두어 통과시킨 뒤 Task 9에서 교체한다.

Run: `npm run build`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/DiscoveryTab.tsx
git commit -m "feat(sourcing): 발굴 탭 결과 폴링과 진행 표시"
```

---

## Task 9: 발굴 탭 — 가격 입력·판정·담기

**Files:**
- Modify: `src/components/sourcing/DiscoveryTab.tsx`

- [ ] **Step 1: 후보 행 컴포넌트 작성**

파일 하단에 추가한다:

```tsx
import { breakEvenPrice, marginOf, buildSearchQueries } from '@/lib/sourcing/coupang-price';

/** 발굴 탭이 가정하는 사입 수량 — sourcing_shortlist.order_qty 기본값과 같다 */
const ASSUMED_ORDER_QTY = 10;
/** 목표 역산 기준 최소 판매가 — keyword-pipeline의 MIN_SELL_PRICE_KRW와 같다 */
const MIN_SELL_PRICE_KRW = 10000;

function CandidateRow({ c }: { c: RunResult }) {
  const [price, setPrice] = useState('');
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const domePrice = c.domeggook_price ?? 0;
  // 배송비를 빼면 손익분기가 실제보다 낮게 나와 통과하면 안 될 후보가 통과한다.
  // Task 7 이전에 쌓인 행은 null이므로 그때는 배송비 미반영임을 화면에 알린다.
  const deli = c.unit_deli_fee;
  const effectiveCost = domePrice + (deli ?? 0);
  const be = breakEvenPrice(effectiveCost, 'xsmall');

  const p = Number.parseInt(price.replace(/[^0-9]/g, ''), 10);
  let verdict: { label: string; why: string; color: string };
  if (!p) {
    verdict = { label: '판정 불가', why: '실판가 미입력', color: C.warning };
  } else if (p < MIN_SELL_PRICE_KRW) {
    verdict = { label: '미달', why: '1만원 하한 미만', color: C.textSub };
  } else if (p >= be) {
    const m = marginOf(p, effectiveCost, 'xsmall');
    verdict = { label: '통과', why: `개당 ${m.toLocaleString()}원 · ${((m / p) * 100).toFixed(1)}%`,
                color: C.success };
  } else {
    verdict = { label: '미달', why: `손익분기 ${(be - p).toLocaleString()}원 부족`, color: C.textSub };
  }

  const itemNo = c.domeggook_url ? Number(c.domeggook_url.split('/').pop()) : NaN;
  const searchQuery = buildSearchQueries(c.domeggook_product_name ?? '')[0] ?? '';

  async function take() {
    if (!Number.isInteger(itemNo)) { setErr('상품번호를 읽지 못했습니다.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/sourcing/shortlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemNo, title: c.domeggook_product_name, orderQty: ASSUMED_ORDER_QTY }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `서버 응답 ${res.status}`);
      }
      if (p) {
        await fetch(`/api/sourcing/shortlist/${itemNo}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coupangP25: p }),
        });
      }
      setTaken(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '담지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 13, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{c.domeggook_product_name ?? '—'}</span>
        {c.domeggook_url && (
          <a href={c.domeggook_url} target="_blank" rel="noreferrer"
             style={{ fontSize: 12, color: C.textSub }}>도매꾹 ↗</a>
        )}
        {searchQuery && (
          <a href={`https://www.coupang.com/np/search?q=${encodeURIComponent(searchQuery)}`}
             target="_blank" rel="noreferrer"
             style={{ fontSize: 12, color: C.accent }}>쿠팡에서 검색 ↗</a>
        )}
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', margin: '9px 0 11px', fontSize: 13 }}>
        <span>도매가 <b>{domePrice.toLocaleString()}원</b></span>
        <span>개당 배송비 <b>{deli === null ? '모름' : `${deli.toLocaleString()}원`}</b></span>
        <span>실효원가 <b>{effectiveCost.toLocaleString()}원</b></span>
        <span style={{ color: C.accent }}>손익분기 <b>{be.toLocaleString()}원</b></span>
        {deli === null && (
          <span style={{ color: C.warning, fontSize: 12 }}>배송비 미반영 — 실제 손익분기는 더 높다</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12.5, color: C.textSub }}>쿠팡 실판가</label>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') focusNextPriceInput(e.currentTarget); }}
          inputMode="numeric"
          aria-label={`${c.domeggook_product_name ?? '후보'} 쿠팡 실판가`}
          data-price-input
          style={{ width: 118, padding: '7px 9px', textAlign: 'right', fontWeight: 600,
                   border: `1px solid ${C.border}`, borderRadius: 6 }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 650, color: verdict.color }}>
          {verdict.label} <span style={{ fontWeight: 500, opacity: 0.85 }}>— {verdict.why}</span>
        </span>
        {taken ? (
          <span style={{ marginLeft: 'auto', color: C.success, fontWeight: 650, fontSize: 12.5 }}>
            ✓ 담김
          </span>
        ) : (
          <button onClick={() => void take()} disabled={busy}
                  style={{ marginLeft: 'auto', padding: '7px 13px', fontSize: 13,
                           border: `1px solid ${C.border}`, borderRadius: 6,
                           background: 'transparent', color: C.text,
                           cursor: busy ? 'default' : 'pointer' }}>
            {busy ? '담는 중…' : '소싱리스트에 담기'}
          </button>
        )}
      </div>
      {err && <p style={{ marginTop: 8, fontSize: 12.5, color: C.warning }}>{err}</p>}
    </div>
  );
}

/** Enter로 다음 후보의 가격 칸으로 이동한다. 마지막 칸에서는 움직이지 않는다 */
function focusNextPriceInput(current: HTMLInputElement) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('[data-price-input]'));
  const next = all[all.indexOf(current) + 1];
  next?.focus();
}
```

- [ ] **Step 2: Task 7의 임시 렌더를 교체**

Task 8 Step 4에서 임시로 둔 `<div>{c.domeggook_product_name}</div>`를 `<CandidateRow key={i} c={c} />`로 바꾼다.

- [ ] **Step 3: 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

Run: `npm run build`
Expected: 성공

- [ ] **Step 4: 커밋**

```bash
git add src/components/sourcing/DiscoveryTab.tsx
git commit -m "feat(sourcing): 발굴 탭 쿠팡가 입력·판정·담기

쿠팡 검색 링크로 상품명 복사·탭 전환·검색 세 단계를 없애고,
Enter로 다음 입력칸에 간다. 판정은 브라우저에서 같은 산식으로
즉시 계산하고, 저장 시에는 서버가 다시 계산한다."
```

---

## Task 10: 소싱리스트 쿠팡가 입력칸

**Files:**
- Modify: `src/components/sourcing/ShortlistTab.tsx`

발굴 탭에서 비워두고 담은 항목을 여기서 채운다.

- [ ] **Step 1: 입력 셀 추가**

표의 `손익분기` 열 옆에 쿠팡가 열을 추가한다. 값 변경 시 `patchItem`을 호출한다 — 이미 있는 함수라 재검증·상태 갱신이 자동으로 따라온다:

```tsx
<td style={{ padding: '10px 12px' }}>
  <input
    defaultValue={it.coupangP25 ?? ''}
    onBlur={(e) => {
      const raw = e.target.value.replace(/[^0-9]/g, '');
      const next = raw === '' ? null : Number.parseInt(raw, 10);
      if (next !== (it.coupangP25 ?? null)) void patchItem(it.itemNo, { coupangP25: next });
    }}
    inputMode="numeric"
    aria-label={`${it.title} 쿠팡 실판가`}
    placeholder="미입력"
    style={{ width: 96, padding: '5px 7px', textAlign: 'right',
             border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }}
  />
</td>
```

헤더 행에도 `<th>쿠팡 실판가</th>`를 같은 위치에 추가한다.

> `onBlur`를 쓰는 이유: `onChange`마다 PATCH를 보내면 타이핑 한 글자마다 재검증이 돈다.

- [ ] **Step 2: 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

Run: `npx vitest run src/__tests__/components/sourcing-dashboard.test.ts`
Expected: PASS — 이 테스트는 소스를 문자열로 파싱하므로 열 추가에 영향받지 않는지 확인한다

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: 커밋**

```bash
git add src/components/sourcing/ShortlistTab.tsx
git commit -m "feat(sourcing): 소싱리스트에 쿠팡 실판가 입력칸"
```

---

## Task 11: 동작 확인

**Files:** 없음 (수동 검증)

- [ ] **Step 1: 개발 서버**

```bash
npm run dev
```

`http://localhost:3000/sourcing` — 로그인 후 발굴 탭.

- [ ] **Step 2: 실행과 폴링**

직접 입력창에 `방한 장갑`을 넣고 분석.

확인할 것:
1. "분석 중 0 / 1 완료"가 뜨고 진행이 갱신된다
2. 약 20초 뒤 후보 목록이 나타난다
3. 각 후보에 도매가·손익분기가·`도매꾹 ↗`·`쿠팡에서 검색 ↗`이 보인다

- [ ] **Step 3: 판정**

쿠팡가 칸에 손익분기가보다 **큰 값**을 넣으면 `통과`, **작은 값**이면 `미달 — 손익분기 N원 부족`, **1만원 미만**이면 `미달 — 1만원 하한 미만`이 뜬다. Enter를 누르면 다음 후보 칸으로 이동한다.

- [ ] **Step 4: 담기**

`통과`가 뜬 후보를 담고, **소싱리스트 탭**에서 확인한다:
1. 항목이 생겼다
2. 쿠팡 실판가가 채워져 있다
3. 판정이 `pass`다

- [ ] **Step 5: 수동값 보존 확인**

소싱리스트에서 그 항목의 **사입 수량을 30으로** 바꾼다.

확인할 것: 재검증이 돌아도 **쿠팡 실판가가 그대로 남고**, 손익분기가만 30개 기준으로 다시 계산된다. 값이 사라지면 Task 1·2가 잘못된 것이다.

- [ ] **Step 6: 커밋**

수동 검증에서 고칠 것이 나오면 수정 후 커밋한다. 없으면 건너뛴다.

---

## 완료 기준

- [ ] 소싱 스위트 통과

  ```bash
  npx vitest run src/__tests__/lib/sourcing/ src/lib/sourcing/__tests__/ \
                 src/__tests__/lib/sourcing-agent/ src/__tests__/api/sourcing-*.test.ts \
                 src/__tests__/api/shortlist-*.test.ts
  ```

- [ ] `npx vitest run` 실패가 **7개 파일 / 14건을 넘지 않는다** (기존 부채 래칫)
- [ ] `npx tsc --noEmit` 에러 없음
- [ ] `npm run build` 성공
- [ ] 발굴 탭에서 쿠팡가를 넣어 담으면 소싱리스트에 `pass`로 쌓인다
- [ ] 사입 수량을 바꿔도 수동 입력한 쿠팡가가 보존된다

## 이 계획에서 제외한 것

| 항목 | 이유 |
|---|---|
| 자동 시세 조회 복구 | 쿠팡 파트너스 API가 유일한 경로인데 계정에 접근 권한이 없다 |
| 쿠팡가 일괄 붙여넣기 | 병목은 타이핑이 아니라 검색 도달이다. 검색 링크와 Enter 이동으로 해결했다 |
| 발굴 탭에서 수량·사이즈 조정 | 후보당 입력칸 3개는 1차 선별을 방해한다. 담은 뒤 소싱리스트에서 |
| 코스트코 최저가 비교 복구 | 같은 API에 의존한다. 별건 |
| `isViable` 기준 불일치 | 1단계 계획서에 기록된 별건 |
