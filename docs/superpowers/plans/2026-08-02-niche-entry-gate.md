# 니치 발굴 진입 게이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 니치 발굴이 판매 불가 상품을 최상위로 올리는 것을 멈추고, 진입 가능한 후보만 점수를 받게 한다.

**Architecture:** 스코어링 앞에 진입 게이트를 세워 규제·물류·검색의도로 거른다. 게이트를 통과한 것만 점수를 매기되, 막힌 것도 사유와 함께 저장해 같은 키워드를 다시 뽑지 않게 한다. 점수 산식에서 "대형·고가일수록 고점"인 부분을 걷어낸다.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Postgres(Render, `SOURCING_DATABASE_URL`)

---

## 배경

`niche_keywords`에 3개월간 **438건**이 쌓였는데 **전량이 진입 불가**다. 진입 조건(중앙가 1만~8만, 업소용·산업용 제외)을 걸면 30건이 남고, 그 30건을 육안 확인하면 **0건**이 남는다 — 좌훈기·족욕기·팝콘기계 전부 전기용품 KC 대상이다.

원인은 점수 산식이다. **진입 불가 탐지기를 정확히 만들어놓고 그것을 가점으로 쓰고 있다.**

```
① 로켓배송 비진출 추정 (최대 30점)  ← 7개 지표 중 최대 배점
   A) scoreByAvgPrice        3만원 미만 0점 · 300만원 이상 12점
   B) scoreByKeywordSignal   업소용·대형·산업용·설비 → 8점
   C) scoreByCategorySignal  대형가전·가구·에어컨·보일러 → 6점
```

로켓이 안 들어간 이유가 대형·전기·고가라서인데, **우리도 같은 이유로 못 들어간다.** 기회 신호로 읽은 것이 실은 진입 장벽이었다.

`src/lib/sourcing/legal/` 6개 레이어는 도매꾹 45만 건에 적용돼 18%를 차단하고 있다. **자산은 있는데 니치 파이프라인이 호출하지 않는다.** 시드 생성(`trend-discovery.ts`)에서도 같은 결함이 있었고 2026-08-01에 고쳤다 — 이번은 그 문제의 438건 규모 실증이다.

**근거:** 위키 `20-wiki/outputs/니치 발굴 DB 진입 불가 진단 2026-08-01.md`

### 확정된 정책

| 결정 | 내용 |
|---|---|
| 막힌 키워드 | **삭제하지 않고 사유와 함께 보존** — 지우면 같은 키워드를 다시 뽑는다 |
| 대형·부피 시그널 | 점수에서 걷어내고 **게이트로 이동** — 점수 문제가 아니라 자격 문제다 |
| 판매가 점수 | 진입 가능 구간(1만~8만) 중심으로 재설계 |
| 정보 검색어 | 게이트에서 배제 (`수리`·`청소방법`·`as`·`만들기`) |

---

## File Structure

**신규**

| 경로 | 책임 |
|---|---|
| `src/lib/niche/entry-gate.ts` | 진입 가능 판정. `legal/` 재사용 + 니치 특화 규칙 |
| `src/__tests__/lib/niche/entry-gate.test.ts` | 실측 438건 표본을 픽스처로 |
| `supabase/migrations/100_niche_entry_gate.sql` | 판정 결과 컬럼 |

**수정**

| 경로 | 변경 |
|---|---|
| `src/lib/niche/scoring.ts` | 대형·부피 가점 제거, 판매가 곡선 재설계 |
| `src/types/niche.ts` | `NicheScoreInput`·`breakdown` 정리 |
| `src/app/api/niche/cron/route.ts` | 스코어링 앞에 게이트 배선 |

---

## Task 1: 진입 게이트 모듈

**Files:**
- Create: `src/lib/niche/entry-gate.ts`
- Test: `src/__tests__/lib/niche/entry-gate.test.ts`

- [ ] **Step 1: 실패 테스트**

픽스처는 실측 438건에서 뽑은 것이다. 지어내지 말 것.

