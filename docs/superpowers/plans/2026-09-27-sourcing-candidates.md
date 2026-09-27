# 소싱 후보 수집기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 쇼핑 카테고리 캡처와 1688 캡처를 올리면 Claude가 판독해 후보 표·같은 물건 판정·강의/실측 두 공식 판정·20개 제출 목록을 만드는 `/sourcing/candidates` 화면을 스마트셀러스튜디오에 추가한다.

**Architecture:** 영수증 판독(`src/lib/receipt/`, `/api/receipts`)과 같은 흐름 — 브라우저가 이미지를 줄이고(전체 페이지 캡처는 조각낸다) → 업로드 라우트가 Storage에 저장·행 생성 → 판독 라우트가 Claude Vision으로 구조화 추출 → 순수 함수가 병합·검증 → pg 풀로 저장. 판정(거름망·두 공식)은 저장하지 않고 조회 때 계산한다.

**Tech Stack:** Next.js 16 App Router · TypeScript · `pg` 풀(`getSourcingPool`) · Supabase Storage · `@anthropic-ai/sdk` structured outputs · zod · vitest(jsdom) · Tailwind

**Spec:** `docs/superpowers/specs/2026-09-27-sourcing-candidates-design.md`

**스펙과 다른 점 (구현 중 확정):**
- 테이블 격리는 RLS가 아니라 **라우트의 `user_id` 조건**이다 — 앱은 service-role pg 풀을 쓰며 영수증 테이블도 같은 방식이다.
- 마이그레이션 번호는 `120`. 다른 브랜치(`docs/erp-1c2b-spec`)가 120을 먼저 쓰면 머지 때 번호만 올린다.

---

## 파일 지도

| 파일 | 책임 |
|---|---|
| `src/lib/ai/structured-schema.ts` (신규) | zod → Anthropic structured outputs용 JSON Schema. 영수증에서 추출 |
| `src/lib/receipt/extract.ts` (수정) | 위 헬퍼를 쓰도록 교체 (동작 동일) |
| `src/lib/sourcing/coupang-price.ts` (수정) | `minViablePrice`·`marginVerdict` 추가 — 정책 상수를 밖으로 내지 않고 판정 함수를 export |
| `src/lib/sourcing/lecture-formula.ts` (신규) | 강의 공식의 원본 |
| `src/lib/sourcing-candidates/types.ts` | 공용 타입 |
| `…/judge.ts` | 실측 판정·하한선 (앱 원가 모듈 호출) |
| `…/filters.ts` | 거름망 4종 |
| `…/verify.ts` | 숫자 검증 (할인율·구간가) |
| `…/merge.ts` | 조각 병합·중복 제거·순위 |
| `…/view.ts` | 조회 응답 조립 (판정 붙이기) |
| `…/tile.ts` | 조각 경계 계산 (순수) |
| `…/prepare-capture.ts` | 브라우저 캔버스로 빈칸 자르기·조각내기 |
| `…/storage-path.ts` | Storage 경로 |
| `…/extract-naver.ts` · `…/extract-1688.ts` | Claude 판독 |
| `…/parse-offer.ts` | 1688 업체 판독·저장 (라우트 2곳 공용) |
| `supabase/migrations/120_sourcing_candidates.sql` | 테이블 3개 |
| `src/app/api/sourcing-candidates/**` | 라우트 6개 |
| `src/components/sourcing/candidates/*.tsx` | 화면 |
| `src/app/sourcing/candidates/page.tsx` · `print/page.tsx` | 페이지 |
| `src/lib/nav-items.tsx` (수정) | 브레드크럼 라벨 |

테스트는 전부 `src/lib/sourcing-candidates/__tests__/`, 실행은 워크트리 루트에서 `npx vitest run <경로>`.

---

### Task 0: 워크트리 준비 확인

- [ ] **Step 1: 의존성과 기준 테스트 확인**

```bash
cd ~/dev/smart_seller_studio/.worktrees/sourcing-candidates
ls node_modules | wc -l          # 0이면 npm ci --no-audit --no-fund
cp ../../.env.local .env.local    # 개발 서버·수동 E2E용. 커밋 대상 아님(.gitignore)
npx vitest run src/lib/receipt src/lib/sourcing 2>&1 | tail -4
```
Expected: `Test Files … passed`. 실패가 있으면 이 작업 전부터 있던 것인지 `git stash` 없이 main에서 같은 명령으로 확인하고 기록만 한다.

---

### Task 1: structured outputs 스키마 헬퍼 추출

**Files:**
- Create: `src/lib/ai/structured-schema.ts`
- Modify: `src/lib/receipt/extract.ts` (`UNSUPPORTED_KEYWORDS`·`stripUnsupportedKeywords`·`receiptJsonSchema`)
- Test: `src/lib/sourcing-candidates/__tests__/structured-schema.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/sourcing-candidates/__tests__/structured-schema.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toStructuredOutputSchema } from '@/lib/ai/structured-schema';

describe('toStructuredOutputSchema', () => {
  it('zod 정수 제약(minimum/maximum)을 걷어낸다 — API가 400을 낸다', () => {
    const schema = toStructuredOutputSchema(z.object({ n: z.number().int() }));
    expect(JSON.stringify(schema)).not.toMatch(/minimum|maximum/);
  });

  it('구조는 유지한다', () => {
    const schema = toStructuredOutputSchema(z.object({ n: z.number().int(), s: z.string().nullable() })) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual(['n', 's']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/structured-schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/structured-schema'`

- [ ] **Step 3: 구현**

```ts
// src/lib/ai/structured-schema.ts
import { z } from 'zod';

/**
 * zod 스키마 → Anthropic structured outputs용 JSON Schema.
 *
 * `z.number().int()`는 안전 정수 범위를 minimum/maximum으로 내보내는데,
 * structured outputs는 그 키워드를 지원하지 않아 400이 난다.
 * zod 스키마 자체는 로컬 검증에 그대로 쓰고 API로 나가는 쪽만 손질한다.
 * (영수증 판독 extract.ts에 있던 것을 소싱 후보 판독과 함께 쓰려고 옮겼다)
 */
const UNSUPPORTED_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const;

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) continue;
    out[key] = strip(value);
  }
  return out;
}

export function toStructuredOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}
```

`src/lib/receipt/extract.ts`에서 `UNSUPPORTED_KEYWORDS` 상수·`stripUnsupportedKeywords` 함수와 그 주석을 지우고, `receiptJsonSchema`를 아래로 바꾼다:

```ts
import { toStructuredOutputSchema } from '@/lib/ai/structured-schema';

/** API로 보낼 JSON Schema. 미지원 키워드가 제거되어 있다 */
export function receiptJsonSchema(): Record<string, unknown> {
  return toStructuredOutputSchema(RECEIPT_SCHEMA);
}
```

- [ ] **Step 4: 통과 확인 (영수증 테스트 포함)**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/structured-schema.test.ts src/lib/receipt`
Expected: PASS 전부

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/structured-schema.ts src/lib/receipt/extract.ts src/lib/sourcing-candidates/__tests__/structured-schema.test.ts
git commit -m "refactor(ai): structured outputs 스키마 헬퍼를 공용으로 추출"
```

---

### Task 2: 판정 함수 두 개를 `coupang-price.ts`에 추가

**Files:**
- Modify: `src/lib/sourcing/coupang-price.ts` (`marginOf` 아래에 추가)
- Test: `src/lib/sourcing-candidates/__tests__/coupang-verdict.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/sourcing-candidates/__tests__/coupang-verdict.test.ts
import { describe, it, expect } from 'vitest';
import { minViablePrice, marginVerdict, breakEvenPrice } from '@/lib/sourcing/coupang-price';

describe('minViablePrice', () => {
  it('마진율 30% 조건만 쓴다 — 실효원가 2,861원·소형이면 12,097원', () => {
    // 2,861 = ¥5 × 217 + 국제배송 추정 1,323 + 관세 8% + 수입부가세 (2026-09-27 앱 상수)
    expect(minViablePrice(2861, 'small')).toBe(12097);
  });

  it('breakEvenPrice보다 낮다 — 물류비 1.5배 조건이 빠졌기 때문', () => {
    expect(minViablePrice(2861, 'small')).toBeLessThan(breakEvenPrice(2861, 'small'));
  });
});

describe('marginVerdict', () => {
  it('핸들 토시 #3: 14,390원·실효원가 3,944원 → 4,533원·31.5%, 마진율 통과·물류비 1.5배 미달', () => {
    const v = marginVerdict(14390, 3944, 'small');
    expect(v.margin).toBe(4533);
    expect(v.marginRate).toBeCloseTo(0.315, 3);
    expect(v.passRate).toBe(true);
    expect(v.passAmount).toBe(false);
    expect(v.pass).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/coupang-verdict.test.ts`
Expected: FAIL — `minViablePrice is not a function`

- [ ] **Step 3: 구현** — `marginOf` 함수 바로 아래에 추가

```ts
/**
 * 마진율 30%만 겨우 맞추는 판매가(원) — 사전 거름망용 하한.
 *
 * breakEvenPrice는 「물류비 × 1.5」 조건까지 넣어 원가가 낮을 때 그 조건이 지배한다
 * (¥5 기준 14,813원). 캡처를 훑는 단계에서 그 값으로 자르면 강의 공식으로는
 * 통과할 12~14천원대를 미리 버리게 된다. 그래서 거름망은 ① 조건만 쓰고,
 * ② 조건은 채택한 1688 원가로 marginVerdict가 판정한다.
 */
export function minViablePrice(effectiveCost: number, size: LogisticsSize): number {
  return Math.ceil((effectiveCost + LOGISTICS_FEE[size]) / (1 - PRICE_LINKED_RATE - TARGET_MARGIN_RATE));
}

export interface MarginVerdict {
  margin: number;
  marginRate: number;
  /** ① 마진율 30% 이상 */
  passRate: boolean;
  /** ② 개당 마진 ≥ 물류비 × 1.5 */
  passAmount: boolean;
  pass: boolean;
}

/** breakEvenPrice가 역산하는 두 조건을 정방향으로 판정한다 */
export function marginVerdict(
  sellingPrice: number,
  effectiveCost: number,
  size: LogisticsSize,
): MarginVerdict {
  const margin = marginOf(sellingPrice, effectiveCost, size);
  const marginRate = sellingPrice > 0 ? margin / sellingPrice : 0;
  const passRate = marginRate >= TARGET_MARGIN_RATE;
  const passAmount = margin >= LOGISTICS_FEE[size] * MARGIN_TO_LOGISTICS;
  return { margin, marginRate, passRate, passAmount, pass: passRate && passAmount };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/coupang-verdict.test.ts src/lib/sourcing`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing/coupang-price.ts src/lib/sourcing-candidates/__tests__/coupang-verdict.test.ts
git commit -m "feat(sourcing): minViablePrice·marginVerdict — 거름망 하한과 정방향 마진 판정"
```

---

### Task 3: 강의 공식

**Files:**
- Create: `src/lib/sourcing/lecture-formula.ts`
- Test: `src/lib/sourcing-candidates/__tests__/lecture-formula.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/sourcing-candidates/__tests__/lecture-formula.test.ts
import { describe, it, expect } from 'vitest';
import { judgeLecture } from '@/lib/sourcing/lecture-formula';