```typescript
import { describe, it, expect } from 'vitest';
import { checkNicheEntry } from '@/lib/niche/entry-gate';

/** 실측 S등급 10건 — 전부 업소용 설비다 (2026-08-01 진단) */
const BLOCKED_S_GRADE: [string, number][] = [
  ['업소용 육절기 수리', 250800],
  ['업소용 오븐기 닭', 615950],
  ['산업용 에어컨 as방법', 485500],
  ['업소용냉각기 청소방법', 89070],
  ['업소용 파티션 의자', 92550],
  ['업소용 냉각수조', 250800],
  ['업소용 쇼케이스 손잡이', 163000],
  ['업소용 오븐파스타', 101300],
];

/** 필터 통과 30건 중 육안 확인에서 탈락한 것들 */
const BLOCKED_AFTER_PRICE: [string, number][] = [
  ['좌훈기 효과', 45000],        // 전기용품 KC
  ['족욕기 추천', 38000],        // 전기용품 KC
  ['팝콘기계 가격', 55000],      // 전기용품 KC
  ['요구르트제조기', 42000],     // 전기용품 KC
  ['피자화덕 만들기', 70000],    // 중량물 + 제작 의도
];

/** 통과해야 하는 것 — 사장의 우선 카테고리 */
const PASS: [string, number][] = [
  ['등산 스틱', 35000],
  ['낚시 받침대', 42000],
  ['방한 넥워머', 15000],
  ['반려견 리드줄', 22000],
  ['캠핑 수납 가방', 38000],
  ['골프 얼음 주머니', 27000],
  ['차량용 정리함', 19000],
];

describe('checkNicheEntry — 실측 차단 사례', () => {
  it.each(BLOCKED_S_GRADE)('%s (%i원) 은 막힌다', (keyword, price) => {
    const r = checkNicheEntry({ keyword, medianPrice: price });
    expect(r.passed).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it.each(BLOCKED_AFTER_PRICE)('%s (%i원) 은 가격대는 맞아도 막힌다', (keyword, price) => {
    const r = checkNicheEntry({ keyword, medianPrice: price });
    expect(r.passed).toBe(false);
  });

  it('S등급 10건이 전량 막힌다 — 진단과 같은 결론', () => {
    const blocked = BLOCKED_S_GRADE.filter(
      ([k, p]) => !checkNicheEntry({ keyword: k, medianPrice: p }).passed,
    );
    expect(blocked).toHaveLength(BLOCKED_S_GRADE.length);
  });
});

describe('checkNicheEntry — 통과 (과차단 회귀 방지)', () => {
  it.each(PASS)('%s (%i원) 은 통과한다', (keyword, price) => {
    const r = checkNicheEntry({ keyword, medianPrice: price });
    expect(r.passed).toBe(true);
    expect(r.reasons).toEqual([]);
  });
});

describe('checkNicheEntry — 가격대', () => {
  it('1만원 미만은 막는다 — MIN_SELL_PRICE_KRW 하한', () => {
    expect(checkNicheEntry({ keyword: '방한 넥워머', medianPrice: 8000 }).passed).toBe(false);
  });

  it('8만원 초과는 막는다 — 로켓그로스 물류·자금 회전 제약', () => {
    expect(checkNicheEntry({ keyword: '방한 넥워머', medianPrice: 120000 }).passed).toBe(false);
  });

  it('경계값은 통과한다', () => {
    expect(checkNicheEntry({ keyword: '방한 넥워머', medianPrice: 10000 }).passed).toBe(true);
    expect(checkNicheEntry({ keyword: '방한 넥워머', medianPrice: 80000 }).passed).toBe(true);
  });
});

describe('checkNicheEntry — 정보 검색어', () => {
  it.each(['에어컨 수리', '보일러 청소방법', '냉장고 as', '평상 만들기', '세탁기 고장'])(
    '%s 는 상품 검색어가 아니다',
    (keyword) => {
      expect(checkNicheEntry({ keyword, medianPrice: 50000 }).passed).toBe(false);
    },
  );

  it('상품명에 포함된 유사어는 막지 않는다', () => {
    // '수리'가 아니라 '수리취떡', '만들기'가 아니라 '만들기세트'
    expect(checkNicheEntry({ keyword: '캠핑 화로대', medianPrice: 45000 }).passed).toBe(true);
  });
});

describe('checkNicheEntry — 사유', () => {
  it('막힌 이유를 사람이 읽을 수 있게 돌려준다', () => {
    const r = checkNicheEntry({ keyword: '업소용 육절기 수리', medianPrice: 250800 });
    expect(r.reasons.join(' ')).toMatch(/업소용|대형|정보|가격/);
  });

  it('여러 사유에 걸리면 전부 돌려준다', () => {
    const r = checkNicheEntry({ keyword: '산업용 에어컨 as방법', medianPrice: 485500 });
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/niche/entry-gate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/niche/entry-gate'`

- [ ] **Step 3: 구현**

`src/lib/niche/entry-gate.ts`:

```typescript
/**
 * 니치 키워드 진입 게이트.
 *
 * 스코어링 앞에 세운다. 점수를 매기기 전에 "애초에 팔 수 있는가"를 묻는다.
 *
 * 왜 필요한가: niche_keywords 438건이 3개월간 쌓였는데 전량이 진입 불가였다.
 * 점수 산식의 최대 배점이 "로켓 미진입"이었고, 로켓이 안 들어간 이유가
 * 대형·전기·고가라서였다. 우리도 같은 이유로 못 들어간다.
 * (위키: 니치 발굴 DB 진입 불가 진단 2026-08-01)
 *
 * legal/ 레이어는 상품명·카테고리를 받아 판정하는데, 니치 키워드는
 * 상품이 아니라 검색어라 그대로 쓸 수 없다. 여기서는 키워드 자체에
 * 적용할 수 있는 규칙만 다루고, 상품 단계 판정은 legal/이 맡는다.
 */

import { MIN_SELL_PRICE_KRW } from '@/lib/sourcing/coupang-price';

export interface NicheEntryInput {
  keyword: string;
  /** 검색 결과 상품의 중앙가 */
  medianPrice: number;
}

export interface NicheEntryResult {
  passed: boolean;
  /** 막힌 사유. 통과하면 빈 배열 */
  reasons: string[];
}

/**
 * 판매가 상한.
 *
 * 8만원인 이유: 로켓그로스 물류비가 사이즈로 정해져 고가품일수록 유리하지만,
 * 사입 자금이 회전에 묶인다. 부업 규모에서 8만원 × 30개면 240만원이 한 품목에
 * 잠긴다. 그리고 실측 438건의 평균 중앙가가 61만원이었던 것이 문제의 핵심이라,
 * 상한이 없으면 게이트가 사실상 작동하지 않는다.
 */
export const MAX_MEDIAN_PRICE_KRW = 80_000;

/**
 * 업소용·산업용 어휘.
 *
 * keyword-signals.ts의 LARGE_SIZE_KEYWORDS와 같은 목록이다. 그쪽은 이것을
 * 8점 가점으로 쓰고 있었고, 여기서는 차단 사유로 쓴다 — 같은 신호를
 * 정반대로 읽고 있었다는 뜻이다.
 */
const COMMERCIAL_TERMS = [
  '업소용', '산업용', '상업용', '공업용', '매장용', '전문가용',
  '설비', '3상', '380V', '대용량', '대형',
] as const;

/**
 * 상품이 아니라 정보를 찾는 검색어.
 *
 * 셀러가 팔 수 있는 것은 상품이지 수리 서비스가 아니다. 경쟁이 낮게
 * 측정된 이유의 일부가 여기 있다 — 애초에 상품 시장이 아니다.
 */
const INFO_INTENT_TERMS = [
  '수리', '청소방법', '청소법', 'as', 'a/s', '만들기', '고장',
  '정부지원', '보조금', '자격증', '창업', '사용법', '설치방법',
] as const;

function hasTerm(haystack: string, terms: readonly string[]): string | null {
  const k = haystack.toLowerCase().replace(/\s+/g, '');
  for (const t of terms) {
    if (k.includes(t.toLowerCase().replace(/\s+/g, ''))) return t;
  }
  return null;
}

export function checkNicheEntry(input: NicheEntryInput): NicheEntryResult {
  const reasons: string[] = [];

  const commercial = hasTerm(input.keyword, COMMERCIAL_TERMS);
  if (commercial) {
    reasons.push(`업소용·대형 계열 (${commercial}) — 로켓그로스 입고 불가 또는 KC 인증 대상`);
  }

  const info = hasTerm(input.keyword, INFO_INTENT_TERMS);
  if (info) {
    reasons.push(`정보 검색어 (${info}) — 상품 수요가 아니다`);
  }

  if (input.medianPrice < MIN_SELL_PRICE_KRW) {
    reasons.push(`중앙가 ${input.medianPrice.toLocaleString()}원 — ${MIN_SELL_PRICE_KRW.toLocaleString()}원 하한 미만`);
  } else if (input.medianPrice > MAX_MEDIAN_PRICE_KRW) {
    reasons.push(`중앙가 ${input.medianPrice.toLocaleString()}원 — ${MAX_MEDIAN_PRICE_KRW.toLocaleString()}원 상한 초과`);
  }

  return { passed: reasons.length === 0, reasons };
}
```

**주의:** 위 목록만으로는 좌훈기·족욕기·팝콘기계 같은 전기용품이 안 걸린다. 그 판정은 Task 1의 범위가 아니라 **기존 `legal/kc-check.ts`가 맡는다** — Step 4에서 배선한다. 테스트의 `BLOCKED_AFTER_PRICE`가 통과하지 않으면 Step 4까지 마친 뒤 다시 확인한다.