describe('judgeLecture', () => {
  it('핸들 토시 #3: ¥9.20·14,390원 → 원가율 18.8%, 30% 통과·10% 미달', () => {
    const r = judgeLecture(9.2, 14390)!;
    expect(r.landed).toBeCloseTo(2704.8, 1);
    expect(r.costRatio).toBeCloseTo(0.188, 3);
    expect(r.pass).toBe(true);
    expect(r.best).toBe(false);
    expect(r.profit).toBeCloseTo(14390 * 0.9 - 2704.8, 1);
  });

  it('원가율 10% 이하면 best', () => {
    expect(judgeLecture(2.8, 8900)!.best).toBe(true); // 강의 실측 예시: 830원 착륙 / 8,900원
  });

  it('30% 초과는 탈락', () => {
    expect(judgeLecture(23.5, 10900)!.pass).toBe(false); // 8종 목록 #6 숄 케이프 63.4%
  });

  it('0 이하 입력은 null', () => {
    expect(judgeLecture(0, 10000)).toBeNull();
    expect(judgeLecture(5, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/lecture-formula.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
// src/lib/sourcing/lecture-formula.ts
/**
 * 전인규 강의 공식 — 이 앱의 원본.
 *
 * 근거 (위키):
 *   20-wiki/sources/브랜드 강의 3교시 전인규 2026-09-20 — 착륙원가 = 위안 × 210 × 1.4
 *   20-wiki/sources/도제 상담 1회차 전인규 2026-09-27  — 원가율 10%는 최선, 30%까지 허용
 *
 * 환율 210은 실제 시세가 아니라 넉넉히 잡은 값이고, 1.4는 물류비·부가세·관세·배대지
 * 수수료를 묶은 러프한 배수다. 로켓그로스 물류비는 들어 있지 않다 — 실측 공식과의
 * 차이가 대부분 거기서 나온다. ~/dev/sourcing-review/formulas.js(/calc)는 이 파일의
 * 사본이며 통과선이 아직 10%다.
 */
export const LECTURE_RATE = 210;
export const LECTURE_MULTIPLIER = 1.4;
export const LECTURE_FEE_RATE = 0.1;
export const LECTURE_COST_RATIO_PASS = 0.3;
export const LECTURE_COST_RATIO_BEST = 0.1;

export interface LectureJudgement {
  landed: number;
  costRatio: number;
  profit: number;
  pass: boolean;
  best: boolean;
}

export function judgeLecture(cny: number, price: number): LectureJudgement | null {
  if (!(cny > 0) || !(price > 0)) return null;
  const landed = cny * LECTURE_RATE * LECTURE_MULTIPLIER;
  const costRatio = landed / price;
  return {
    landed,
    costRatio,
    profit: price * (1 - LECTURE_FEE_RATE) - landed,
    pass: costRatio <= LECTURE_COST_RATIO_PASS,
    best: costRatio <= LECTURE_COST_RATIO_BEST,
  };
}

/** 1688 누적 판매량 → 일 판매량. 강의는 6개월 누적으로 보고 180으로 나눈다(기간 미확인) */
export function dailySalesFromCumulative(sold: number): number {
  return sold / 180;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/lecture-formula.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing/lecture-formula.ts src/lib/sourcing-candidates/__tests__/lecture-formula.test.ts
git commit -m "feat(sourcing): 강의 공식 원본 — 원가율 30% 통과·10% 최선"
```

---

### Task 4: 타입과 실측 판정·하한선

**Files:**
- Create: `src/lib/sourcing-candidates/types.ts`, `src/lib/sourcing-candidates/judge.ts`
- Test: `src/lib/sourcing-candidates/__tests__/judge.test.ts`

- [ ] **Step 1: 타입 작성** (테스트 대상 아님 — 이후 태스크가 쓴다)

```ts
// src/lib/sourcing-candidates/types.ts
import type { LogisticsSize } from '@/types/shortlist';

/** Claude가 네이버 캡처 한 장(조각)에서 뽑은 상품 카드 */
export interface ExtractedListing {
  row: number;
  col: number;
  title: string;
  seller: string;
  price: number;
  list_price: number | null;
  discount_pct: number | null;
  review_count: number | null;
  rating: number | null;
  badges: string[];
}

export interface ExtractedNaverPage {
  screen: 'naver_list' | 'other';
  sort_bar_seen: boolean;
  category_path: string | null;
  sort_label: string | null;
  products: ExtractedListing[];
}

/** 병합 후 저장할 한 줄 */
export interface MergedListing extends Omit<ExtractedListing, 'row' | 'col'> {
  rank: number;
  dedup_key: string;
  number_check: string | null;
}

export interface Tier { min_qty: number; cny: number }
export interface OptionPrice { name: string; cny: number | null }

export interface Extracted1688 {
  screen: '1688' | 'other';
  title_cn: string | null;
  tiers: Tier[];
  options: OptionPrice[];
  sold_count: number | null;
  sale_unit: string | null;
  match_verdict: 'same' | 'diff' | 'different';
  match_reason: string;
}

/** DB 행 (sourcing_listings + scan의 category_path) */
export interface ListingRow {
  id: string;
  scan_id: string;
  rank: number;
  title: string;
  seller: string;
  price: number;
  list_price: number | null;
  discount_pct: number | null;
  review_count: number | null;
  rating: number | null;
  badges: string[];
  number_check: string | null;
  starred: boolean;
  excluded_override: boolean | null;
  memo: string | null;
  size: LogisticsSize;
  price_override: number | null;
  category_path: string | null;
}

/** DB 행 (sourcing_offers) */
export interface OfferRow {
  id: string;
  listing_id: string;
  image_paths: string[];
  url: string | null;
  title_cn: string | null;
  tiers: Tier[] | null;
  options: OptionPrice[] | null;
  sold_count: number | null;
  sale_unit: string | null;
  tier_check: string | null;
  match_verdict: 'same' | 'diff' | 'different' | null;
  match_reason: string | null;
  cny_override: number | null;
  adopted: boolean;
  parse_status: 'pending' | 'parsing' | 'parsed' | 'failed';
  parse_error: string | null;
}
```

- [ ] **Step 2: 실패하는 테스트**

```ts
// src/lib/sourcing-candidates/__tests__/judge.test.ts
import { describe, it, expect } from 'vitest';
import { effectiveCostOf, sourcingFloorPrice, judgeReal, REAL_FX_KRW_PER_CNY } from '@/lib/sourcing-candidates/judge';

describe('judge', () => {
  it('환율은 1688 실결제 역산값 217', () => {
    expect(REAL_FX_KRW_PER_CNY).toBe(217);
  });

  it('¥5·소형 실효원가 2,861원 → 하한선 12,097원', () => {
    expect(effectiveCostOf(5, 'small', null)).toBe(2861);
    expect(sourcingFloorPrice('small')).toBe(12097);
  });

  it('핸들 토시 #3 실측: 실효원가 3,944원, 마진 4,533원, 불통과', () => {
    const r = judgeReal(9.2, 14390, 'small', '가죽 핸들 토시')!;
    expect(r.effectiveCost).toBe(3944);
    expect(r.margin).toBe(4533);
    expect(r.passRate).toBe(true);
    expect(r.passAmount).toBe(false);
    expect(r.pass).toBe(false);
  });

  it('0 이하 입력은 null', () => {
    expect(judgeReal(0, 14390, 'small', null)).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/judge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 구현**

```ts
// src/lib/sourcing-candidates/judge.ts
import { calc1688UnitCost } from '@/lib/sourcing/cost-1688';
import { DEFAULT_ORDER_QTY, marginVerdict, minViablePrice, type MarginVerdict } from '@/lib/sourcing/coupang-price';
import type { LogisticsSize } from '@/types/shortlist';

/**
 * 실측 판정 — 앱의 원가·마진 모듈을 그대로 부른다. 사본을 만들지 않는다.
 *
 * 환율 217: 2026-08-25 1688 실결제 두 건(152.30위안=33,062원, 50위안=10,855원) 역산
 * (위키 20-wiki/outputs/1688 샘플 8종 강의 검토 목록 2026-09-26).
 * margin-1688.ts의 DEFAULT_EXCHANGE_RATE_KRW_PER_RMB(195)와 다르다 — 그쪽 정리는 별도 과제.
 */
export const REAL_FX_KRW_PER_CNY = 217;

/** 하한선 계산용 최소 현실 원가 (위키 「판매가 하한선」의 가정) */
export const FLOOR_CNY = 5;

export function effectiveCostOf(cny: number, size: LogisticsSize, itemName: string | null): number | null {
  if (!(cny > 0)) return null;
  const r = calc1688UnitCost({
    buyKrwTotal: Math.round(cny * REAL_FX_KRW_PER_CNY),
    orderQty: 1,
    sourcingOrderQty: DEFAULT_ORDER_QTY,
    intlShipPerUnitKrw: null,
    itemName,
    logisticsSize: size,
  });
  return r.effectiveCostKrw;
}

/** 원가를 보기 전에 버릴 판매가 하한 */
export function sourcingFloorPrice(size: LogisticsSize): number {
  return minViablePrice(effectiveCostOf(FLOOR_CNY, size, null)!, size);
}

export interface RealJudgement extends MarginVerdict {
  effectiveCost: number;
}

export function judgeReal(
  cny: number,
  price: number,
  size: LogisticsSize,
  itemName: string | null,
): RealJudgement | null {
  if (!(price > 0)) return null;
  const effectiveCost = effectiveCostOf(cny, size, itemName);
  if (effectiveCost === null) return null;
  return { effectiveCost, ...marginVerdict(price, effectiveCost, size) };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/judge.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing-candidates/types.ts src/lib/sourcing-candidates/judge.ts src/lib/sourcing-candidates/__tests__/judge.test.ts
git commit -m "feat(sourcing-candidates): 타입·실측 판정·하한선"
```

---

### Task 5: 숫자 검증

**Files:**
- Create: `src/lib/sourcing-candidates/verify.ts`
- Test: `src/lib/sourcing-candidates/__tests__/verify.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/sourcing-candidates/__tests__/verify.test.ts
import { describe, it, expect } from 'vitest';
import { checkListingNumbers, checkTiers } from '@/lib/sourcing-candidates/verify';

describe('checkListingNumbers', () => {
  it('정가 15,200 · 판매가 12,200 · 표시 19% → 통과 (계산 20%, ±1%p)', () => {
    expect(checkListingNumbers({ price: 12200, list_price: 15200, discount_pct: 19 })).toBeNull();
  });
  it('표시 50%면 의심', () => {
    expect(checkListingNumbers({ price: 12200, list_price: 15200, discount_pct: 50 })).toMatch(/할인율/);
  });
  it('판매가가 정가보다 크면 의심', () => {
    expect(checkListingNumbers({ price: 16000, list_price: 15200, discount_pct: null })).toMatch(/정가/);
  });
  it('정가가 없으면 검사하지 않는다', () => {
    expect(checkListingNumbers({ price: 3900, list_price: null, discount_pct: null })).toBeNull();
  });
});

describe('checkTiers', () => {
  it('수량이 늘수록 싸지면 통과', () => {
    expect(checkTiers([{ min_qty: 2, cny: 9.2 }, { min_qty: 100, cny: 8.5 }])).toBeNull();
  });
  it('순서가 섞여 들어와도 수량으로 정렬해 본다', () => {
    expect(checkTiers([{ min_qty: 100, cny: 8.5 }, { min_qty: 2, cny: 9.2 }])).toBeNull();
  });
  it('수량이 늘었는데 비싸지면 의심', () => {
    expect(checkTiers([{ min_qty: 2, cny: 8.5 }, { min_qty: 100, cny: 9.2 }])).toMatch(/구간가/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/verify.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
// src/lib/sourcing-candidates/verify.ts
import type { Tier } from '@/lib/sourcing-candidates/types';

/**
 * 판독 숫자의 자기검증.
 *
 * Vision 판독의 약점은 숫자 오독이다(영수증 판독과 같다). 네이버 카드는 판매가·정가·
 * 할인율 세 숫자가 서로를 검산하므로 그것을 쓴다. 틀리면 막지 않고 표시만 한다 —
 * 표에서 사람이 고칠 수 있다.
 */
export function checkListingNumbers(l: {
  price: number;
  list_price: number | null;
  discount_pct: number | null;
}): string | null {
  if (l.list_price === null) return null;
  if (l.price > l.list_price) return '판매가가 정가보다 큼';
  if (l.discount_pct === null) return null;
  const computed = Math.round((1 - l.price / l.list_price) * 100);
  if (Math.abs(computed - l.discount_pct) > 1) {
    return `할인율 불일치 (표시 ${l.discount_pct}% · 계산 ${computed}%)`;
  }
  return null;
}

/** 1688 구간가는 수량이 늘수록 같거나 싸야 한다 */
export function checkTiers(tiers: Tier[]): string | null {
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].cny > sorted[i - 1].cny) return '구간가가 수량이 늘수록 오름 — 판독 확인';
  }
  return null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/verify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing-candidates/verify.ts src/lib/sourcing-candidates/__tests__/verify.test.ts
git commit -m "feat(sourcing-candidates): 판독 숫자 자기검증"
```

---

### Task 6: 조각 병합·중복 제거·순위

**Files:**
- Create: `src/lib/sourcing-candidates/merge.ts`
- Test: `src/lib/sourcing-candidates/__tests__/merge.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/sourcing-candidates/__tests__/merge.test.ts
import { describe, it, expect } from 'vitest';
import { dedupKey, mergePages } from '@/lib/sourcing-candidates/merge';
import type { ExtractedListing, ExtractedNaverPage } from '@/lib/sourcing-candidates/types';

function card(over: Partial<ExtractedListing>): ExtractedListing {
  return {
    row: 0, col: 0, title: '상품', seller: '판매자', price: 10000,
    list_price: null, discount_pct: null, review_count: 10, rating: 4.8, badges: [],
    ...over,
  };
}
function page(over: Partial<ExtractedNaverPage>): ExtractedNaverPage {
  return { screen: 'naver_list', sort_bar_seen: false, category_path: null, sort_label: null, products: [], ...over };
}

describe('dedupKey', () => {
  it('공백·말줄임표·대소문자를 무시한다', () => {
    expect(dedupKey(card({ seller: '들꽃잠 ', title: '들꽃잠 행복 눈 찜질팩...' })))
      .toBe(dedupKey(card({ seller: '들꽃잠', title: '들꽃잠 행복 눈찜질팩…' })));
  });
  it('가격이 다르면 다른 상품', () => {
    expect(dedupKey(card({ price: 25200 }))).not.toBe(dedupKey(card({ price: 25900 })));
  });
});

describe('mergePages', () => {
  it('겹친 카드는 한 번만, 순위는 먼저 나온 자리', () => {
    const dup = { seller: '들꽃잠', title: '들꽃잠 행복 눈 찜질팩 핑크, 1개', price: 25200 };
    const r = mergePages([
      page({ sort_bar_seen: true, category_path: '건강/의료용품 > 냉온/찜질용품', sort_label: '판매 많은순',
        products: [card({ row: 0, col: 0, title: 'A' }), card({ row: 1, col: 4, ...dup })] }),
      page({ products: [card({ row: 0, col: 0, ...dup }), card({ row: 0, col: 1, title: 'B' })] }),
    ]);
    expect(r.listings.map((l) => l.title)).toEqual(['A', dup.title, 'B']);
    expect(r.listings.map((l) => l.rank)).toEqual([1, 2, 3]);
    expect(r.category_path).toBe('건강/의료용품 > 냉온/찜질용품');
    expect(r.sort_label).toBe('판매 많은순');
  });

  it('한 조각 안에서는 행 우선·왼쪽부터 순위를 매긴다', () => {
    const r = mergePages([page({ products: [
      card({ row: 1, col: 0, title: 'C' }), card({ row: 0, col: 1, title: 'B' }), card({ row: 0, col: 0, title: 'A' }),
    ] })]);
    expect(r.listings.map((l) => l.title)).toEqual(['A', 'B', 'C']);
  });

  it('정렬 바가 처음 보인 조각보다 앞 조각의 상품은 버린다 — 추천 블록이다', () => {
    const r = mergePages([
      page({ products: [card({ title: '광고' })] }),
      page({ sort_bar_seen: true, products: [card({ title: '1위' })] }),
    ]);
    expect(r.listings.map((l) => l.title)).toEqual(['1위']);
  });

  it('정렬 바가 어디에도 없으면(중간 스크롤 캡처) 전부 쓴다', () => {
    const r = mergePages([page({ products: [card({ title: 'X' })] })]);
    expect(r.listings).toHaveLength(1);
  });

  it('숫자 검증 결과를 줄에 싣는다', () => {
    const r = mergePages([page({ products: [card({ price: 12200, list_price: 15200, discount_pct: 50 })] })]);
    expect(r.listings[0].number_check).toMatch(/할인율/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/merge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
// src/lib/sourcing-candidates/merge.ts
import { checkListingNumbers } from '@/lib/sourcing-candidates/verify';
import type { ExtractedListing, ExtractedNaverPage, MergedListing } from '@/lib/sourcing-candidates/types';

function normalize(s: string): string {
  return s.replace(/\s+/g, '').replace(/(\.\.\.|…)+$/, '').toLowerCase();
}

/**
 * 같은 상품 판정 키.
 * 스크롤 캡처·겹친 조각에서 같은 카드가 두 번 찍힌다(2026-09-27 찜질 캡처의 들꽃잠).
 * 판매자+상품명+판매가가 같으면 같은 카드로 본다. 말줄임 위치가 조각마다
 * 같게 렌더되므로 상품명 앞부분 비교로 충분하다.
 */
export function dedupKey(l: Pick<ExtractedListing, 'seller' | 'title' | 'price'>): string {
  return `${normalize(l.seller)}|${normalize(l.title)}|${l.price}`;
}

export interface MergeResult {
  category_path: string | null;
  sort_label: string | null;
  listings: MergedListing[];
}

/**
 * 조각(또는 여러 장 캡처)을 순서대로 합친다.
 *
 * 정렬 바 위는 맞춤 추천·장보기 같은 광고 블록이라 순위가 아니다(도마 캡처 실측).
 * 정렬 바는 첫 조각에서만 보이므로, 정렬 바가 처음 보인 조각부터 쓰고 그 앞 조각은
 * 통째로 버린다. 그 조각 안의 정렬 바 위 상품은 판독 단계에서 이미 빠져 있다.
 */
export function mergePages(pages: ExtractedNaverPage[]): MergeResult {
  const firstSort = pages.findIndex((p) => p.sort_bar_seen);
  const used = firstSort < 0 ? pages : pages.slice(firstSort);

  const seen = new Set<string>();
  const listings: MergedListing[] = [];
  for (const p of used) {
    const ordered = [...p.products].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const c of ordered) {
      const key = dedupKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      const { row: _row, col: _col, ...rest } = c;
      listings.push({ ...rest, rank: listings.length + 1, dedup_key: key, number_check: checkListingNumbers(c) });
    }
  }

  return {
    category_path: used.find((p) => p.category_path)?.category_path ?? null,
    sort_label: used.find((p) => p.sort_label)?.sort_label ?? null,
    listings,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/merge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing-candidates/merge.ts src/lib/sourcing-candidates/__tests__/merge.test.ts
git commit -m "feat(sourcing-candidates): 조각 병합·중복 제거·추천 블록 제외"
```

---

### Task 7: 거름망과 조회 응답 조립

**Files:**
- Create: `src/lib/sourcing-candidates/filters.ts`, `src/lib/sourcing-candidates/view.ts`
- Test: `src/lib/sourcing-candidates/__tests__/filters.test.ts`, `src/lib/sourcing-candidates/__tests__/view.test.ts`

- [ ] **Step 1: 실패하는 테스트 (거름망)**

```ts
// src/lib/sourcing-candidates/__tests__/filters.test.ts
import { describe, it, expect } from 'vitest';
import { listingFlags, isExcluded } from '@/lib/sourcing-candidates/filters';

const base = { price: 20000, badges: [] as string[], title: '실리콘 도마', review_count: 500 };
const FLOOR = 12097;

describe('listingFlags', () => {
  it('9,900원은 하한선 아래', () => {
    expect(listingFlags({ ...base, price: 9900 }, FLOOR)).toContain('below_floor');
  });
  it('12,200원은 통과', () => {
    expect(listingFlags({ ...base, price: 12200 }, FLOOR)).not.toContain('below_floor');
  });
  it('공식 배지', () => {
    expect(listingFlags({ ...base, badges: ['공식', '우수셀러'] }, FLOOR)).toContain('official');
  });
  it('전기·의료 단어', () => {
    expect(listingFlags({ ...base, title: '한일의료기 전기 온열 찜질기' }, FLOOR)).toContain('electric');
  });
  it('리뷰 1만 이상은 강자', () => {
    expect(listingFlags({ ...base, review_count: 45929 }, FLOOR)).toContain('strong');
    expect(listingFlags({ ...base, review_count: null }, FLOOR)).not.toContain('strong');
  });
});

describe('isExcluded', () => {
  it('하한선 아래만 자동 제외', () => {
    expect(isExcluded(['below_floor'], null)).toBe(true);
    expect(isExcluded(['official', 'strong'], null)).toBe(false);
  });
  it('사람이 뒤집은 값이 이긴다', () => {
    expect(isExcluded(['below_floor'], false)).toBe(false);
    expect(isExcluded([], true)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패하는 테스트 (조회 조립)**

```ts
// src/lib/sourcing-candidates/__tests__/view.test.ts
import { describe, it, expect } from 'vitest';
import { buildListingView, offerCny } from '@/lib/sourcing-candidates/view';
import type { ListingRow, OfferRow } from '@/lib/sourcing-candidates/types';

const listing: ListingRow = {
  id: 'l1', scan_id: 's1', rank: 1, title: '가죽 핸들 토시', seller: '체니모', price: 14390,
  list_price: null, discount_pct: null, review_count: 812, rating: 4.8, badges: [], number_check: null,
  starred: true, excluded_override: null, memo: null, size: 'small', price_override: null, category_path: null,
};
function offer(over: Partial<OfferRow>): OfferRow {
  return {
    id: 'o1', listing_id: 'l1', image_paths: [], url: null, title_cn: null,
    tiers: [{ min_qty: 100, cny: 8.5 }, { min_qty: 2, cny: 9.2 }], options: [], sold_count: 22,
    sale_unit: '件', tier_check: null, match_verdict: 'same', match_reason: '', cny_override: null,
    adopted: false, parse_status: 'parsed', parse_error: null, ...over,
  };
}

describe('offerCny', () => {
  it('최소 주문 구간 단가를 쓴다', () => {
    expect(offerCny(offer({}))).toBe(9.2);
  });
  it('사람이 넣은 값이 이긴다', () => {
    expect(offerCny(offer({ cny_override: 7 }))).toBe(7);
  });
  it('구간가가 없으면 null', () => {
    expect(offerCny(offer({ tiers: [] }))).toBeNull();
  });
});

describe('buildListingView', () => {
  it('채택 업체에 두 공식 판정이 붙는다', () => {
    const v = buildListingView(listing, [offer({ adopted: true })]);
    expect(v.adopted?.lecture?.pass).toBe(true);
    expect(v.adopted?.real?.margin).toBe(4533);
    expect(v.adopted?.daily).toBeCloseTo(22 / 180, 5);
  });
  it('판매가 수정값으로 판정한다', () => {
    const v = buildListingView({ ...listing, price_override: 9900 }, []);
    expect(v.flags).toContain('below_floor');
    expect(v.excluded).toBe(true);
    expect(v.effective_price).toBe(9900);
  });
  it('채택이 없으면 adopted는 null', () => {
    expect(buildListingView(listing, [offer({})]).adopted).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/filters.test.ts src/lib/sourcing-candidates/__tests__/view.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: 구현**

```ts
// src/lib/sourcing-candidates/filters.ts
/**
 * 후보 표 자동 거름망.
 * 자동 「제외」는 하한선 하나뿐이고 나머지는 경고다 — 제외한 줄도 숨기지 않고 접어 둔다.
 * 근거: 하한선 = 위키 「장갑 카테고리 판정과 판매가 하한선 2026-08-23」,
 * 강자·전기 = 「도제 상담 1회차 전인규 2026-09-27」.
 */
export type FilterFlag = 'below_floor' | 'official' | 'electric' | 'strong';

export const ELECTRIC_WORDS = ['전기', '온열기', '의료기기', '충전식'];
export const STRONG_REVIEW_COUNT = 10_000;

export function listingFlags(
  l: { price: number; badges: string[]; title: string; review_count: number | null },
  floor: number,
): FilterFlag[] {
  const flags: FilterFlag[] = [];
  if (l.price < floor) flags.push('below_floor');
  if (l.badges.includes('공식')) flags.push('official');
  if (ELECTRIC_WORDS.some((w) => l.title.includes(w))) flags.push('electric');
  if ((l.review_count ?? 0) >= STRONG_REVIEW_COUNT) flags.push('strong');
  return flags;
}

/** 사람이 뒤집은 값(excluded_override)이 있으면 그것이 이긴다 */
export function isExcluded(flags: FilterFlag[], override: boolean | null): boolean {
  return override ?? flags.includes('below_floor');
}
```

```ts
// src/lib/sourcing-candidates/view.ts
import { judgeLecture, dailySalesFromCumulative, type LectureJudgement } from '@/lib/sourcing/lecture-formula';
import { judgeReal, sourcingFloorPrice, type RealJudgement } from '@/lib/sourcing-candidates/judge';
import { listingFlags, isExcluded, type FilterFlag } from '@/lib/sourcing-candidates/filters';
import type { ListingRow, OfferRow } from '@/lib/sourcing-candidates/types';

export interface OfferView extends OfferRow {
  cny: number | null;
  lecture: LectureJudgement | null;
  real: RealJudgement | null;
  daily: number | null;
}

export interface ListingView extends ListingRow {
  effective_price: number;
  floor: number;
  flags: FilterFlag[];
  excluded: boolean;
  offers: OfferView[];
  adopted: OfferView | null;
}

/** 채택 원가 = 사람이 넣은 값, 없으면 최소 주문 구간 단가 */
export function offerCny(o: Pick<OfferRow, 'cny_override' | 'tiers'>): number | null {
  if (o.cny_override !== null) return o.cny_override;
  const tiers = o.tiers ?? [];
  if (tiers.length === 0) return null;
  return [...tiers].sort((a, b) => a.min_qty - b.min_qty)[0].cny;
}

/**
 * 조회 응답 한 줄. 판정은 여기서 매번 계산한다 — 저장하면 상수가 바뀔 때 조용히 낡는다.
 */
export function buildListingView(l: ListingRow, offers: OfferRow[]): ListingView {
  const effective_price = l.price_override ?? l.price;
  const floor = sourcingFloorPrice(l.size);
  const flags = listingFlags({ ...l, price: effective_price }, floor);
  const views: OfferView[] = offers.map((o) => {
    const cny = offerCny(o);
    return {
      ...o,
      cny,
      lecture: cny === null ? null : judgeLecture(cny, effective_price),
      real: cny === null ? null : judgeReal(cny, effective_price, l.size, l.title),
      daily: o.sold_count === null ? null : dailySalesFromCumulative(o.sold_count),
    };
  });
  return {
    ...l,
    effective_price,
    floor,
    flags,
    excluded: isExcluded(flags, l.excluded_override),
    offers: views,
    adopted: views.find((o) => o.adopted) ?? null,
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/filters.test.ts src/lib/sourcing-candidates/__tests__/view.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing-candidates/filters.ts src/lib/sourcing-candidates/view.ts src/lib/sourcing-candidates/__tests__/filters.test.ts src/lib/sourcing-candidates/__tests__/view.test.ts
git commit -m "feat(sourcing-candidates): 거름망·조회 응답 조립"
```

---

### Task 8: 조각 경계 계산 (순수)

**Files:**
- Create: `src/lib/sourcing-candidates/tile.ts`
- Test: `src/lib/sourcing-candidates/__tests__/tile.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/sourcing-candidates/__tests__/tile.test.ts
import { describe, it, expect } from 'vitest';
import { computeTiles, findContentEnd, TILE_HEIGHT, TILE_OVERLAP } from '@/lib/sourcing-candidates/tile';

describe('computeTiles', () => {
  it('상한 이하면 한 장', () => {
    expect(computeTiles(2000)).toEqual([{ top: 0, height: 2000 }]);
  });
  it('찜질 캡처(빈칸 제거 후 4,456px) → 2장, 600px 겹침', () => {
    expect(computeTiles(4456)).toEqual([
      { top: 0, height: 2576 },
      { top: 1976, height: 2480 },
    ]);
  });
  it('도마 캡처(6,755px) → 4장, 끝까지 덮는다', () => {
    const tiles = computeTiles(6755);
    expect(tiles.map((t) => t.top)).toEqual([0, 1976, 3952, 5928]);
    const last = tiles[tiles.length - 1];
    expect(last.top + last.height).toBe(6755);
  });
  it('겹침은 카드 한 칸(약 430px)보다 크다', () => {
    expect(TILE_OVERLAP).toBeGreaterThan(430);
    expect(TILE_HEIGHT).toBe(2576);
  });
});

describe('findContentEnd', () => {
  it('마지막 내용 줄 + 여백', () => {
    const blank = [false, false, true, false, ...Array(100).fill(true)];
    expect(findContentEnd(blank, 20)).toBe(4 + 20);
  });
  it('여백은 이미지 끝을 넘지 않는다', () => {
    expect(findContentEnd([false, false, false], 20)).toBe(3);
  });
  it('전부 빈칸이면 전체 높이', () => {
    expect(findContentEnd([true, true], 20)).toBe(2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/tile.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
// src/lib/sourcing-candidates/tile.ts
/**
 * 전체 페이지 캡처를 판독 가능한 조각으로 나누는 경계 계산 (순수 함수).
 *
 * 2,576px: Claude 고해상도 상한(receipt/downscale.ts와 같은 값). 세로로 긴 캡처를
 * 통째로 보내면 모델이 긴 변을 이 값으로 줄여 폭 1,985px가 약 310px가 되고 글자가 뭉개진다.
 * 600px 겹침: 상품 카드 한 칸(폭 1,985px 기준 약 430px)보다 커야 모든 카드가
 * 어느 조각엔가 온전히 들어간다. 가장자리에서 잘린 카드는 판독 프롬프트가 버린다.
 */
export const TILE_HEIGHT = 2576;
export const TILE_OVERLAP = 600;

export interface TileBox { top: number; height: number }

export function computeTiles(height: number): TileBox[] {
  const step = TILE_HEIGHT - TILE_OVERLAP;
  const tiles: TileBox[] = [];
  let top = 0;
  for (;;) {
    const h = Math.min(TILE_HEIGHT, height - top);
    tiles.push({ top, height: h });
    if (top + h >= height) break;
    top += step;
  }
  return tiles;
}

/**
 * 내용이 끝나는 높이.
 * 찜질 캡처는 16,384px 중 위 4,456px만 상품이고 나머지는 흰 빈칸이었다(Chrome 캡처 상한 +
 * 네이버가 화면 밖 상품을 그리지 않음). 마지막 내용 줄 뒤에 여백을 조금 둔다.
 */
export function findContentEnd(rowIsBlank: boolean[], margin: number): number {
  let last = -1;
  for (let y = rowIsBlank.length - 1; y >= 0; y--) {
    if (!rowIsBlank[y]) { last = y; break; }
  }
  if (last < 0) return rowIsBlank.length;
  return Math.min(rowIsBlank.length, last + 1 + margin);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/tile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing-candidates/tile.ts src/lib/sourcing-candidates/__tests__/tile.test.ts
git commit -m "feat(sourcing-candidates): 전체 페이지 캡처 조각 경계 계산"
```

---

### Task 9: 브라우저 캡처 준비 (빈칸 자르기·조각내기)

jsdom에는 캔버스가 없어 단위 시험을 쓰지 않는다. 경계 계산은 Task 8이 검증했고, 이 파일은 Task 17 수동 E2E에서 두 캡처로 확인한다.

**Files:**
- Create: `src/lib/sourcing-candidates/prepare-capture.ts`

- [ ] **Step 1: 구현**

```ts
// src/lib/sourcing-candidates/prepare-capture.ts
'use client';

import { computeTiles, findContentEnd, TILE_HEIGHT } from '@/lib/sourcing-candidates/tile';
import { UPLOAD_BUDGET_BYTES } from '@/lib/receipt/downscale';

/**
 * 업로드 전 캡처 준비 (브라우저 전용).
 *
 * 한 장이든 전체 페이지 캡처든 같은 길을 탄다: 폭을 2,576px 이하로 맞추고 →
 * 아래 빈칸을 잘라내고 → 세로로 조각내 JPEG로 만든다.
 * 서버가 아니라 여기서 하는 이유는 Vercel 요청 본문 4.5MB 상한이다 —
 * 찜질 전체 페이지 캡처 PNG가 이미 4.5MB였다.
 */

/** 행 안의 밝기 편차가 이 값 이하면 빈 줄 (흰 패널과 회색 배경의 차이는 약 30) */
const BLANK_SPREAD = 40;
const CONTENT_MARGIN = 40;
const JPEG_QUALITY = 0.9;

export interface PreparedCapture {
  files: File[];
  totalBytes: number;
  overBudget: boolean;
}

function rowBlankMap(ctx: CanvasRenderingContext2D, width: number, height: number): boolean[] {
  const data = ctx.getImageData(0, 0, width, height).data;
  const blank: boolean[] = new Array(height);
  for (let y = 0; y < height; y++) {
    let min = 255;
    let max = 0;
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
    blank[y] = max - min <= BLANK_SPREAD;
  }
  return blank;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 변환 실패'))), 'image/jpeg', JPEG_QUALITY);
  });
}

async function prepareOne(file: File): Promise<File[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, TILE_HEIGHT / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const full = document.createElement('canvas');
    full.width = width;
    full.height = height;
    const ctx = full.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const end = findContentEnd(rowBlankMap(ctx, width, height), CONTENT_MARGIN);
    const base = file.name.replace(/\.[^.]+$/, '') || 'capture';

    const out: File[] = [];
    for (const [i, t] of computeTiles(end).entries()) {
      const tile = document.createElement('canvas');
      tile.width = width;
      tile.height = t.height;
      tile.getContext('2d')!.drawImage(full, 0, t.top, width, t.height, 0, 0, width, t.height);
      const blob = await toJpeg(tile);
      out.push(new File([blob], `${base}-${i}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
    }
    return out;
  } finally {
    bitmap.close();
  }
}

/** 여러 캡처를 올린 순서대로 조각내 한 줄로 이어 붙인다 — 순위가 이 순서를 따른다 */
export async function prepareCaptures(input: File[]): Promise<PreparedCapture> {
  const files: File[] = [];
  for (const f of input) files.push(...(await prepareOne(f)));
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  return { files, totalBytes, overBudget: totalBytes > UPLOAD_BUDGET_BYTES };
}
```

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep sourcing-candidates || echo "no errors in sourcing-candidates"`
Expected: `no errors in sourcing-candidates`

- [ ] **Step 3: Commit**

```bash
git add src/lib/sourcing-candidates/prepare-capture.ts
git commit -m "feat(sourcing-candidates): 브라우저에서 캡처 빈칸 자르기·조각내기"
```

---

### Task 10: 마이그레이션

**Files:**
- Create: `supabase/migrations/120_sourcing_candidates.sql`

- [ ] **Step 1: SQL 작성**

```sql
-- 소싱 후보 수집기
-- spec docs/superpowers/specs/2026-09-27-sourcing-candidates-design.md
--
-- 적용: Supabase 대시보드 SQL Editor에서 직접 실행한다.
-- 격리는 RLS가 아니라 라우트의 user_id 조건이다 (앱은 service-role pg 풀 · 영수증 테이블과 같다).
-- 판정(거름망·두 공식)은 저장하지 않는다 — 조회 때 계산한다. 상수가 바뀌면 자동으로 따른다.

-- ── 네이버 캡처 묶음 1회 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sourcing_scans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  image_paths      text[] NOT NULL DEFAULT '{}',
  category_path    text,
  sort_label       text,
  parse_status     text NOT NULL DEFAULT 'pending'
                     CHECK (parse_status IN ('pending','parsing','parsed','failed')),
  parse_attempts   int NOT NULL DEFAULT 0 CHECK (parse_attempts >= 0),
  parse_started_at timestamptz,
  parse_error      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_scans_user
  ON sourcing_scans (user_id, created_at DESC);

-- ── 판독된 네이버 상품 1개 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sourcing_listings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id           uuid NOT NULL REFERENCES sourcing_scans(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  rank              int NOT NULL CHECK (rank > 0),
  title             text NOT NULL,
  seller            text NOT NULL,
  price             int NOT NULL CHECK (price > 0),
  list_price        int,
  discount_pct      int,
  review_count      int,
  rating            numeric(3,2),
  badges            text[] NOT NULL DEFAULT '{}',
  dedup_key         text NOT NULL,
  number_check      text,
  starred           boolean NOT NULL DEFAULT false,
  excluded_override boolean,
  memo              text,
  size              text NOT NULL DEFAULT 'small' CHECK (size IN ('xsmall','small','medium')),
  price_override    int CHECK (price_override > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sourcing_listings_dedup
  ON sourcing_listings (scan_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_sourcing_listings_starred
  ON sourcing_listings (user_id, starred) WHERE starred;

-- ── 1688 업체 1곳 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sourcing_offers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       uuid NOT NULL REFERENCES sourcing_listings(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  image_paths      text[] NOT NULL DEFAULT '{}',
  url              text,
  title_cn         text,
  tiers            jsonb,
  options          jsonb,
  sold_count       int,
  sale_unit        text,
  tier_check       text,
  match_verdict    text CHECK (match_verdict IN ('same','diff','different')),
  match_reason     text,
  cny_override     numeric(10,2) CHECK (cny_override > 0),
  adopted          boolean NOT NULL DEFAULT false,
  parse_status     text NOT NULL DEFAULT 'pending'
                     CHECK (parse_status IN ('pending','parsing','parsed','failed')),
  parse_attempts   int NOT NULL DEFAULT 0 CHECK (parse_attempts >= 0),
  parse_error      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_offers_listing ON sourcing_offers (listing_id);
-- 후보당 채택은 하나
CREATE UNIQUE INDEX IF NOT EXISTS idx_sourcing_offers_adopted
  ON sourcing_offers (listing_id) WHERE adopted;
```

- [ ] **Step 2: 사용자에게 적용 요청 (게이트)**

이 파일 내용을 사용자에게 보여주고 **Supabase 대시보드 SQL Editor에서 실행해 달라**고 요청한다. 적용 확인:

```bash
node -e "const {Pool}=require('pg');require('dotenv').config({path:'.env.local'});const p=new Pool({connectionString:process.env.SOURCING_DATABASE_URL||process.env.DATABASE_URL});p.query(\"select table_name from information_schema.tables where table_name like 'sourcing_%' and table_name in ('sourcing_scans','sourcing_listings','sourcing_offers') order by 1\").then(r=>{console.log(r.rows.map(x=>x.table_name));p.end()})"
```
Expected: `[ 'sourcing_listings', 'sourcing_offers', 'sourcing_scans' ]`
(연결 변수명이 다르면 `src/lib/sourcing/db.ts`의 `getSourcingPool`이 읽는 이름을 쓴다.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/120_sourcing_candidates.sql
git commit -m "feat(db): 소싱 후보 수집기 테이블 3개"
```

---

### Task 11: Storage 경로

**Files:**
- Create: `src/lib/sourcing-candidates/storage-path.ts`
- Test: `src/lib/sourcing-candidates/__tests__/storage-path.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/sourcing-candidates/__tests__/storage-path.test.ts
import { describe, it, expect } from 'vitest';
import { scanImagePath, offerImagePath } from '@/lib/sourcing-candidates/storage-path';

describe('storage-path', () => {
  it('스캔 이미지 경로에 사용자·스캔 uuid가 들어간다', () => {
    expect(scanImagePath('u1', 's1', 0)).toBe('sourcing-candidates/u1/scans/s1/0.jpg');
  });
  it('업체 이미지 경로', () => {
    expect(offerImagePath('u1', 'o1', 2)).toBe('sourcing-candidates/u1/offers/o1/2.jpg');
  });
  it('음수 순번은 거부', () => {
    expect(() => scanImagePath('u1', 's1', -1)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/storage-path.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
// src/lib/sourcing-candidates/storage-path.ts
/**
 * 소싱 후보 캡처의 Storage 경로.
 * 공개 버킷이라 완화책은 경로 추측 불가능성뿐이다(영수증과 같다) — uuid를 경로에 넣는다.
 * 브라우저가 전부 JPEG로 만들어 보내므로 확장자는 jpg 하나다.
 * 판독 후에도 지우지 않는다 — 오독을 원본과 대조해야 한다.
 */
function assertIndex(index: number) {
  if (index < 0 || !Number.isInteger(index)) throw new Error(`index는 0 이상의 정수여야 합니다: ${index}`);
}

export function scanImagePath(userId: string, scanId: string, index: number): string {
  assertIndex(index);
  return `sourcing-candidates/${userId}/scans/${scanId}/${index}.jpg`;
}

export function offerImagePath(userId: string, offerId: string, index: number): string {
  assertIndex(index);
  return `sourcing-candidates/${userId}/offers/${offerId}/${index}.jpg`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/storage-path.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing-candidates/storage-path.ts src/lib/sourcing-candidates/__tests__/storage-path.test.ts
git commit -m "feat(sourcing-candidates): Storage 경로"
```

---

### Task 12: Claude 판독 (네이버·1688)

**Files:**
- Create: `src/lib/sourcing-candidates/extract-naver.ts`, `src/lib/sourcing-candidates/extract-1688.ts`
- Test: `src/lib/sourcing-candidates/__tests__/extract.test.ts`

- [ ] **Step 1: 실패하는 테스트 (스키마·프롬프트 — API는 부르지 않는다)**

```ts
// src/lib/sourcing-candidates/__tests__/extract.test.ts
import { describe, it, expect } from 'vitest';
import { NAVER_PAGE_SCHEMA, NAVER_PROMPT, naverJsonSchema } from '@/lib/sourcing-candidates/extract-naver';
import { OFFER_SCHEMA, offerPrompt, offerJsonSchema } from '@/lib/sourcing-candidates/extract-1688';

const naverSample = {
  screen: 'naver_list', sort_bar_seen: true,
  category_path: '주방용품 > 도마', sort_label: '판매 많은순',
  products: [{
    row: 0, col: 0, title: '테르헨 국산 스텐도마 316 스테인레스 주방도마 43x25cm', seller: '테르헨',
    price: 41300, list_price: null, discount_pct: null, review_count: 3831, rating: 4.77, badges: [],
  }],
};

describe('NAVER_PAGE_SCHEMA', () => {
  it('도마 캡처 1위 카드를 통과시킨다', () => {
    expect(NAVER_PAGE_SCHEMA.safeParse(naverSample).success).toBe(true);
  });
  it('price가 없으면 거부 — 순위·거름망의 근거다', () => {
    const broken = { ...naverSample, products: [{ ...naverSample.products[0], price: null }] };
    expect(NAVER_PAGE_SCHEMA.safeParse(broken).success).toBe(false);
  });
  it('API용 스키마에 정수 제약이 없다', () => {
    expect(JSON.stringify(naverJsonSchema())).not.toMatch(/minimum|maximum/);
  });
  it('프롬프트가 추천 블록·잘린 카드·로딩 칸을 다룬다', () => {
    expect(NAVER_PROMPT).toMatch(/정렬 바/);
    expect(NAVER_PROMPT).toMatch(/잘려/);
    expect(NAVER_PROMPT).toMatch(/로딩/);
  });
});

describe('OFFER_SCHEMA', () => {
  it('같은 물건 판정을 필수로 받는다', () => {
    const ok = {
      screen: '1688', title_cn: '皮革车把套', tiers: [{ min_qty: 2, cny: 9.2 }], options: [],
      sold_count: 22, sale_unit: '件', match_verdict: 'diff', match_reason: '판매 단위가 한 짝일 수 있음',
    };
    expect(OFFER_SCHEMA.safeParse(ok).success).toBe(true);
    expect(OFFER_SCHEMA.safeParse({ ...ok, match_verdict: undefined }).success).toBe(false);
  });
  it('프롬프트에 대상 네이버 상품이 들어간다', () => {
    const p = offerPrompt({ title: '가죽 핸들 토시', price: 14390 });
    expect(p).toContain('가죽 핸들 토시');
    expect(p).toContain('14,390');
    expect(p).toMatch(/판매 단위/);
  });
  it('API용 스키마', () => {
    expect(JSON.stringify(offerJsonSchema())).not.toMatch(/minimum|maximum/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/extract.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: 구현 (네이버)**

```ts
// src/lib/sourcing-candidates/extract-naver.ts
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { toStructuredOutputSchema } from '@/lib/ai/structured-schema';
import type { ExtractedNaverPage } from '@/lib/sourcing-candidates/types';

const int = z.number().int();

export const NAVER_LISTING_SCHEMA = z.object({
  row: int,
  col: int,
  title: z.string(),
  seller: z.string(),
  price: int,
  list_price: int.nullable(),
  discount_pct: int.nullable(),
  review_count: int.nullable(),
  rating: z.number().nullable(),
  badges: z.array(z.string()),
});

export const NAVER_PAGE_SCHEMA = z.object({
  screen: z.enum(['naver_list', 'other']),
  sort_bar_seen: z.boolean(),
  category_path: z.string().nullable(),
  sort_label: z.string().nullable(),
  products: z.array(NAVER_LISTING_SCHEMA),
});

export const NAVER_PROMPT = `이 이미지는 네이버 쇼핑 카테고리 상품 목록 화면이거나 그 세로 조각이다. 상품 카드를 추출한다.

읽히지 않으면 null. 절대 추측하지 마라. 흐릿한 숫자를 그럴듯하게 채우는 것은 최악의 실패다.

- screen: 네이버 쇼핑 상품 목록이면 "naver_list", 아니면(1688·다른 사이트) "other". other면 products는 빈 배열.
- sort_bar_seen: "추천순 · 낮은 가격순 · 높은 가격순 · 판매 많은순 · 리뷰 많은순 · 신상품순" 정렬 바가 보이면 true.
- 정렬 바가 보이면 그 위에 있는 상품은 전부 무시한다. 맞춤 추천·장보기·신상 같은 광고 블록이다. 정렬 바 아래 격자만 담는다.
- sort_label: 정렬 바에서 굵게(선택된) 항목의 글자. 정렬 바가 없으면 null.
- category_path: 상단 경로(홈 > A > B)에서 "홈"을 뺀 나머지를 " > "로 이은 것. 안 보이면 null.
- products: 격자 카드마다 하나. row는 위에서 0부터, col은 왼쪽에서 0부터.
- 이미지 위·아래 가장자리에서 잘려 판매자·판매가·리뷰 중 하나라도 온전히 보이지 않는 카드는 담지 마라. 다른 조각에 온전히 있다.
- 글자가 없는 회색 로딩 칸은 담지 마라. 사진만 회색이고 글자가 있으면 담는다.
- 가격 없이 "기획전 바로가기"만 있는 기획전 카드는 담지 마라.
- title: 상품명 줄 그대로(말줄임표 포함). seller: 상품명 위 판매자명(끝의 ">" 제외).
- price: 굵은 판매가(원, 정수). list_price: 취소선 정가, 없으면 null. discount_pct: 판매가 앞 빨간 % 숫자, 없으면 null.
- review_count: "리뷰 N"의 N(쉼표 제거). rating: 별점 숫자.
- badges: 판매자명 옆 배지 중 "공식", "우수셀러", "인증", "해외"만. "슈퍼적립"·"최저가"·"품절임박"은 배지가 아니다.`;

export function naverJsonSchema(): Record<string, unknown> {
  return toStructuredOutputSchema(NAVER_PAGE_SCHEMA);
}

/**
 * 네이버 캡처 한 장(조각)을 판독한다. 조각마다 따로 불러 병렬로 돌린다 —
 * 합치는 것은 merge.ts가 한다(겹친 카드는 키로 걸러진다).
 * 이미지는 브라우저가 이미 2,576px 이하 JPEG로 만들어 보냈다.
 */
export async function extractNaverPage(image: Buffer): Promise<ExtractedNaverPage> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: naverJsonSchema() } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
        { type: 'text', text: NAVER_PROMPT },
      ],
    }],
  });
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  return NAVER_PAGE_SCHEMA.parse(JSON.parse(text)) as ExtractedNaverPage;
}
```

- [ ] **Step 4: 구현 (1688)**

```ts
// src/lib/sourcing-candidates/extract-1688.ts
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { toStructuredOutputSchema } from '@/lib/ai/structured-schema';
import type { Extracted1688 } from '@/lib/sourcing-candidates/types';

export const OFFER_SCHEMA = z.object({
  screen: z.enum(['1688', 'other']),
  title_cn: z.string().nullable(),
  tiers: z.array(z.object({ min_qty: z.number().int(), cny: z.number() })),
  options: z.array(z.object({ name: z.string(), cny: z.number().nullable() })),
  sold_count: z.number().int().nullable(),
  sale_unit: z.string().nullable(),
  match_verdict: z.enum(['same', 'diff', 'different']),
  match_reason: z.string(),
});

export function offerPrompt(target: { title: string; price: number }): string {
  return `이 이미지(1장 이상)는 1688 상품 페이지 한 곳의 캡처다. 원가 정보를 추출하고, 아래 네이버 상품과 같은 물건인지 판정한다.

대상 네이버 상품: "${target.title}" · 판매가 ${target.price.toLocaleString('ko-KR')}원

읽히지 않으면 null. 절대 추측하지 마라.

- screen: 1688 상품 페이지면 "1688", 아니면 "other". other면 나머지는 빈 값, match_verdict는 "different".
- title_cn: 상품 제목 원문.
- tiers: 수량 구간가. 예 "2~99件 ¥9.20 / ≥100件 ¥8.50" → [{min_qty:2,cny:9.2},{min_qty:100,cny:8.5}]. 구간이 하나면 한 개.
- options: 옵션별 가격이 따로 보이면 [{name, cny}]. 없으면 빈 배열.
- sold_count: 누적 판매량 숫자("已售", "成交" 옆). "1万+"처럼 뭉뚱그린 값은 10000처럼 하한으로. 안 보이면 null.
- sale_unit: 가격의 판매 단위 글자(件·双·套·个·对 등).
- match_verdict: 형태·크기·소재·용도·판매 단위를 네이버 상품과 비교한다.
  "same" = 같은 물건. "diff" = 같은 종류지만 차이가 있다. "different" = 다른 물건.
  판매 단위 차이를 반드시 본다 — 네이버가 좌우 한 쌍인데 1688이 한 짝(件) 가격이면 수량이 2배 다르므로 "diff"다.
- match_reason: 판정 이유 한 줄(한국어).`;
}

export function offerJsonSchema(): Record<string, unknown> {
  return toStructuredOutputSchema(OFFER_SCHEMA);
}

export async function extract1688(
  images: Buffer[],
  target: { title: string; price: number },
): Promise<Extracted1688> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: offerJsonSchema() } },
    messages: [{
      role: 'user',
      content: [
        ...images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img.toString('base64') },
        })),
        { type: 'text' as const, text: offerPrompt(target) },
      ],
    }],
  });
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  return OFFER_SCHEMA.parse(JSON.parse(text)) as Extracted1688;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/sourcing-candidates/__tests__/extract.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing-candidates/extract-naver.ts src/lib/sourcing-candidates/extract-1688.ts src/lib/sourcing-candidates/__tests__/extract.test.ts
git commit -m "feat(sourcing-candidates): 네이버·1688 캡처 Claude 판독"
```

---

### Task 13: 스캔 라우트 (업로드·판독·목록)

**Files:**
- Create: `src/app/api/sourcing-candidates/scans/route.ts`, `src/app/api/sourcing-candidates/scans/[id]/parse/route.ts`, `src/lib/sourcing-candidates/upload.ts`

- [ ] **Step 1: 공용 업로드 검사**

```ts
// src/lib/sourcing-candidates/upload.ts
/**
 * multipart 업로드 검사. 브라우저가 이미 JPEG 조각으로 만들어 보내므로
 * 여기는 백스톱이다 — Vercel은 4.5MB 넘는 본문을 함수에 넘기지 않는다(receipt/downscale.ts).
 */
export const MAX_FILES = 12;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export function validateFiles(files: File[]): string | null {
  if (files.length === 0) return 'files 필드가 비어 있습니다.';
  if (files.length > MAX_FILES) return `이미지는 한 번에 ${MAX_FILES}장까지입니다. 나눠서 올려 주세요.`;
  if (files.some((f) => f.type !== 'image/jpeg')) return 'JPEG만 받습니다 (화면이 변환해 보냅니다).';
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return '합계 용량이 너무 큽니다. 나눠서 올려 주세요.';
  return null;
}
```

- [ ] **Step 2: 업로드·목록 라우트**

```ts
// src/app/api/sourcing-candidates/scans/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { uploadToStorage } from '@/lib/supabase/server';
import { scanImagePath } from '@/lib/sourcing-candidates/storage-path';
import { validateFiles } from '@/lib/sourcing-candidates/upload';

/**
 * POST /api/sourcing-candidates/scans — 네이버 캡처 묶음 업로드.
 * 업로드만 하고 반환한다. 판독은 /scans/[id]/parse (영수증과 같은 분리).
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'FormData 파싱 실패' }, { status: 400 });
  }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  const invalid = validateFiles(files);
  if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });

  const scanId = randomUUID();
  try {
    const paths = await Promise.all(
      files.map(async (f, i) => {
        const path = scanImagePath(user.userId, scanId, i);
        await uploadToStorage(path, await f.arrayBuffer(), 'image/jpeg', f.size);
        return path;
      }),
    );
    const { rows } = await getSourcingPool().query(
      `INSERT INTO sourcing_scans (id, user_id, image_paths) VALUES ($1, $2, $3)
       RETURNING id, parse_status, created_at`,
      [scanId, user.userId, paths],
    );
    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '업로드 실패' }, { status: 500 });
  }
}

/** GET /api/sourcing-candidates/scans — 최근 스캔 목록 (상품 수·후보 수 포함) */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { rows } = await getSourcingPool().query(
    `SELECT s.id, s.category_path, s.sort_label, s.parse_status, s.parse_error, s.created_at,
            count(l.id)::int AS listing_count,
            count(l.id) FILTER (WHERE l.starred)::int AS starred_count
     FROM sourcing_scans s
     LEFT JOIN sourcing_listings l ON l.scan_id = s.id
     WHERE s.user_id = $1
     GROUP BY s.id
     ORDER BY s.created_at DESC
     LIMIT 50`,
    [user.userId],
  );
  return NextResponse.json({ success: true, data: rows });
}
```

- [ ] **Step 3: 판독 라우트**

```ts
// src/app/api/sourcing-candidates/scans/[id]/parse/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extractNaverPage } from '@/lib/sourcing-candidates/extract-naver';
import { mergePages } from '@/lib/sourcing-candidates/merge';
import type { ExtractedNaverPage } from '@/lib/sourcing-candidates/types';

export const maxDuration = 60;

/** 흐릿한 캡처 하나가 비용을 계속 쓰지 않도록 (영수증과 같은 3회) */
const MAX_ATTEMPTS = 3;

/**
 * POST /api/sourcing-candidates/scans/[id]/parse
 * 조각마다 병렬 판독 → 병합 → 저장. 일부 조각만 실패하면 성공분은 저장하고
 * parse_error에 실패한 조각 번호를 남긴다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `UPDATE sourcing_scans
     SET parse_status = 'parsing', parse_attempts = parse_attempts + 1, parse_started_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2 AND parse_attempts < $3
       AND (parse_status IN ('pending','failed')
            -- 함수가 시간 초과로 죽으면 'parsing'에 묶인다. 10분 지나면 회수한다(영수증과 같은 규칙)
            OR (parse_status = 'parsing' AND parse_started_at < now() - interval '10 minutes'))
     RETURNING image_paths`,
    [id, user.userId, MAX_ATTEMPTS],
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: '판독할 수 없는 상태입니다 (이미 판독됨·진행 중·3회 실패).' },
      { status: 409 },
    );
  }
  const paths = rows[0].image_paths as string[];

  const fail = async (msg: string, status: number) => {
    await pool.query(
      `UPDATE sourcing_scans SET parse_status = 'failed', parse_error = $2, updated_at = now() WHERE id = $1`,
      [id, msg],
    );
    return NextResponse.json({ success: false, error: msg }, { status });
  };

  const supabase = getSupabaseServerClient();
  const settled = await Promise.allSettled(
    paths.map(async (path) => {
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
      if (error || !data) throw new Error(`이미지를 읽지 못했습니다: ${path}`);
      return extractNaverPage(Buffer.from(await data.arrayBuffer()));
    }),
  );

  const pages: ExtractedNaverPage[] = [];
  const failedIdx: number[] = [];
  settled.forEach((s, i) => (s.status === 'fulfilled' ? pages.push(s.value) : failedIdx.push(i + 1)));

  if (pages.length === 0) return fail('모든 조각의 판독이 실패했습니다. 다시 시도해 주세요.', 502);
  if (pages.some((p) => p.screen !== 'naver_list')) {
    return fail('네이버 쇼핑 목록이 아닌 캡처가 섞여 있습니다. 1688 캡처는 후보 카드에 올려 주세요.', 422);
  }

  const merged = mergePages(pages);
  const partialError = failedIdx.length ? `${failedIdx.join(', ')}번째 조각 판독 실패 — 그 부분을 다시 캡처해 올려 주세요.` : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const l of merged.listings) {
      await client.query(
        `INSERT INTO sourcing_listings
           (scan_id, user_id, rank, title, seller, price, list_price, discount_pct,
            review_count, rating, badges, dedup_key, number_check)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (scan_id, dedup_key) DO NOTHING`,
        [id, user.userId, l.rank, l.title, l.seller, l.price, l.list_price, l.discount_pct,
          l.review_count, l.rating, l.badges, l.dedup_key, l.number_check],
      );
    }
    await client.query(
      `UPDATE sourcing_scans SET parse_status = 'parsed', category_path = $2, sort_label = $3,
         parse_error = $4, updated_at = now() WHERE id = $1`,
      [id, merged.category_path, merged.sort_label, partialError],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(err instanceof Error ? err.message : '저장 실패', 500);
  } finally {
    client.release();
  }

  return NextResponse.json({
    success: true,
    data: { id, listing_count: merged.listings.length, category_path: merged.category_path, sort_label: merged.sort_label, partial_error: partialError },
  });
}
```

- [ ] **Step 4: 타입 확인**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "sourcing-candidates" || echo "no errors in sourcing-candidates"`
Expected: `no errors in sourcing-candidates`

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourcing-candidates/upload.ts src/app/api/sourcing-candidates/scans
git commit -m "feat(sourcing-candidates): 스캔 업로드·판독·목록 라우트"
```

---

### Task 14: 후보·업체 라우트

**Files:**
- Create: `src/lib/sourcing-candidates/parse-offer.ts`
- Create: `src/app/api/sourcing-candidates/listings/route.ts`, `…/listings/[id]/route.ts`, `…/listings/[id]/offers/route.ts`, `…/offers/[id]/route.ts`, `…/offers/[id]/parse/route.ts`

- [ ] **Step 1: 업체 판독 공용 함수**

```ts
// src/lib/sourcing-candidates/parse-offer.ts
import type { Pool } from 'pg';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extract1688 } from '@/lib/sourcing-candidates/extract-1688';
import { checkTiers } from '@/lib/sourcing-candidates/verify';

const MAX_ATTEMPTS = 3;

/**
 * 1688 업체 한 곳을 판독해 저장한다. 업로드 직후와 재시도 라우트가 함께 쓴다.
 * 반환: 오류 문장 또는 null.
 */
export async function parseOffer(pool: Pool, offerId: string, userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE sourcing_offers o
     SET parse_status = 'parsing', parse_attempts = o.parse_attempts + 1, updated_at = now()
     FROM sourcing_listings l
     WHERE o.id = $1 AND o.user_id = $2 AND l.id = o.listing_id
       AND o.parse_status IN ('pending','failed') AND o.parse_attempts < $3
     RETURNING o.image_paths, l.title, COALESCE(l.price_override, l.price) AS price`,
    [offerId, userId, MAX_ATTEMPTS],
  );
  if (rows.length === 0) return '판독할 수 없는 상태입니다 (이미 판독됨·진행 중·3회 실패).';
  const { image_paths, title, price } = rows[0] as { image_paths: string[]; title: string; price: number };

  const fail = async (msg: string) => {
    await pool.query(
      `UPDATE sourcing_offers SET parse_status = 'failed', parse_error = $2, updated_at = now() WHERE id = $1`,
      [offerId, msg],
    );
    return msg;
  };

  try {
    const supabase = getSupabaseServerClient();
    const images = await Promise.all(
      image_paths.map(async (p) => {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(p);
        if (error || !data) throw new Error(`이미지를 읽지 못했습니다: ${p}`);
        return Buffer.from(await data.arrayBuffer());
      }),
    );
    const r = await extract1688(images, { title, price });
    if (r.screen !== '1688') return fail('1688 상품 페이지 캡처가 아닙니다.');

    await pool.query(
      `UPDATE sourcing_offers SET parse_status = 'parsed', parse_error = NULL, title_cn = $2, tiers = $3,
         options = $4, sold_count = $5, sale_unit = $6, tier_check = $7, match_verdict = $8,
         match_reason = $9, updated_at = now()
       WHERE id = $1`,
      [offerId, r.title_cn, JSON.stringify(r.tiers), JSON.stringify(r.options), r.sold_count,
        r.sale_unit, checkTiers(r.tiers), r.match_verdict, r.match_reason],
    );
    return null;
  } catch (err) {
    return fail(err instanceof Error ? err.message : '판독 실패');
  }
}
```

- [ ] **Step 2: 후보 조회**

```ts
// src/app/api/sourcing-candidates/listings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { buildListingView } from '@/lib/sourcing-candidates/view';
import type { ListingRow, OfferRow } from '@/lib/sourcing-candidates/types';

/**
 * GET /api/sourcing-candidates/listings?scan=<id>  — 한 스캔의 전체 상품
 * GET /api/sourcing-candidates/listings?starred=1  — 모든 스캔의 ⭐ 후보 (카드·제출 목록)
 * 판정은 buildListingView가 여기서 계산한다.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const scan = sp.get('scan');
  const starred = sp.get('starred') === '1';
  if (!scan && !starred) {
    return NextResponse.json({ success: false, error: 'scan 또는 starred=1이 필요합니다.' }, { status: 400 });
  }

  const pool = getSourcingPool();
  const { rows: listings } = await pool.query(
    `SELECT l.*, s.category_path
     FROM sourcing_listings l JOIN sourcing_scans s ON s.id = l.scan_id
     WHERE l.user_id = $1 AND ${scan ? 'l.scan_id = $2' : 'l.starred'}
     ORDER BY ${scan ? 'l.rank' : 'l.updated_at DESC'}`,
    scan ? [user.userId, scan] : [user.userId],
  );
  if (listings.length === 0) return NextResponse.json({ success: true, data: [] });

  const { rows: offers } = await pool.query(
    `SELECT * FROM sourcing_offers WHERE listing_id = ANY($1) ORDER BY created_at`,
    [listings.map((l) => l.id)],
  );
  const byListing = new Map<string, OfferRow[]>();
  for (const o of offers as OfferRow[]) {
    const cny = o.cny_override === null ? null : Number(o.cny_override); // numeric → string으로 온다
    byListing.set(o.listing_id, [...(byListing.get(o.listing_id) ?? []), { ...o, cny_override: cny }]);
  }

  const data = (listings as ListingRow[]).map((l) =>
    buildListingView({ ...l, rating: l.rating === null ? null : Number(l.rating) }, byListing.get(l.id) ?? []),
  );
  return NextResponse.json({ success: true, data });
}
```

- [ ] **Step 3: 후보 수정**

```ts
// src/app/api/sourcing-candidates/listings/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const PatchSchema = z.object({
  starred: z.boolean().optional(),
  excluded_override: z.boolean().nullable().optional(),
  memo: z.string().max(1000).nullable().optional(),
  size: z.enum(['xsmall', 'small', 'medium']).optional(),
  price_override: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).optional(),
  review_count: z.number().int().nonnegative().nullable().optional(),
}).strict();

/** PATCH /api/sourcing-candidates/listings/[id] — 사람이 고친 값. AI 값보다 우선한다 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' }, { status: 400 });
  }
  const entries = Object.entries(parsed.data);
  if (entries.length === 0) return NextResponse.json({ success: false, error: '바꿀 값이 없습니다.' }, { status: 400 });

  // 키는 zod strict가 화이트리스트로 막았으므로 컬럼명에 그대로 쓴다
  const sets = entries.map(([k], i) => `${k} = $${i + 3}`).join(', ');
  const { rowCount } = await getSourcingPool().query(
    `UPDATE sourcing_listings SET ${sets}, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [id, user.userId, ...entries.map(([, v]) => v)],
  );
  if (!rowCount) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 업체 업로드 (+즉시 판독)**

```ts
// src/app/api/sourcing-candidates/listings/[id]/offers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { uploadToStorage } from '@/lib/supabase/server';
import { offerImagePath } from '@/lib/sourcing-candidates/storage-path';
import { validateFiles } from '@/lib/sourcing-candidates/upload';
import { parseOffer } from '@/lib/sourcing-candidates/parse-offer';

export const maxDuration = 60;

/**
 * POST /api/sourcing-candidates/listings/[id]/offers — 1688 업체 1곳 추가.
 * 한 번 올린 묶음 = 업체 1곳. 업체 하나는 판독이 짧아(이미지 1~3장) 업로드와 판독을 한 번에 한다.
 * 판독이 실패해도 업체 행은 남는다 — /offers/[id]/parse로 재시도한다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id: listingId } = await params;
  const pool = getSourcingPool();

  const { rowCount } = await pool.query(`SELECT 1 FROM sourcing_listings WHERE id = $1 AND user_id = $2`, [listingId, user.userId]);
  if (!rowCount) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'FormData 파싱 실패' }, { status: 400 });
  }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  const invalid = validateFiles(files);
  if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });
  const url = formData.get('url');

  const offerId = randomUUID();
  try {
    const paths = await Promise.all(
      files.map(async (f, i) => {
        const path = offerImagePath(user.userId, offerId, i);
        await uploadToStorage(path, await f.arrayBuffer(), 'image/jpeg', f.size);
        return path;
      }),
    );
    await pool.query(
      `INSERT INTO sourcing_offers (id, listing_id, user_id, image_paths, url) VALUES ($1, $2, $3, $4, $5)`,
      [offerId, listingId, user.userId, paths, typeof url === 'string' && url ? url : null],
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '업로드 실패' }, { status: 500 });
  }

  const parseError = await parseOffer(pool, offerId, user.userId);
  return NextResponse.json({ success: true, data: { id: offerId, parse_error: parseError } }, { status: 201 });
}
```

- [ ] **Step 5: 업체 수정·채택과 재판독**

```ts
// src/app/api/sourcing-candidates/offers/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const PatchSchema = z.object({
  url: z.string().url().nullable().optional(),
  cny_override: z.number().positive().nullable().optional(),
  adopted: z.literal(true).optional(),
}).strict();

/**
 * PATCH /api/sourcing-candidates/offers/[id]
 * adopted: true면 같은 후보의 다른 업체 채택을 풀고 이것을 채택한다(후보당 하나 — 부분 유니크 인덱스).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' }, { status: 400 });
  }
  const { adopted, ...fields } = parsed.data;
  const pool = getSourcingPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT listing_id FROM sourcing_offers WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, user.userId],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    if (adopted) {
      await client.query(`UPDATE sourcing_offers SET adopted = false, updated_at = now() WHERE listing_id = $1 AND adopted`, [rows[0].listing_id]);
      await client.query(`UPDATE sourcing_offers SET adopted = true, updated_at = now() WHERE id = $1`, [id]);
    }
    const entries = Object.entries(fields);
    if (entries.length) {
      const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      await client.query(`UPDATE sourcing_offers SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 });
  } finally {
    client.release();
  }
  return NextResponse.json({ success: true });
}
```

```ts
// src/app/api/sourcing-candidates/offers/[id]/parse/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { parseOffer } from '@/lib/sourcing-candidates/parse-offer';

export const maxDuration = 60;

/** POST /api/sourcing-candidates/offers/[id]/parse — 실패한 업체 판독 재시도 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const error = await parseOffer(getSourcingPool(), id, user.userId);
  return error
    ? NextResponse.json({ success: false, error }, { status: 422 })
    : NextResponse.json({ success: true });
}
```

- [ ] **Step 6: 타입 확인**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "sourcing-candidates" || echo "no errors in sourcing-candidates"`
Expected: `no errors in sourcing-candidates`

- [ ] **Step 7: Commit**

```bash
git add src/lib/sourcing-candidates/parse-offer.ts src/app/api/sourcing-candidates/listings src/app/api/sourcing-candidates/offers
git commit -m "feat(sourcing-candidates): 후보 조회·수정, 1688 업체 업로드·판독·채택 라우트"
```

---

### Task 15: 화면

**Files:**
- Create: `src/components/sourcing/candidates/api.ts`, `ScanUploader.tsx`, `ListingTable.tsx`, `CandidateCard.tsx`, `CandidatesWorkspace.tsx`
- Create: `src/app/sourcing/candidates/page.tsx`
- Modify: `src/lib/nav-items.tsx` (브레드크럼 라벨 배열, `/sourcing/trademark-precheck` 줄 아래)

- [ ] **Step 1: API 클라이언트**

```ts
// src/components/sourcing/candidates/api.ts
'use client';

import { readJsonOrThrow } from '@/lib/receipt/http';
import type { ListingView } from '@/lib/sourcing-candidates/view';

type Res<T> = { success: boolean; data?: T; error?: string };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const body = await readJsonOrThrow<Res<T>>(await fetch(input, init));
  if (!body.success) throw new Error(body.error ?? '요청 실패');
  return body.data as T;
}

function form(files: File[], extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  return fd;
}

const json = (data: unknown): RequestInit => ({
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

export interface ScanSummary {
  id: string; category_path: string | null; sort_label: string | null;
  parse_status: string; parse_error: string | null; created_at: string;
  listing_count: number; starred_count: number;
}

export const api = {
  listScans: () => call<ScanSummary[]>('/api/sourcing-candidates/scans'),
  uploadScan: (files: File[]) => call<{ id: string }>('/api/sourcing-candidates/scans', { method: 'POST', body: form(files) }),
  parseScan: (id: string) =>
    call<{ listing_count: number; partial_error: string | null }>(`/api/sourcing-candidates/scans/${id}/parse`, { method: 'POST' }),
  listings: (q: { scan?: string; starred?: boolean }) =>
    call<ListingView[]>(`/api/sourcing-candidates/listings?${q.scan ? `scan=${q.scan}` : 'starred=1'}`),
  patchListing: (id: string, data: Record<string, unknown>) => call<void>(`/api/sourcing-candidates/listings/${id}`, json(data)),
  addOffer: (listingId: string, files: File[], url: string) =>
    call<{ id: string; parse_error: string | null }>(`/api/sourcing-candidates/listings/${listingId}/offers`, {
      method: 'POST', body: form(files, url ? { url } : {}),
    }),
  patchOffer: (id: string, data: Record<string, unknown>) => call<void>(`/api/sourcing-candidates/offers/${id}`, json(data)),
  reparseOffer: (id: string) => call<void>(`/api/sourcing-candidates/offers/${id}/parse`, { method: 'POST' }),
};
```

- [ ] **Step 2: 업로더 (드롭·선택·붙여넣기 공용)**

```tsx
// src/components/sourcing/candidates/ScanUploader.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { prepareCaptures } from '@/lib/sourcing-candidates/prepare-capture';

interface Props {
  label: string;
  hint: string;
  /** 준비된 JPEG 조각을 받아 업로드·판독까지 한다. 반환 문장은 완료 메시지 */
  onFiles: (files: File[]) => Promise<string>;
  /** 페이지 전체 붙여넣기를 받을지 (한 화면에 업로더가 여럿이면 하나만 true) */
  listenPaste?: boolean;
}

/**
 * 캡처 입력. 전체 페이지 캡처는 prepareCaptures가 빈칸을 잘라 조각낸다.
 * 여러 장을 한 번에 올리면 올린 순서가 순위 순서다.
 */
export default function ScanUploader({ label, hint, onFiles, listenPaste = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handle = useCallback(async (input: File[]) => {
    const images = input.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0 || busy) return;
    setBusy(true);
    setMsg({ ok: true, text: '캡처 준비 중…' });
    try {
      const prepared = await prepareCaptures(images);
      if (prepared.overBudget) throw new Error('용량이 커서 한 번에 못 보냅니다. 나눠서 올려 주세요.');
      setMsg({ ok: true, text: `${prepared.files.length}조각 판독 중… (조각당 10~30초)` });
      setMsg({ ok: true, text: await onFiles(prepared.files) });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '실패' });
    } finally {
      setBusy(false);
    }
  }, [busy, onFiles]);

  useEffect(() => {
    if (!listenPaste) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) { e.preventDefault(); void handle(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handle, listenPaste]);

  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); void handle(Array.from(e.dataTransfer.files)); }}
      className={`block cursor-pointer rounded-lg border-2 border-dashed p-4 text-sm ${busy ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
    >
      <input type="file" accept="image/*" multiple className="hidden" disabled={busy}
        onChange={(e) => { void handle(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <div className="font-medium">{label}</div>
      <div className="text-gray-500">{hint}</div>
      {msg && <div className={`mt-2 ${msg.ok ? 'text-gray-700' : 'text-red-600'}`}>{msg.text}</div>}
    </label>
  );
}
```

- [ ] **Step 3: 후보 표**

```tsx
// src/components/sourcing/candidates/ListingTable.tsx
'use client';

import { useState } from 'react';
import type { ListingView } from '@/lib/sourcing-candidates/view';
import type { FilterFlag } from '@/lib/sourcing-candidates/filters';

const FLAG_LABEL: Record<FilterFlag, { text: string; cls: string }> = {
  below_floor: { text: '하한선 미만', cls: 'bg-red-100 text-red-700' },
  official: { text: '공식', cls: 'bg-amber-100 text-amber-800' },
  electric: { text: '인증 확인', cls: 'bg-amber-100 text-amber-800' },
  strong: { text: '리뷰 1만+', cls: 'bg-amber-100 text-amber-800' },
};

const won = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('ko-KR')}원`);

interface Props {
  rows: ListingView[];
  onPatch: (id: string, data: Record<string, unknown>) => Promise<void>;
}

function Row({ r, onPatch }: { r: ListingView; onPatch: Props['onPatch'] }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(r.effective_price));
  return (
    <tr className={`border-t ${r.excluded ? 'text-gray-400' : ''}`}>
      <td className="px-2 py-1 text-right">{r.rank}</td>
      <td className="px-2 py-1">
        <button aria-label="후보로 올리기" onClick={() => onPatch(r.id, { starred: !r.starred })}
          className={r.starred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}>★</button>
      </td>
      <td className="max-w-md px-2 py-1">
        <div className="truncate" title={r.title}>{r.title}</div>
        <div className="text-xs text-gray-500">{r.seller}{r.badges.length ? ` · ${r.badges.join('·')}` : ''}</div>
      </td>
      <td className="px-2 py-1 text-right">
        {editing ? (
          <input autoFocus value={price} onChange={(e) => setPrice(e.target.value)} className="w-24 border px-1 text-right"
            onBlur={async () => {
              setEditing(false);
              const n = Number(price.replace(/[^\d]/g, ''));
              if (n > 0 && n !== r.effective_price) await onPatch(r.id, { price_override: n });
            }} />
        ) : (
          <button onClick={() => setEditing(true)} title="클릭해서 고치기 (쿠팡 판매가로 바꿔 보세요)">
            {won(r.effective_price)}{r.price_override !== null && <span className="text-blue-600">*</span>}
          </button>
        )}
        {r.number_check && <div className="text-xs text-red-600">⚠ {r.number_check}</div>}
      </td>
      <td className="px-2 py-1 text-right">{r.review_count?.toLocaleString('ko-KR') ?? '—'}</td>
      <td className="px-2 py-1 text-right">{r.rating ?? '—'}</td>
      <td className="px-2 py-1">
        <div className="flex flex-wrap gap-1">
          {r.flags.map((f) => <span key={f} className={`rounded px-1 text-xs ${FLAG_LABEL[f].cls}`}>{FLAG_LABEL[f].text}</span>)}
        </div>
      </td>
      <td className="px-2 py-1 text-xs">
        <button className="underline" onClick={() => onPatch(r.id, { excluded_override: !r.excluded })}>
          {r.excluded ? '되살리기' : '제외'}
        </button>
      </td>
    </tr>
  );
}

/** 제외된 줄은 숨기지 않고 접어 둔다 — 거름망이 틀렸을 때 되살릴 수 있어야 한다 */
export default function ListingTable({ rows, onPatch }: Props) {
  const [showExcluded, setShowExcluded] = useState(false);
  const kept = rows.filter((r) => !r.excluded);
  const excluded = rows.filter((r) => r.excluded);
  const head = (
    <thead className="bg-gray-50 text-left text-xs text-gray-500">
      <tr><th className="px-2 py-1 text-right">순위</th><th /><th className="px-2 py-1">상품 · 판매자</th>
        <th className="px-2 py-1 text-right">판매가</th><th className="px-2 py-1 text-right">리뷰</th>
        <th className="px-2 py-1 text-right">별점</th><th className="px-2 py-1">거름망</th><th /></tr>
    </thead>
  );
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">{head}<tbody>{kept.map((r) => <Row key={r.id} r={r} onPatch={onPatch} />)}</tbody></table>
      {excluded.length > 0 && (
        <div>
          <button className="text-sm text-gray-500 underline" onClick={() => setShowExcluded((v) => !v)}>
            자동 제외 {excluded.length}건 {showExcluded ? '접기' : '펼치기'} (하한선 {won(excluded[0].floor)} 미만)
          </button>
          {showExcluded && (
            <table className="mt-1 w-full text-sm">{head}<tbody>{excluded.map((r) => <Row key={r.id} r={r} onPatch={onPatch} />)}</tbody></table>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 후보 카드 (1688 매칭·판정)**

```tsx
// src/components/sourcing/candidates/CandidateCard.tsx
'use client';

import { useState } from 'react';
import ScanUploader from '@/components/sourcing/candidates/ScanUploader';
import { api } from '@/components/sourcing/candidates/api';
import type { ListingView, OfferView } from '@/lib/sourcing-candidates/view';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const VERDICT = { same: '✅ 같음', diff: '⚠️ 차이', different: '❌ 다름' } as const;

function Judgement({ o }: { o: OfferView }) {
  if (!o.lecture || !o.real) return <span className="text-gray-400">원가 없음</span>;
  return (
    <div className="space-y-0.5 text-xs">
      <div>강의: 원가율 {pct(o.lecture.costRatio)} {o.lecture.best ? '🟢 최선' : o.lecture.pass ? '✅' : '❌'} (≤30%)</div>
      <div>실측: 마진 {won(o.real.margin)} · {pct(o.real.marginRate)} {o.real.passRate ? 'ⓐ✅' : 'ⓐ❌'} {o.real.passAmount ? 'ⓑ✅' : 'ⓑ❌'}</div>
      {o.daily !== null && <div className="text-gray-500">일 판매 {o.daily.toFixed(1)}개 (누적÷180, 참고)</div>}
    </div>
  );
}

function OfferRowView({ o, onChanged }: { o: OfferView; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState(o.url ?? '');
  const [cny, setCny] = useState(o.cny_override === null ? '' : String(o.cny_override));
  const save = async (data: Record<string, unknown>) => { await api.patchOffer(o.id, data); await onChanged(); };
  return (
    <tr className={`border-t align-top ${o.adopted ? 'bg-green-50' : ''}`}>
      <td className="px-2 py-1 text-xs">
        {o.parse_status === 'failed' ? (
          <span className="text-red-600">판독 실패: {o.parse_error}{' '}
            <button className="underline" onClick={async () => { await api.reparseOffer(o.id).catch(() => {}); await onChanged(); }}>재시도</button>
          </span>
        ) : (
          <>
            <div>{o.match_verdict ? VERDICT[o.match_verdict] : '—'} {o.match_reason}</div>
            <div className="text-gray-500">{o.title_cn}</div>
          </>
        )}
      </td>
      <td className="px-2 py-1 text-xs">
        {(o.tiers ?? []).map((t) => <div key={t.min_qty}>{t.min_qty}+ {o.sale_unit ?? ''} ¥{t.cny}</div>)}
        {o.tier_check && <div className="text-red-600">⚠ {o.tier_check}</div>}
        <input placeholder="위안 직접" value={cny} onChange={(e) => setCny(e.target.value)}
          onBlur={() => save({ cny_override: cny ? Number(cny) : null })} className="mt-1 w-20 border px-1" />
      </td>
      <td className="px-2 py-1"><Judgement o={o} /></td>
      <td className="px-2 py-1 text-xs">
        <input placeholder="1688 URL" value={url} onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== (o.url ?? '') && save({ url: url || null })} className="w-40 border px-1" />
        <div className="mt-1">
          {o.adopted ? <span className="font-medium text-green-700">채택됨</span>
            : <button className="underline" onClick={() => save({ adopted: true })}>채택</button>}
        </div>
      </td>
    </tr>
  );
}

/** ⭐ 후보 하나. 1688 캡처는 이 카드에 넣는다 — 짝은 사람이 정하고 AI는 같은 물건인지만 본다 */
export default function CandidateCard({ l, onChanged }: { l: ListingView; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState('');
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{l.title}</div>
          <div className="text-xs text-gray-500">
            {l.category_path ?? '카테고리 미상'} · {l.seller} · {l.effective_price.toLocaleString('ko-KR')}원 · 리뷰 {l.review_count?.toLocaleString('ko-KR') ?? '—'}
          </div>
        </div>
        <select value={l.size} onChange={async (e) => { await api.patchListing(l.id, { size: e.target.value }); await onChanged(); }}
          className="border text-xs">
          <option value="xsmall">극소형</option><option value="small">소형</option><option value="medium">중형</option>
        </select>
      </div>

      {l.offers.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-gray-500"><tr>
            <th className="px-2">같은 물건?</th><th className="px-2">구간가</th><th className="px-2">판정</th><th className="px-2" />
          </tr></thead>
          <tbody>{l.offers.map((o) => <OfferRowView key={o.id} o={o} onChanged={onChanged} />)}</tbody>
        </table>
      )}

      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
        <ScanUploader label="1688 캡처 추가 (업체 1곳)" hint="가격·판매량 화면을 한 번에 올리면 한 업체로 묶입니다"
          onFiles={async (files) => {
            const r = await api.addOffer(l.id, files, url);
            setUrl('');
            await onChanged();
            return r.parse_error ? `판독 실패: ${r.parse_error}` : '판독 완료';
          }} />
        <input placeholder="1688 URL (선택)" value={url} onChange={(e) => setUrl(e.target.value)} className="h-9 border px-2 text-sm" />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 작업 화면과 페이지**

```tsx
// src/components/sourcing/candidates/CandidatesWorkspace.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ScanUploader from '@/components/sourcing/candidates/ScanUploader';
import ListingTable from '@/components/sourcing/candidates/ListingTable';
import CandidateCard from '@/components/sourcing/candidates/CandidateCard';
import { api, type ScanSummary } from '@/components/sourcing/candidates/api';
import type { ListingView } from '@/lib/sourcing-candidates/view';

export default function CandidatesWorkspace() {
  const [tab, setTab] = useState<'scan' | 'candidates'>('scan');
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [rows, setRows] = useState<ListingView[]>([]);
  const [starred, setStarred] = useState<ListingView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setScans(await api.listScans());
      if (scanId) setRows(await api.listings({ scan: scanId }));
      setStarred(await api.listings({ starred: true }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    }
  }, [scanId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const current = scans.find((s) => s.id === scanId);
  const adoptedCount = starred.filter((l) => l.adopted).length;

  return (
    <main className="container mx-auto space-y-4 px-4 py-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">소싱 후보 수집</h1>
          <p className="text-sm text-gray-600">네이버 쇼핑 카테고리(판매 많은순) 캡처 → 후보 ⭐ → 1688 매칭 → 20개 제출</p>
        </div>
        <Link href="/sourcing/candidates/print" className="rounded bg-gray-900 px-3 py-2 text-sm text-white">
          제출 목록 ({adoptedCount}/20)
        </Link>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex gap-2 border-b text-sm">
        {(['scan', 'candidates'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 ${tab === t ? 'border-b-2 border-gray-900 font-medium' : 'text-gray-500'}`}>
            {t === 'scan' ? '1. 캡처·후보 표' : `2. 후보 카드 (${starred.length})`}
          </button>
        ))}
      </div>

      {tab === 'scan' && (
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <aside className="space-y-2">
            <ScanUploader listenPaste label="네이버 캡처 올리기"
              hint="전체 페이지 캡처 1장 또는 여러 장 · 끌어놓기·선택·Ctrl+V"
              onFiles={async (files) => {
                const { id } = await api.uploadScan(files);
                setScanId(id);
                const r = await api.parseScan(id);
                await refresh();
                return `상품 약 ${r.listing_count}개 인식${r.partial_error ? ` · ${r.partial_error}` : ' — 더 필요하면 스크롤해서 추가 캡처'}`;
              }} />
            <ul className="space-y-1 text-sm">
              {scans.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setScanId(s.id)}
                    className={`w-full rounded px-2 py-1 text-left ${s.id === scanId ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                    <div className="truncate">{s.category_path ?? '(카테고리 미상)'}</div>
                    <div className="text-xs text-gray-500">
                      {s.sort_label ?? '정렬 미상'} · {s.listing_count}개 · ⭐{s.starred_count}
                      {s.parse_status === 'failed' && <span className="text-red-600"> · 실패</span>}
                    </div>
                  </button>
                  {s.parse_status === 'failed' && s.id === scanId && (
                    <button className="px-2 text-xs underline" onClick={async () => {
                      await api.parseScan(s.id).catch((e) => setError(e.message)); await refresh();
                    }}>판독 재시도</button>
                  )}
                </li>
              ))}
            </ul>
          </aside>
          <section>
            {current?.parse_error && <div className="mb-2 text-sm text-amber-700">{current.parse_error}</div>}
            {scanId
              ? <ListingTable rows={rows} onPatch={async (id, data) => { await api.patchListing(id, data); await refresh(); }} />
              : <div className="text-sm text-gray-500">왼쪽에서 캡처를 올리거나 스캔을 고르세요.</div>}
          </section>
        </div>
      )}

      {tab === 'candidates' && (
        <div className="space-y-3">
          {starred.length === 0 && <div className="text-sm text-gray-500">후보 표에서 ★를 눌러 후보를 올리세요.</div>}
          {starred.map((l) => <CandidateCard key={l.id} l={l} onChanged={refresh} />)}
        </div>
      )}
    </main>
  );
}
```

```tsx
// src/app/sourcing/candidates/page.tsx
import CandidatesWorkspace from '@/components/sourcing/candidates/CandidatesWorkspace';

export const metadata = {
  title: '소싱 후보 수집',
  description: '네이버 쇼핑 캡처와 1688 캡처로 소싱 후보 20개를 고릅니다.',
};

export default function SourcingCandidatesPage() {
  return <CandidatesWorkspace />;
}
```

`src/lib/nav-items.tsx`의 `/sourcing/trademark-precheck` 줄 바로 아래에 추가:

```ts
  { test: /^\/sourcing\/candidates\/print$/, label: '소싱 후보 제출 목록' },
  { test: /^\/sourcing\/candidates$/, label: '소싱 후보 수집' },
```

- [ ] **Step 6: 타입·린트 확인**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "sourcing-candidates|sourcing/candidates" || echo ok; npx eslint src/components/sourcing/candidates src/app/sourcing/candidates src/lib/sourcing-candidates`
Expected: `ok`, eslint 오류 0

- [ ] **Step 7: Commit**

```bash
git add src/components/sourcing/candidates src/app/sourcing/candidates/page.tsx src/lib/nav-items.tsx
git commit -m "feat(sourcing-candidates): 캡처·후보 표·후보 카드 화면"
```

---

### Task 16: 제출 목록 (인쇄)

**Files:**
- Create: `src/app/sourcing/candidates/print/page.tsx`, `src/components/sourcing/candidates/SubmissionList.tsx`

- [ ] **Step 1: 구현**

```tsx
// src/components/sourcing/candidates/SubmissionList.tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/components/sourcing/candidates/api';
import type { ListingView } from '@/lib/sourcing-candidates/view';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const VERDICT = { same: '같음', diff: '차이', different: '다름' } as const;

/** 강사 상담에 들고 갈 표. 채택까지 끝난 ⭐ 후보만 싣는다 */
export default function SubmissionList() {
  const [rows, setRows] = useState<ListingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listings({ starred: true })
      .then((all) => setRows(all.filter((l) => l.adopted)))
      .catch((e) => setError(e instanceof Error ? e.message : '불러오기 실패'));
  }, []);

  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!rows) return <div className="p-6">불러오는 중…</div>;

  return (
    <main className="mx-auto max-w-6xl space-y-3 p-6">
      <div className="flex items-end justify-between print:hidden">
        <h1 className="text-xl font-bold">소싱 후보 제출 목록 ({rows.length}개)</h1>
        <button onClick={() => window.print()} className="rounded bg-gray-900 px-3 py-2 text-sm text-white">인쇄</button>
      </div>
      <p className="text-xs text-gray-500">
        강의 공식: 위안×210×1.4 ÷ 판매가 ≤ 30% · 실측 공식: 로켓그로스 물류비 포함, ⓐ마진율 ≥ 30% ⓑ마진 ≥ 물류비×1.5
      </p>
      <table className="w-full border text-xs">
        <thead className="bg-gray-50"><tr>
          {['#', '상품', '카테고리', '판매가', '리뷰', '1688', '위안', '강의 원가율', '실측 마진', '같은 물건', '메모'].map((h) =>
            <th key={h} className="border px-1 py-1 text-left">{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((l, i) => {
            const o = l.adopted!;
            return (
              <tr key={l.id}>
                <td className="border px-1">{i + 1}</td>
                <td className="border px-1">{l.title}<div className="text-gray-500">{l.seller}</div></td>
                <td className="border px-1">{l.category_path ?? '—'}</td>
                <td className="border px-1 text-right">{won(l.effective_price)}</td>
                <td className="border px-1 text-right">{l.review_count?.toLocaleString('ko-KR') ?? '—'}</td>
                <td className="border px-1">{o.url ? <a href={o.url} className="underline">링크</a> : '링크 없음'}</td>
                <td className="border px-1 text-right">{o.cny === null ? '—' : `¥${o.cny}`}</td>
                <td className="border px-1">{o.lecture ? `${pct(o.lecture.costRatio)} ${o.lecture.pass ? '통과' : '탈락'}` : '—'}</td>
                <td className="border px-1">{o.real ? `${won(o.real.margin)} · ${pct(o.real.marginRate)} ${o.real.pass ? '통과' : '탈락'}` : '—'}</td>
                <td className="border px-1">{o.match_verdict ? VERDICT[o.match_verdict] : '—'}</td>
                <td className="border px-1">{l.memo ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
```

```tsx
// src/app/sourcing/candidates/print/page.tsx
import SubmissionList from '@/components/sourcing/candidates/SubmissionList';

export const metadata = { title: '소싱 후보 제출 목록' };

export default function SourcingCandidatesPrintPage() {
  return <SubmissionList />;
}
```

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "sourcing/candidates" || echo ok`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/components/sourcing/candidates/SubmissionList.tsx src/app/sourcing/candidates/print
git commit -m "feat(sourcing-candidates): 제출 목록 인쇄 화면"
```

---

### Task 17: 전체 테스트·수동 E2E

- [ ] **Step 1: 단위 테스트 전체**

Run: `npx vitest run src/lib/sourcing-candidates src/lib/sourcing src/lib/receipt`
Expected: 전부 PASS

- [ ] **Step 2: 빌드**

Run: `npm run build:local 2>&1 | tail -15`
Expected: 빌드 성공, `/sourcing/candidates`·`/sourcing/candidates/print` 라우트 표시

- [ ] **Step 3: 개발 서버로 수동 E2E (정답지 2장)**

`npm run dev` 후 로그인 → `/sourcing/candidates`.

| 입력 | 확인할 것 |
|---|---|
| `/Volumes/Mac_SSD/다운로드/search.shopping.naver.com-ns-category-10000450.png` (찜질, 16384px) | 조각 2장으로 올라간다 · 카테고리 「건강/의료용품 > 냉온/찜질용품」·정렬 「판매 많은순」 · 1위 밸런스어스 35,900원 · 들꽃잠 행복 눈 찜질팩 핑크 1건만 · 넥스케어 6,900원·황토팩 5,900원은 「자동 제외」로 접힘 |
| `/Volumes/Mac_SSD/다운로드/search.shopping.naver.com-ns-category-10000357.png` (도마, 6755px) | 조각 4장 · 1위 테르헨 국산 스텐도마 41,300원 · 상단 추천 블록 상품(맞춤 추천·만원 장보기·슈퍼신상) 없음 · 약 55개 |
| `/Volumes/Mac_SSD/소싱/스크린샷 2026-09-27 오후 6.48.41.png` ~ `6.49.15.png` 5장 한 번에 | 찜질 스캔과 같은 상위 상품, 중복 없이 |
| 찜질 스캔에서 「엑셀런즈 아이싱 젤 슬리브」 ⭐ → 1688 캡처 1장 | 구간가·판매량 판독 · 같은 물건 판정 · 채택 시 두 공식 판정 표시 |
| 제출 목록 | 채택 후보 1줄, 인쇄 미리보기 정상 |

판독 결과가 정답지와 다르면 **프롬프트(Task 12)를 고치고** 이 표를 다시 돈다. 결과(조각 수·인식 상품 수·걸린 시간·오독)를 PR 본문에 기록한다.

- [ ] **Step 4: Commit (프롬프트 수정이 있었다면)**

```bash
git add -A src/lib/sourcing-candidates
git commit -m "fix(sourcing-candidates): 수동 E2E 반영 — 판독 프롬프트 보정"
```

---

### Task 18: PR

- [ ] **Step 1: 푸시·PR** (사용자 확인 후)

```bash
git push -u origin feat/sourcing-candidates
gh pr create --title "feat: 소싱 후보 수집기 (/sourcing/candidates)" --body "$(cat <<'EOF'
## 요약
- 네이버 쇼핑 카테고리 캡처(전체 페이지 1장 또는 여러 장) → Claude 판독 → 후보 표·자동 거름망
- ⭐ 후보에 1688 캡처 → 구간가·판매량 판독 + 같은 물건 판정 → 채택 → 강의/실측 두 공식 판정
- 제출 목록 인쇄 (`/sourcing/candidates/print`)

## 마이그레이션
- `supabase/migrations/120_sourcing_candidates.sql` — SQL Editor 수동 적용 완료

## 수동 E2E
(Task 17 표 결과)

spec: docs/superpowers/specs/2026-09-27-sourcing-candidates-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

배포는 머지 후 기존 절차를 따른다(자동 모드에서 `vercel deploy --prod`는 사용자가 직접 실행).