- [ ] **Step 4: `legal/` 배선**

`checkNicheEntry`에서 `checkKcCertification(keyword, null)`을 호출해 전기용품 키워드를 잡는다. `kc-check.ts`의 `KC_REQUIRED_KEYWORDS`·`KC_WARN_KEYWORDS`가 이미 좌훈기류를 덮는지 확인하고, 빠진 것이 있으면 **`kc-check.ts`에 추가**한다. 니치 모듈에 사본을 만들지 않는다.

- [ ] **Step 5: 통과 확인 + 커밋**

```bash
npx vitest run src/__tests__/lib/niche/entry-gate.test.ts
npx tsc --noEmit
git add src/lib/niche/entry-gate.ts src/__tests__/lib/niche/entry-gate.test.ts
git commit -m "feat(niche): 스코어링 앞에 진입 게이트

niche_keywords 438건이 3개월간 쌓였는데 전량이 진입 불가였다. 점수
산식의 최대 배점이 '로켓 미진입'인데, 로켓이 안 들어간 이유가 대형·
전기·고가라서였다. 우리도 같은 이유로 못 들어간다.

업소용·산업용 어휘는 keyword-signals.ts가 8점 가점으로 쓰던 바로 그
목록이다. 같은 신호를 정반대로 읽고 있었다."
```

---

## Task 2: 점수 산식에서 대형·고가 가점 제거

**Files:**
- Modify: `src/lib/niche/scoring.ts`
- Modify: `src/types/niche.ts`
- Test: `src/__tests__/lib/niche/scoring.test.ts` (기존 확인 후 갱신)

- [ ] **Step 1: 기존 테스트 확인**

`src/__tests__/lib/niche/` 아래 스코어링 테스트가 있는지 먼저 본다. 있으면 **무엇을 지키려던 테스트인지 읽고** 판단한다 — 대형 가점을 검증하는 테스트라면 그 기대 자체가 이제 틀렸다.

- [ ] **Step 2: 판매가 곡선 재설계**

현재는 3만원 미만 0점, 300만원 이상 12점이다. **우리가 팔 수 있는 가격대가 최저점이다.**

```typescript
/**
 * A) 판매가 적합도 (0~12점)
 *
 * 진입 가능 구간에 최고점을 준다. 이전 버전은 "고가일수록 로켓이 물류를
 * 못 처리해 비진출"이라는 논리로 300만원 이상에 만점을 줬는데, 그 가격대는
 * 우리도 진입할 수 없다. 로켓이 못 하는 이유와 우리가 못 하는 이유가 같다.
 *
 * 1만원 하한은 MIN_SELL_PRICE_KRW, 8만원 상한은 MAX_MEDIAN_PRICE_KRW와 같다.
 * 게이트가 이미 구간 밖을 막으므로 이 함수는 구간 안의 우열만 가린다.
 */
function scoreByAvgPrice(avgPrice: number): number {
  if (avgPrice < MIN_SELL_PRICE_KRW) return 0;
  if (avgPrice > MAX_MEDIAN_PRICE_KRW) return 0;
  // 2만~5만이 물류비 대비 마진 확보가 가장 쉬운 구간이다
  if (avgPrice < 20_000) {
    const ratio = (avgPrice - MIN_SELL_PRICE_KRW) / (20_000 - MIN_SELL_PRICE_KRW);
    return Math.round(4 + ratio * 4);   // 4~8
  }
  if (avgPrice <= 50_000) return 12;
  const ratio = (avgPrice - 50_000) / (MAX_MEDIAN_PRICE_KRW - 50_000);
  return Math.round(12 - ratio * 4);    // 12~8
}
```

- [ ] **Step 3: 대형·부피 가점 제거**

`scoreByKeywordSignal`(8점)과 `scoreByCategorySignal`(6점)을 삭제한다. 두 신호는 게이트로 옮겼으므로 점수에 남기면 이중 계상이자 방향이 반대다.

`calcRocketNonEntry`를 다음으로 바꾸고, 항목 이름도 실제 의미에 맞춘다 — 이 항목은 더 이상 "로켓 비진출 추정"이 아니라 **진입 적합도**다.

```typescript
/**
 * ① 진입 적합도 (최대 30점)
 *
 * 이전 이름은 "로켓배송 비진출 추정"이었고, 대형·고가일수록 고점이었다.
 * 로켓이 안 들어간 자리를 기회로 읽었으나 그 자리는 우리도 못 들어간다.
 * 대형·부피 판정은 entry-gate.ts로 옮겼다.
 */
function calcEntryFitness(input: NicheScoreInput): number {
  const a = scoreByAvgPrice(input.avgPrice);              // 0~12
  const d = scoreByOfficialStoreInverse(input.officialStoreBrandRatio); // 0~4
  return Math.min(30, a + d);
}
```

**배점 총합이 30점에서 16점으로 줄어든다.** 나머지 6개 지표의 상대 가중이 올라가는 셈이며, 이는 의도한 결과다 — 진입 가능 여부는 게이트가 판정하므로 점수는 통과분끼리의 우열만 가리면 된다. `total_score`가 100점 만점이라는 제약은 유지하되, 실제 최대치가 86점이 되는 것을 `types/niche.ts` 주석에 남긴다.

- [ ] **Step 4: 검증 + 커밋**

```bash
npx vitest run src/__tests__/lib/niche/
npx tsc --noEmit
```

---

## Task 3: 파이프라인 배선 + 마이그레이션

**Files:**
- Create: `supabase/migrations/100_niche_entry_gate.sql`
- Modify: `src/app/api/niche/cron/route.ts`

- [ ] **Step 1: 마이그레이션**

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 100_niche_entry_gate.sql
-- [Render PostgreSQL] SOURCING_DATABASE_URL 로 접속하는 DB 전용.
--
-- 니치 키워드에 진입 판정 결과를 남긴다.
--
-- 막힌 키워드를 지우지 않는 이유: 지우면 다음 크론이 같은 키워드를 다시
-- 뽑는다. 사유와 함께 남겨야 중복 수집을 막고, 나중에 인증을 취득하거나
-- 정책이 바뀌었을 때 되살릴 수 있다.
--
-- 적용: node scripts/migrate-sourcing.mjs 100
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.niche_keywords
  ADD COLUMN IF NOT EXISTS entry_blocked      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entry_block_reason text,
  ADD COLUMN IF NOT EXISTS entry_checked_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_niche_keywords_entry
  ON public.niche_keywords (entry_blocked, total_score DESC);

COMMENT ON COLUMN public.niche_keywords.entry_blocked IS
  '진입 게이트 차단 여부. true면 점수와 무관하게 후보가 아니다';
COMMENT ON COLUMN public.niche_keywords.entry_block_reason IS
  '차단 사유. 사람이 읽고 오탐을 판단할 수 있어야 한다';
```

**DB에 적용하지 않는다.** 소유자가 직접 실행한다.

- [ ] **Step 2: 크론 배선**

`src/app/api/niche/cron/route.ts`에서 스코어링 **앞에** 게이트를 호출한다.

- 게이트 통과분만 점수를 계산한다
- 막힌 것도 `niche_keywords`에 저장하되 `entry_blocked = true`와 사유를 함께 넣는다
- 점수는 계산하지 않고 `null` 또는 0으로 둔다 — 막힌 키워드에 점수를 매기면 목록 정렬이 다시 오염된다
- 크론 로그에 통과/차단 건수를 남긴다

- [ ] **Step 3: 검증**

```bash
npx tsc --noEmit
npm run build
npx vitest run
```

---

## Task 4: 기존 438건 재판정

**Files:**
- Create: `scripts/reclassify-niche-keywords.mjs`

- [ ] **Step 1: 스크립트**

기존 438건에 게이트를 적용해 `entry_blocked`를 채운다. **점수는 건드리지 않는다** — 이력이다.

실행 전에 건수와 사유 분포를 먼저 출력하고, `--apply` 플래그가 있을 때만 쓴다. 기본은 조회만 한다.

- [ ] **Step 2: 소유자에게 결과 보고**

차단 건수와 사유 분포, 그리고 **통과한 키워드 전량**을 보고한다. 위키 진단은 육안 확인에서 0건이 남는다고 했으므로, 통과분이 나오면 그것이 게이트의 오탐인지 실제 후보인지 사람이 판단해야 한다.

---

## Open Questions

- 게이트를 통과하는 키워드가 0건이면 니치 발굴은 소싱 경로로서 가치가 없다. 그 경우 키워드 생성 프롬프트(`seed-keywords.ts`)부터 다시 설계해야 하며, 이 계획의 범위 밖이다.
- `MAX_MEDIAN_PRICE_KRW = 80,000`은 위키 진단의 "1만~8만" 기준을 그대로 옮긴 값이며 실측 근거가 아니다.
- 정보 검색어 목록에 `as`가 있어 짧은 영문 조합에서 오탐 가능성이 있다. 테스트에 대조군을 두되, 실제 오탐이 나오면 `a/s`·`에이에스`로 좁힌다.

## Changelog
- 2026-08-02 · 최초 작성
