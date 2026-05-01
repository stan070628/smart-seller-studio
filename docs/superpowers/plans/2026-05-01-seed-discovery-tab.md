# 시드 발굴 탭 (Seed Discovery Tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소싱 대시보드에 🌱 시드 발굴 탭을 추가해 카테고리 선택 → 키워드 자동 분석 → 검증 → 30개 확정 → 도매꾹 탭 자동 반영까지 7단계 워크플로우를 제공한다.

**Architecture:** 별도 탭 `SeedDiscoveryTab` 안에 7단계 파이프라인 UI(왼쪽 진행 패널 + 오른쪽 작업 영역)를 두고, 확정 시 기존 `sourcing_items` 테이블에 `seed_keyword/seed_score/seed_session_id` 컬럼을 추가해 저장한다. 도매꾹 탭은 이 컬럼을 기반으로 시드 필터와 정렬을 제공한다.

**Tech Stack:** Next.js App Router, TypeScript, Zustand, Vitest, PostgreSQL(pg), Naver Ad API(`lib/naver-ad.ts`), Naver Shopping autocomplete(`lib/niche/naver-shopping.ts`), KIPRIS(`lib/sourcing/kipris-client.ts`), DomeggookClient(`lib/sourcing/domeggook-client.ts`)

---

## 파일 구조

| 파일 | 역할 | 상태 |
|---|---|---|
| `src/lib/sourcing/seed-scoring.ts` | 시드 점수 계산 순수 함수 | 신규 |
| `src/types/sourcing.ts` | SalesAnalysisItem + SeedSession 타입 | 수정 |
| `src/app/api/sourcing/seed-discover/route.ts` | 분석 파이프라인 API | 신규 |
| `src/app/api/sourcing/seed-discover/confirm/route.ts` | 확정 + DB 저장 API | 신규 |
| `src/store/useSeedDiscoveryStore.ts` | 세션 상태 관리 (Zustand) | 신규 |
| `src/components/sourcing/SeedDiscoveryTab.tsx` | 탭 전체 UI | 신규 |
| `src/components/sourcing/SourcingDashboard.tsx` | 탭 배열에 seed 추가 | 수정 |
| `src/components/sourcing/DomeggookTab.tsx` | 시드 필터·정렬·배지 추가 | 수정 |
| `src/app/api/sourcing/analyze/route.ts` | seed 컬럼 포함 반환 | 수정 |
| `src/__tests__/lib/seed-scoring.test.ts` | 점수 함수 단위 테스트 | 신규 |
| DB migration (Supabase SQL editor) | seed_sessions 테이블 + sourcing_items 컬럼 | 신규 |

---

## Task 1: DB 스키마 변경

**Files:**
- Modify: `sourcing_items` (Supabase SQL editor)
- Create: `seed_sessions` (Supabase SQL editor)

- [ ] **Step 1: sourcing_items 컬럼 3개 추가**

Supabase SQL Editor에서 실행:

```sql
ALTER TABLE sourcing_items
  ADD COLUMN IF NOT EXISTS seed_keyword    TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seed_score      SMALLINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seed_session_id UUID     DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_sourcing_items_seed_score
  ON sourcing_items (seed_score DESC NULLS LAST)
  WHERE seed_score IS NOT NULL;
```

- [ ] **Step 2: seed_sessions 테이블 생성**

```sql
CREATE TABLE IF NOT EXISTS seed_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL,
  categories   TEXT[]      NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'in_progress'
                           CHECK (status IN ('in_progress', 'confirmed')),
  step         SMALLINT    NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 7),
  state_json   JSONB       DEFAULT '{}',
  confirmed_at TIMESTAMPTZ,
  winner_count SMALLINT    NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seed_sessions_user_id
  ON seed_sessions (user_id, created_at DESC);
```

- [ ] **Step 3: 적용 확인**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sourcing_items'
  AND column_name IN ('seed_keyword','seed_score','seed_session_id');
-- 3개 행이 반환돼야 함

SELECT table_name FROM information_schema.tables
WHERE table_name = 'seed_sessions';
-- 1개 행이 반환돼야 함
```

---

## Task 2: TypeScript 타입 추가

**Files:**
- Modify: `src/types/sourcing.ts`

- [ ] **Step 1: SalesAnalysisItem에 seed 필드 추가**

`src/types/sourcing.ts`의 `SalesAnalysisItem` 인터페이스 마지막에 추가 (`scoreCalculatedAt` 아래):

```typescript
  // 시드 발굴 필드 (seed_sessions FK 연결)
  seedKeyword: string | null;
  seedScore: number | null;
  seedSessionId: string | null;
```

- [ ] **Step 2: SeedSession 인터페이스 추가**

`src/types/sourcing.ts` 파일 끝에 추가:

```typescript
export interface SeedSession {
  id: string;
  userId: string;
  categories: string[];
  status: 'in_progress' | 'confirmed';
  step: number;
  stateJson: SeedSessionState;
  confirmedAt: string | null;
  winnerCount: number;
  createdAt: string;
}

export interface SeedSessionState {
  selectedCategories?: string[];
  keywords?: SeedKeyword[];
  currentStep?: number;
}

export interface SeedKeyword {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  topReviewCount: number | null;   // 사용자 직접 입력
  marginRate: number | null;       // 도매꾹 매칭 후 계산
  seedScore: number | null;        // Step 6에서 산출
  seedGrade: 'S' | 'A' | 'B' | 'C' | 'D' | null;
  domItemNo: number | null;        // 도매꾹 매칭된 상품 번호
  domItemTitle: string | null;
  kiprisStatus: 'clear' | 'warning' | 'pending';
  isSelected: boolean;             // Step 7 최종 선택
  isBlocked: boolean;              // 탈락 (리뷰 초과 or 마진 미달)
  blockedReason: string | null;
}
```

- [ ] **Step 3: 타입 에러 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | grep -i "sourcing.ts\|seed" | head -20
```

Expected: 에러 없음

---

## Task 3: 시드 점수 계산 함수 (TDD)

**Files:**
- Create: `src/lib/sourcing/seed-scoring.ts`
- Create: `src/__tests__/lib/seed-scoring.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/lib/seed-scoring.test.ts
import { describe, it, expect } from 'vitest';
import { calcSeedScore, getSeedGrade } from '@/lib/sourcing/seed-scoring';

describe('calcSeedScore', () => {
  it('경쟁 100개 미만 → 30점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBe(30);
  });

  it('경쟁 500개 이상 → 0점', () => {
    const r = calcSeedScore({ competitorCount: 500, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBe(0);
  });

  it('검색량 15000 → 25점 (역U형 피크)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.searchVolumeScore).toBe(25);
  });

  it('검색량 3000 → 12점 (하한)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 3000, topReviewCount: 0, marginRate: 60 });
    expect(r.searchVolumeScore).toBe(12);
  });

  it('리뷰 0개 → 25점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.reviewScore).toBe(25);
  });

  it('리뷰 50개 이상 → 0점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 50, marginRate: 60 });
    expect(r.reviewScore).toBe(0);
  });

  it('마진 30% → 0점 (기준선)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 30 });
    expect(r.marginScore).toBe(0);
  });

  it('마진 60% → 20점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.marginScore).toBe(20);
  });

  it('최고 점수 조건 → S등급 (>=85점)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.total).toBe(100);
    expect(r.grade).toBe('S');
  });
});

describe('getSeedGrade', () => {
  it.each([
    [85, 'S'], [84, 'A'], [70, 'A'], [69, 'B'],
    [55, 'B'], [54, 'C'], [40, 'C'], [39, 'D'],
  ])('점수 %i → %s등급', (score, grade) => {
    expect(getSeedGrade(score)).toBe(grade);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
npx vitest run src/__tests__/lib/seed-scoring.test.ts 2>&1 | tail -5
```

Expected: `Cannot find module '@/lib/sourcing/seed-scoring'`

- [ ] **Step 3: 구현 작성**

```typescript
// src/lib/sourcing/seed-scoring.ts

export interface SeedScoreInput {
  competitorCount: number;
  searchVolume: number;
  topReviewCount: number;
  marginRate: number;
}

export interface SeedScoreResult {
  total: number;
  competitorScore: number;
  searchVolumeScore: number;
  reviewScore: number;
  marginScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
}

export function calcSeedScore(input: SeedScoreInput): SeedScoreResult {
  const competitorScore = calcCompetitorScore(input.competitorCount);
  const searchVolumeScore = calcSearchVolumeScore(input.searchVolume);
  const reviewScore = calcReviewScore(input.topReviewCount);
  const marginScore = calcMarginScore(input.marginRate);
  const total = competitorScore + searchVolumeScore + reviewScore + marginScore;
  return { total, competitorScore, searchVolumeScore, reviewScore, marginScore, grade: getSeedGrade(total) };
}

function calcCompetitorScore(count: number): number {
  if (count < 100) return 30;
  if (count >= 500) return 0;
  return Math.round(30 * (500 - count) / 400);
}

function calcSearchVolumeScore(volume: number): number {
  const PEAK = 15_000, MIN = 3_000, MAX = 30_000, BASE = 12, PEAK_SCORE = 25;
  if (volume <= MIN || volume >= MAX) return BASE;
  if (volume <= PEAK) return Math.round(BASE + (PEAK_SCORE - BASE) * (volume - MIN) / (PEAK - MIN));
  return Math.round(BASE + (PEAK_SCORE - BASE) * (MAX - volume) / (MAX - PEAK));
}

function calcReviewScore(count: number): number {
  if (count <= 0) return 25;
  if (count >= 50) return 0;
  return Math.round(25 * (50 - count) / 50);
}

function calcMarginScore(rate: number): number {
  if (rate <= 30) return 0;
  if (rate >= 60) return 20;
  return Math.round(20 * (rate - 30) / 30);
}

export function getSeedGrade(total: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (total >= 85) return 'S';
  if (total >= 70) return 'A';
  if (total >= 55) return 'B';
  if (total >= 40) return 'C';
  return 'D';
}
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
npx vitest run src/__tests__/lib/seed-scoring.test.ts 2>&1 | tail -5
```

Expected: `Test Files 1 passed` `Tests 13 passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/seed-scoring.ts src/__tests__/lib/seed-scoring.test.ts
git commit -m "feat(sourcing): 시드 점수 계산 순수 함수 + 테스트"
```

---

## Task 4: 분석 파이프라인 API

**Files:**
- Create: `src/app/api/sourcing/seed-discover/route.ts`

이 API는 카테고리 배열을 받아 Gate 0 → 자동완성 → 검색량 → 경쟁상품수 필터링 결과를 반환한다.

- [ ] **Step 1: 카테고리 → 시드 키워드 매핑 상수 정의**

파일 상단에:

```typescript
// src/app/api/sourcing/seed-discover/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { expandKeywords } from '@/lib/naver-ad';
import { NaverShoppingClient } from '@/lib/niche/naver-shopping';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { SeedKeyword } from '@/types/sourcing';

// 카테고리 → 시드 키워드 사전 정의
const CATEGORY_SEEDS: Record<string, string[]> = {
  '생활용품': ['수납함', '정리함', '욕실용품', '방향제', '발매트', '소품정리함'],
  '문구/사무': ['파일홀더', '메모지', '필통', '볼펜', '인덱스탭', '바인더'],
  '반려동물': ['배변패드', '강아지간식', '고양이모래', '급수기', '배변봉투'],
  '차량용품': ['차량방향제', '핸들커버', '차량거치대', '세차용품', '차량쓰레기통'],
  '가구/인테리어': ['선반', '수납장', '쿠션', '데코소품', '벽시계', '방향제'],
};

// Gate 0: KC인증 필수 카테고리 (하드 차단)
const KC_REQUIRED_CATEGORIES = new Set([
  '주방가전', '생활가전', 'TV/음향가전', '디지털기기',
  '유아/아동', '식품', '건강/의료',
]);

// Gate 0: 시즌 한정 키워드
const SEASON_KEYWORDS = ['크리스마스', '산타', '설날', '추석', '할로윈', '핼러윈', '명절'];
```

- [ ] **Step 2: 요청 스키마 + POST 핸들러 작성**

```typescript
const requestSchema = z.object({
  categories: z.array(z.string()).min(1).max(5),
  sessionId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 });
  }

  const { categories, sessionId } = parsed.data;

  try {
    // 1. 카테고리 → 시드 키워드 수집
    const seeds: string[] = categories.flatMap((cat) => CATEGORY_SEEDS[cat] ?? []);
    if (seeds.length === 0) {
      return NextResponse.json({ success: false, error: '매핑된 시드 키워드가 없습니다' }, { status: 400 });
    }

    // 2. Gate 0: KC 차단 카테고리는 시드에서 제거 (단어 수준 필터 - 추후 확장 가능)
    // Gate 0는 카테고리 선택 단계이므로 여기서는 선택된 카테고리만으로 처리

    // 3. 네이버 자동완성 확장
    const naverClient = new NaverShoppingClient();
    const expanded = new Set<string>();
    for (const seed of seeds) {
      const suggestions = await naverClient.getSuggestions(seed).catch(() => [] as string[]);
      suggestions.slice(0, 5).forEach((s) => expanded.add(s));
      expanded.add(seed);
    }

    // 4. 검색량 조회 + 필터 (3,000~30,000)
    const keywordStats = await expandKeywords([...expanded]).catch(() => []);
    const filtered = keywordStats.filter(
      (k) => k.searchVolume !== null && k.searchVolume >= 3_000 && k.searchVolume <= 30_000,
    );

    // 5. 경쟁상품수 조회 + 필터 (<500)
    const results: SeedKeyword[] = [];
    for (const kw of filtered.slice(0, 60)) {
      const search = await naverClient.search(kw.keyword, 1).catch(() => ({ total: 9999 }));
      if (search.total >= 500) continue;
      results.push({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume!,
        competitorCount: search.total,
        topReviewCount: null,
        marginRate: null,
        seedScore: null,
        seedGrade: null,
        domItemNo: null,
        domItemTitle: null,
        kiprisStatus: 'pending',
        isSelected: false,
        isBlocked: false,
        blockedReason: null,
      });
    }

    // 6. 세션 생성 또는 업데이트
    const pool = getSourcingPool();
    let sid = sessionId;
    if (!sid) {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO seed_sessions (user_id, categories, state_json)
         VALUES ($1, $2, $3) RETURNING id`,
        [authResult.userId, categories, JSON.stringify({ keywords: results })],
      );
      sid = row.rows[0].id;
    } else {
      await pool.query(
        `UPDATE seed_sessions SET state_json = $1, step = 2
         WHERE id = $2 AND user_id = $3`,
        [JSON.stringify({ keywords: results }), sid, authResult.userId],
      );
    }

    return NextResponse.json({ success: true, data: { sessionId: sid, keywords: results } });
  } catch (err) {
    console.error('[POST /api/sourcing/seed-discover]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: NaverShoppingClient에 search 메서드 있는지 확인**

```bash
grep -n "search\|getSearch\|total" /Users/seungminlee/projects/smart_seller_studio/src/lib/niche/naver-shopping.ts | head -20
```

`search(query, display)` 메서드가 없으면 `naver-shopping.ts`에 추가:

```typescript
async search(query: string, display = 10): Promise<{ total: number; items: NaverShopItem[] }> {
  const params = new URLSearchParams({
    query,
    display: String(display),
    sort: 'sim',
  });
  const url = `https://openapi.naver.com/v1/search/shop.json?${params}`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID ?? '',
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET ?? '',
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return { total: 9999, items: [] };
  const data = (await res.json()) as NaverShopResponse;
  return { total: data.total ?? 9999, items: data.items ?? [] };
}
```

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/sourcing/seed-discover/route.ts
git commit -m "feat(api): 시드 발굴 분석 파이프라인 API (카테고리→자동완성→검색량→경쟁)"
```

---

## Task 5: 확정 API (confirm)

**Files:**
- Create: `src/app/api/sourcing/seed-discover/confirm/route.ts`

- [ ] **Step 1: 확정 API 작성**

```typescript
// src/app/api/sourcing/seed-discover/confirm/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';

const confirmSchema = z.object({
  sessionId: z.string().uuid(),
  items: z.array(z.object({
    itemNo: z.number().int(),
    keyword: z.string(),
    score: z.number().int().min(0).max(100),
  })).min(1).max(30),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 });
  }

  const { sessionId, items } = parsed.data;
  const pool = getSourcingPool();

  // 세션 소유자 확인
  const sessionRow = await pool.query(
    `SELECT id FROM seed_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  if (sessionRow.rows.length === 0) {
    return NextResponse.json({ success: false, error: '세션을 찾을 수 없습니다' }, { status: 404 });
  }

  try {
    // 1. 도매꾹 상품 정보 수집 (이미 DB에 없는 경우)
    const client = getDomeggookClient();
    let saved = 0;

    for (const item of items) {
      try {
        // 상품 상세 조회 (itemNo → title, category 등)
        const detail = await client.getItemView(item.itemNo).catch(() => null);

        // sourcing_items UPSERT
        const upsertResult = await pool.query<{ id: string }>(
          `INSERT INTO sourcing_items
             (item_no, title, category_name, seed_keyword, seed_score, seed_session_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (item_no) DO UPDATE SET
             seed_keyword    = EXCLUDED.seed_keyword,
             seed_score      = EXCLUDED.seed_score,
             seed_session_id = EXCLUDED.seed_session_id
           RETURNING id`,
          [
            item.itemNo,
            detail?.basis?.title ?? `상품 #${item.itemNo}`,
            detail?.category?.name ?? null,
            item.keyword,
            item.score,
            sessionId,
          ],
        );
        if (upsertResult.rows.length > 0) saved++;
      } catch (e) {
        console.warn(`[confirm] 상품 ${item.itemNo} 저장 실패:`, e);
      }
    }

    // 2. 세션 상태 confirmed로 업데이트
    await pool.query(
      `UPDATE seed_sessions
       SET status = 'confirmed', confirmed_at = now(), step = 7
       WHERE id = $1`,
      [sessionId],
    );

    return NextResponse.json({ success: true, data: { saved, sessionId } });
  } catch (err) {
    console.error('[POST /api/sourcing/seed-discover/confirm]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/sourcing/seed-discover/confirm/route.ts
git commit -m "feat(api): 시드 발굴 확정 API (sourcing_items upsert + seed_sessions 업데이트)"
```

---

## Task 6: Zustand 상태 스토어

**Files:**
- Create: `src/store/useSeedDiscoveryStore.ts`

- [ ] **Step 1: 스토어 작성**

```typescript
// src/store/useSeedDiscoveryStore.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { SeedKeyword, SeedSession } from '@/types/sourcing';
import { calcSeedScore, getSeedGrade } from '@/lib/sourcing/seed-scoring';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface SeedDiscoveryStore {
  // ── 세션 ──────────────────────────────────────────────────────────────────
  sessionId: string | null;
  sessions: Pick<SeedSession, 'id' | 'categories' | 'status' | 'createdAt' | 'winnerCount'>[];
  currentStep: Step;

  // ── 선택된 카테고리 ────────────────────────────────────────────────────────
  selectedCategories: string[];

  // ── 키워드 목록 ────────────────────────────────────────────────────────────
  keywords: SeedKeyword[];

  // ── 로딩 ──────────────────────────────────────────────────────────────────
  isAnalyzing: boolean;
  isConfirming: boolean;
  error: string | null;

  // ── 액션 ──────────────────────────────────────────────────────────────────
  setSelectedCategories: (cats: string[]) => void;
  startAnalysis: () => Promise<void>;
  setTopReviewCount: (keyword: string, count: number) => void;
  setKiprisStatus: (keyword: string, status: SeedKeyword['kiprisStatus']) => void;
  toggleKeywordSelect: (keyword: string) => void;
  calcAllScores: () => void;
  confirmSelection: () => Promise<{ saved: number } | null>;
  loadSessions: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  sessions: [],
  currentStep: 1 as Step,
  selectedCategories: [],
  keywords: [],
  isAnalyzing: false,
  isConfirming: false,
  error: null,
};

export const useSeedDiscoveryStore = create<SeedDiscoveryStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setSelectedCategories: (cats) => set({ selectedCategories: cats }),

      startAnalysis: async () => {
        const { selectedCategories, sessionId } = get();
        if (selectedCategories.length === 0) return;
        set({ isAnalyzing: true, error: null });
        try {
          const res = await fetch('/api/sourcing/seed-discover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: selectedCategories, sessionId }),
          });
          const json = await res.json();
          if (!json.success) throw new Error(json.error);
          set({
            sessionId: json.data.sessionId,
            keywords: json.data.keywords,
            currentStep: 3,
            isAnalyzing: false,
          });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : '분석 실패', isAnalyzing: false });
        }
      },

      setTopReviewCount: (keyword, count) => {
        set((s) => ({
          keywords: s.keywords.map((k) =>
            k.keyword === keyword
              ? { ...k, topReviewCount: count, isBlocked: count >= 50, blockedReason: count >= 50 ? '상위 리뷰 50개 이상' : null }
              : k,
          ),
        }));
      },

      setKiprisStatus: (keyword, status) => {
        set((s) => ({
          keywords: s.keywords.map((k) => k.keyword === keyword ? { ...k, kiprisStatus: status } : k),
        }));
      },

      toggleKeywordSelect: (keyword) => {
        set((s) => ({
          keywords: s.keywords.map((k) => k.keyword === keyword ? { ...k, isSelected: !k.isSelected } : k),
        }));
      },

      calcAllScores: () => {
        set((s) => ({
          keywords: s.keywords.map((k) => {
            if (k.topReviewCount === null || k.marginRate === null || k.isBlocked) return k;
            const result = calcSeedScore({
              competitorCount: k.competitorCount,
              searchVolume: k.searchVolume,
              topReviewCount: k.topReviewCount,
              marginRate: k.marginRate,
            });
            return { ...k, seedScore: result.total, seedGrade: result.grade };
          }),
          currentStep: 6,
        }));
      },

      confirmSelection: async () => {
        const { sessionId, keywords } = get();
        if (!sessionId) return null;
        const selected = keywords.filter((k) => k.isSelected && k.domItemNo && k.seedScore !== null);
        if (selected.length === 0) return null;
        set({ isConfirming: true });
        try {
          const res = await fetch('/api/sourcing/seed-discover/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              items: selected.map((k) => ({
                itemNo: k.domItemNo!,
                keyword: k.keyword,
                score: k.seedScore!,
              })),
            }),
          });
          const json = await res.json();
          if (!json.success) throw new Error(json.error);
          set({ isConfirming: false, currentStep: 7 });
          return { saved: json.data.saved };
        } catch (e) {
          set({ error: e instanceof Error ? e.message : '확정 실패', isConfirming: false });
          return null;
        }
      },

      loadSessions: async () => {
        try {
          const res = await fetch('/api/sourcing/seed-discover/sessions');
          const json = await res.json();
          if (json.success) set({ sessions: json.data });
        } catch { /* 무시 */ }
      },

      loadSession: async (sid) => {
        try {
          const res = await fetch(`/api/sourcing/seed-discover/sessions/${sid}`);
          const json = await res.json();
          if (json.success) {
            set({
              sessionId: sid,
              selectedCategories: json.data.categories,
              keywords: json.data.stateJson.keywords ?? [],
              currentStep: (json.data.step ?? 1) as Step,
            });
          }
        } catch { /* 무시 */ }
      },

      reset: () => set(initialState),
    }),
    { name: 'SeedDiscovery' },
  ),
);
```

- [ ] **Step 2: 세션 목록 API 추가 (loadSessions용)**

```typescript
// src/app/api/sourcing/seed-discover/sessions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const pool = getSourcingPool();
  const rows = await pool.query(
    `SELECT id, categories, status, created_at, winner_count
     FROM seed_sessions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 10`,
    [authResult.userId],
  );
  const data = rows.rows.map((r) => ({
    id: r.id,
    categories: r.categories,
    status: r.status,
    createdAt: r.created_at,
    winnerCount: r.winner_count,
  }));
  return NextResponse.json({ success: true, data });
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/store/useSeedDiscoveryStore.ts src/app/api/sourcing/seed-discover/sessions/route.ts
git commit -m "feat(store): 시드 발굴 Zustand 스토어 + 세션 목록 API"
```

---

## Task 7: SeedDiscoveryTab UI

**Files:**
- Create: `src/components/sourcing/SeedDiscoveryTab.tsx`

- [ ] **Step 1: 기본 구조 (진행 상태 패널 + 라우팅)**

```typescript
// src/components/sourcing/SeedDiscoveryTab.tsx
'use client';

import React, { useEffect } from 'react';
import { useSeedDiscoveryStore } from '@/store/useSeedDiscoveryStore';
import { C as BASE_C } from '@/lib/design-tokens';

const C = { ...BASE_C, seedAccent: '#7c3aed', seedLight: '#ede9fe', seedBorder: '#a78bfa' } as const;

const CATEGORIES = ['생활용품', '문구/사무', '반려동물', '차량용품', '가구/인테리어'] as const;

const STEP_LABELS = [
  { step: 1, label: '카테고리 선택', auto: false },
  { step: 'G0', label: '회피 차단', auto: true },
  { step: 2, label: '검색량·경쟁 분석', auto: true },
  { step: 3, label: '쿠팡 리뷰 입력', auto: false, required: true },
  { step: 4, label: '도매꾹 매칭·마진', auto: true },
  { step: 'G1', label: '마진 30% 필터', auto: true },
  { step: 5, label: 'KIPRIS 상표권', auto: true },
  { step: 6, label: '시드 점수 산출', auto: true },
  { step: 7, label: '30개 확정', auto: false },
] as const;

export default function SeedDiscoveryTab() {
  const {
    currentStep, sessions, sessionId, selectedCategories,
    keywords, isAnalyzing, isConfirming, error,
    setSelectedCategories, startAnalysis, loadSessions,
    confirmSelection, reset,
  } = useSeedDiscoveryStore();

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const pendingReview = keywords.filter((k) => !k.isBlocked && k.topReviewCount === null).length;
  const canProceedFromStep3 = currentStep >= 3 && pendingReview === 0;
  const selectedCount = keywords.filter((k) => k.isSelected).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg }}>
      {/* 헤더 */}
      <div style={{ padding: '12px 20px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>🌱 시드 발굴</div>
          <div style={{ fontSize: 11, color: C.textSub }}>카테고리 선택 → 키워드 자동 분석 → 검증 → 30개 확정 → 도매꾹 탭으로 이동</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={reset} style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, fontSize: 11, cursor: 'pointer', color: C.text }}>초기화</button>
          <button onClick={() => reset()} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: C.seedAccent, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ 새 발굴 세션</button>
        </div>
      </div>

      {/* 세션 이력 */}
      <div style={{ padding: '6px 20px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto' }}>
        <span style={{ fontSize: 10, color: C.textSub, fontWeight: 700, flexShrink: 0 }}>세션:</span>
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => useSeedDiscoveryStore.getState().loadSession(s.id)}
            style={{
              borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: s.id === sessionId ? 700 : 500,
              border: `1px solid ${s.id === sessionId ? C.seedBorder : C.border}`,
              background: s.id === sessionId ? C.seedLight : C.card,
              color: s.id === sessionId ? C.seedAccent : C.textSub,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {s.status === 'confirmed' ? '✅' : '●'} {new Date(s.createdAt).toLocaleDateString('ko')} ({s.categories.join('·')})
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '8px 20px', background: '#fee2e2', color: '#dc2626', fontSize: 11 }}>⚠️ {error}</div>
      )}

      {/* 메인 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1, overflow: 'hidden' }}>

        {/* 왼쪽: 진행 상태 */}
        <div style={{ padding: 14, borderRight: `1px solid ${C.border}`, background: C.card, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, marginBottom: 4 }}>진행 상태</div>
          {STEP_LABELS.map((s) => {
            const stepNum = typeof s.step === 'number' ? s.step : 0;
            const isGate = typeof s.step === 'string';
            const isDone = typeof s.step === 'number' ? currentStep > s.step : currentStep > stepNum;
            const isActive = typeof s.step === 'number' ? currentStep === s.step : false;
            return (
              <div key={String(s.step)} style={{
                borderRadius: 6, padding: '7px 10px',
                background: isDone ? '#f0fdf4' : isActive ? '#fffbeb' : '#f8fafc',
                border: `1px solid ${isDone ? '#bbf7d0' : isActive ? '#f59e0b' : C.border}`,
                borderWidth: isActive ? 2 : 1,
                opacity: !isDone && !isActive && currentStep < stepNum ? 0.5 : 1,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <span>{isDone ? '✅' : isActive ? '▶' : isGate ? '🚫' : '🔒'}</span>
                  <span style={{ color: isDone ? '#16a34a' : isActive ? '#92400e' : isGate ? '#dc2626' : C.textSub }}>
                    {isGate ? s.step + ' ' : ''}{s.label}
                  </span>
                  {s.auto && <span style={{ background: '#dbeafe', color: '#1d4ed8', borderRadius: 3, padding: '0 4px', fontSize: 9 }}>자동</span>}
                  {!s.auto && !isGate && <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '0 4px', fontSize: 9 }}>입력</span>}
                </div>
                {isActive && s.step === 3 && pendingReview > 0 && (
                  <div style={{ fontSize: 9, color: '#f59e0b' }}>{pendingReview}개 미입력 → 다음 단계 잠김</div>
                )}
              </div>
            );
          })}
        </div>

        {/* 오른쪽: 현재 단계 작업 영역 */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {currentStep === 1 && <StepCategorySelect categories={selectedCategories} setCategories={setSelectedCategories} onStart={startAnalysis} isLoading={isAnalyzing} />}
          {currentStep >= 3 && currentStep <= 5 && (
            <StepReviewInput
              keywords={keywords}
              pendingCount={pendingReview}
              canProceed={canProceedFromStep3}
            />
          )}
          {currentStep === 6 && <StepScoreResult keywords={keywords} />}
          {currentStep === 7 && (
            <StepConfirm keywords={keywords} selectedCount={selectedCount} isConfirming={isConfirming} onConfirm={confirmSelection} />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 하위 컴포넌트 4개 작성 (같은 파일 하단)**

```typescript
// ── Step 1: 카테고리 선택 ────────────────────────────────────────────────────
function StepCategorySelect({ categories, setCategories, onStart, isLoading }: {
  categories: string[]; setCategories: (c: string[]) => void;
  onStart: () => void; isLoading: boolean;
}) {
  const toggle = (cat: string) =>
    setCategories(categories.includes(cat) ? categories.filter((c) => c !== cat) : [...categories, cat]);
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10 }}>카테고리 선택 후 시드 발굴 시작</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {CATEGORIES.map((cat) => {
          const on = categories.includes(cat);
          return (
            <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, background: on ? '#fff' : '#f3f4f6', border: `1px solid ${on ? '#3b82f6' : '#e5e7eb'}`, borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: on ? 700 : 500, color: on ? '#1d4ed8' : '#374151' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(cat)} style={{ accentColor: '#1d4ed8' }} />
              {cat}
            </label>
          );
        })}
      </div>
      <button
        onClick={onStart}
        disabled={categories.length === 0 || isLoading}
        style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: categories.length === 0 ? '#e5e7eb' : '#1d4ed8', color: '#fff', fontSize: 12, fontWeight: 700, cursor: categories.length === 0 ? 'not-allowed' : 'pointer' }}
      >
        {isLoading ? '분석 중...' : '▶ 시드 발굴 시작'}
      </button>
    </div>
  );
}

// ── Step 3: 쿠팡 리뷰 입력 ─────────────────────────────────────────────────
function StepReviewInput({ keywords, pendingCount, canProceed }: {
  keywords: SeedKeyword[]; pendingCount: number; canProceed: boolean;
}) {
  const { setTopReviewCount, calcAllScores } = useSeedDiscoveryStore();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ padding: '8px 14px', background: '#fffbeb', borderBottom: '2px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>✏️ 쿠팡에서 상위 리뷰수 직접 확인 후 입력</span>
        {pendingCount > 0 && (
          <span style={{ background: '#fde68a', color: '#92400e', borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{pendingCount}개 미입력</span>
        )}
        <button onClick={() => {
          const urls = keywords.filter((k) => k.topReviewCount === null && !k.isBlocked).map((k) => `https://www.coupang.com/np/search?q=${encodeURIComponent(k.keyword)}`);
          urls.forEach((u) => window.open(u, '_blank'));
        }} style={{ marginLeft: 'auto', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 5, padding: '3px 8px', fontSize: 10, color: '#92400e', cursor: 'pointer' }}>
          미입력 {pendingCount}개 쿠팡 일괄 열기↗
        </button>
      </div>
      {!canProceed && (
        <div style={{ padding: '6px 14px', background: '#fff5f5', borderBottom: '1px solid #fca5a5', fontSize: 10, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
          🔒 미입력 {pendingCount}개 완료 전까지 다음 단계 잠김
        </div>
      )}
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: 10 }}>키워드</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 700, color: '#1d4ed8', fontSize: 10, background: '#f0f7ff' }}>월검색량</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 700, color: '#1d4ed8', fontSize: 10, background: '#f0f7ff' }}>경쟁상품</th>
              <th style={{ padding: '6px 6px', textAlign: 'center', fontWeight: 700, color: '#92400e', fontSize: 10, background: '#fffbeb', borderLeft: '2px solid #f59e0b' }}>쿠팡 상위리뷰<br /><span style={{ fontWeight: 400 }}>✏️ 직접 입력</span></th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((k) => (
              <tr key={k.keyword} style={{ borderBottom: '1px solid #f1f5f9', background: k.isBlocked ? '#fef2f2' : '#fff', opacity: k.isBlocked ? 0.6 : 1 }}>
                <td style={{ padding: '5px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{k.keyword}</div>
                  {k.isBlocked && <div style={{ fontSize: 9, color: '#dc2626' }}>{k.blockedReason}</div>}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: '#059669', fontWeight: 600, background: '#f8fbff' }}>{k.searchVolume.toLocaleString()}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: '#059669', fontWeight: 600, background: '#f8fbff' }}>{k.competitorCount}</td>
                <td style={{ padding: '5px 6px', textAlign: 'center', background: k.isBlocked ? '#fee2e2' : '#fffdf0', borderLeft: '2px solid #f59e0b' }}>
                  {k.isBlocked ? (
                    <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 11 }}>{k.topReviewCount} ❌</span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                      <input type="number" min={0} value={k.topReviewCount ?? ''} onChange={(e) => setTopReviewCount(k.keyword, Number(e.target.value))}
                        placeholder="—" style={{ width: 44, padding: '2px 4px', border: `1px solid ${k.topReviewCount === null ? '#f59e0b' : '#d1d5db'}`, borderRadius: 4, fontSize: 11, textAlign: 'center', background: k.topReviewCount === null ? '#fffbeb' : '#fff' }} />
                      <a href={`https://www.coupang.com/np/search?q=${encodeURIComponent(k.keyword)}`} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8', fontSize: 10 }}>쿠팡↗</a>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '10px 14px', background: '#f9fafb', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={calcAllScores} disabled={!canProceed}
          style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: canProceed ? '#7c3aed' : '#e5e7eb', color: '#fff', fontSize: 11, fontWeight: 700, cursor: canProceed ? 'pointer' : 'not-allowed', opacity: canProceed ? 1 : 0.5 }}>
          {canProceed ? '시드 점수 산출 →' : `🔒 ${pendingCount}개 미입력`}
        </button>
      </div>
    </div>
  );
}

// ── Step 6: 점수 결과 ─────────────────────────────────────────────────────
function StepScoreResult({ keywords }: { keywords: SeedKeyword[] }) {
  const { toggleKeywordSelect } = useSeedDiscoveryStore();
  const sorted = [...keywords].filter((k) => k.seedScore !== null && !k.isBlocked)
    .sort((a, b) => (b.seedScore ?? 0) - (a.seedScore ?? 0));
  const GRADE_COLOR: Record<string, string> = { S: '#7c3aed', A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626' };
  return (
    <div style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10 }}>🎯 시드 점수 산출 완료 — 경쟁(30)+검색량(25)+리뷰(25)+마진(20)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sorted.map((k, i) => (
          <div key={k.keyword} onClick={() => toggleKeywordSelect(k.keyword)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: k.isSelected ? '#f5f0ff' : '#f9fafb', border: `1px solid ${k.isSelected ? '#a78bfa' : '#e2e8f0'}`, cursor: 'pointer' }}>
            <input type="checkbox" checked={k.isSelected} onChange={() => {}} style={{ accentColor: '#7c3aed' }} />
            <span style={{ fontSize: 10, color: '#94a3b8', width: 18 }}>{i + 1}</span>
            <span style={{ fontWeight: 600, flex: 1 }}>{k.keyword}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: GRADE_COLOR[k.seedGrade ?? 'D'], width: 36, textAlign: 'right' }}>{k.seedScore}</span>
            <span style={{ fontSize: 9, fontWeight: 700, background: `${GRADE_COLOR[k.seedGrade ?? 'D']}18`, color: GRADE_COLOR[k.seedGrade ?? 'D'], borderRadius: 3, padding: '1px 5px' }}>{k.seedGrade}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 7: 최종 확정 ─────────────────────────────────────────────────────
function StepConfirm({ keywords, selectedCount, isConfirming, onConfirm }: {
  keywords: SeedKeyword[]; selectedCount: number; isConfirming: boolean; onConfirm: () => Promise<{ saved: number } | null>;
}) {
  return (
    <div style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>최종 {selectedCount}개 확정 후 도매꾹 탭으로 추가</div>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px', fontSize: 10, color: '#92400e', marginBottom: 14, lineHeight: 1.8 }}>
        <strong>다음 단계 →</strong> 위탁 등록 30~50개 → 2주 운영<br />
        위너 확정: 클릭 100+, 전환율 1.5%+, ROAS 250%+, 판매 5건+, 별점 4.0+<br />
        → 위너 5~10개 → 1688 사입 발주 (이 플로우 2~3회 반복 → 총 80~100 SKU)
      </div>
      <button onClick={onConfirm} disabled={selectedCount === 0 || isConfirming}
        style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: selectedCount === 0 ? '#e5e7eb' : '#be0014', color: '#fff', fontSize: 12, fontWeight: 700, cursor: selectedCount === 0 ? 'not-allowed' : 'pointer' }}>
        {isConfirming ? '추가 중...' : `선택 ${selectedCount}개 도매꾹 탭에 추가 →`}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/sourcing/SeedDiscoveryTab.tsx
git commit -m "feat(ui): SeedDiscoveryTab 컴포넌트 — 7단계 워크플로우 UI"
```

---

## Task 8: DomeggookTab 시드 필터·정렬·배지 추가

**Files:**
- Modify: `src/components/sourcing/DomeggookTab.tsx`

- [ ] **Step 1: 시드 필터 상태 변수 추가**

`DomeggookTab.tsx`에서 기존 `const [minScore, setMinScore] = useState...` 아래에 추가:

```typescript
const [seedOnly, setSeedOnly] = useState(false);
const [excludeSeed, setExcludeSeed] = useState(false);
const [minSeedScore, setMinSeedScore] = useState<number | ''>('');
```

- [ ] **Step 2: filteredItems useMemo에 시드 필터 조건 추가**

`filteredItems` useMemo 내부의 기존 `return items.filter(...)` 블록에 조건 추가:

```typescript
// 기존 필터 블록 끝 직전에 추가:
if (seedOnly && item.seedScore == null) return false;
if (excludeSeed && item.seedScore != null) return false;
if (minSeedScore !== '' && (item.seedScore ?? 0) < Number(minSeedScore)) return false;
```

- [ ] **Step 3: 필터 툴바에 시드 필터 UI 추가**

기존 필터 툴바의 구분선 뒤에 추가:

```tsx
{/* 시드 필터 */}
<div style={{ width: '1px', height: '20px', backgroundColor: C.border }} />
<span style={{ fontSize: '10px', color: '#7c3aed', fontWeight: 700 }}>시드</span>
<button
  onClick={() => { setSeedOnly(!seedOnly); if (!seedOnly) setExcludeSeed(false); }}
  style={{
    padding: '3px 9px', borderRadius: 5, fontSize: 11, fontWeight: seedOnly ? 700 : 500,
    border: `1px solid ${seedOnly ? '#7c3aed' : C.border}`,
    background: seedOnly ? '#ede9fe' : C.card, color: seedOnly ? '#7c3aed' : C.text, cursor: 'pointer',
  }}
>
  🌱 시드만
</button>
<button
  onClick={() => { setExcludeSeed(!excludeSeed); if (!excludeSeed) setSeedOnly(false); }}
  style={{
    padding: '3px 9px', borderRadius: 5, fontSize: 11, fontWeight: excludeSeed ? 700 : 500,
    border: `1px solid ${excludeSeed ? '#7c3aed' : C.border}`,
    background: excludeSeed ? '#f5f0ff' : C.card, color: excludeSeed ? '#7c3aed' : C.textSub, cursor: 'pointer',
  }}
>
  시드 제외
</button>
<div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
  <span style={{ fontSize: '10px', color: '#7c3aed', fontWeight: 700 }}>시드점수</span>
  <input
    type="number" min={0} max={100}
    value={minSeedScore}
    onChange={(e) => setMinSeedScore(e.target.value === '' ? '' : Number(e.target.value))}
    placeholder="0"
    style={{ width: 38, padding: '2px 4px', border: `1px solid #a78bfa`, borderRadius: 4, fontSize: 11, textAlign: 'center' }}
  />
  <span style={{ fontSize: '10px', color: '#7c3aed' }}>이상</span>
</div>
```

- [ ] **Step 4: 정렬에 시드점수 추가**

기존 정렬 헤더 목록에 시드점수 컬럼 헤더 추가 (테이블 thead에):

```tsx
{/* 시드점수 컬럼 — seed_score 있는 항목에만 표시 */}
<th
  onClick={() => handleSortClick('seed_score')}
  style={{
    cursor: 'pointer', padding: '6px 6px', fontSize: '10px', fontWeight: 700,
    color: sortField === 'seed_score' ? '#7c3aed' : '#9ca3af',
    textAlign: 'right', whiteSpace: 'nowrap',
  }}
>
  🌱 시드점수{renderSortIcon('seed_score')}
</th>
```

- [ ] **Step 5: 상품 행에 시드 배지 + 구분선 추가**

테이블 tbody 행 스타일에서 `item.seedScore != null`인 경우 조건부 스타일 적용:

```tsx
// tr 스타일에 추가:
borderLeft: item.seedScore != null ? '3px solid #a78bfa' : '3px solid transparent',

// 상품명 td 내부 상품명 div 아래에 추가:
{item.seedKeyword && (
  <span style={{
    display: 'inline-block', background: '#ede9fe', color: '#7c3aed',
    borderRadius: 3, padding: '0px 5px', fontSize: 9, fontWeight: 700, marginTop: 2,
  }}>
    🌱 {item.seedKeyword}
  </span>
)}
```

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/DomeggookTab.tsx
git commit -m "feat(ui): DomeggookTab 시드 필터·정렬·배지 추가"
```

---

## Task 9: SourcingDashboard 탭 추가 + analyze API 수정

**Files:**
- Modify: `src/components/sourcing/SourcingDashboard.tsx`
- Modify: `src/app/api/sourcing/analyze/route.ts`

- [ ] **Step 1: SourcingDashboard에 seed 탭 추가**

`src/components/sourcing/SourcingDashboard.tsx`:

1. 상단 import에 추가:
```typescript
import SeedDiscoveryTab from '@/components/sourcing/SeedDiscoveryTab';
```

2. `sourcingSubTab` 타입에 `'seed'` 추가:
```typescript
const [sourcingSubTab, setSourcingSubTab] = useState<'tracking' | 'calculator' | 'niche' | 'costco' | 'costco-memo' | 'keywords' | 'seed'>('niche');
```

3. 탭 배열에 `니치소싱` 다음 위치에 삽입:
```typescript
{ id: 'niche' as const, label: '니치소싱', icon: <Search size={13} />, badge: <NicheAlertBadge count={unreadAlertCount} /> },
{ id: 'seed' as const, label: '🌱 시드 발굴', icon: null },  // ← 추가
{ id: 'tracking' as const, label: '도매꾹', icon: <RefreshCw size={13} /> },
```

4. 탭 렌더 블록에 추가:
```typescript
{sourcingSubTab === 'seed' && <SeedDiscoveryTab />}
```

- [ ] **Step 2: analyze API에서 seed 컬럼 포함 반환**

`src/app/api/sourcing/analyze/route.ts`에서 SELECT 쿼리의 컬럼 목록에 추가:

```sql
-- 기존 SELECT 컬럼 목록에 추가:
mv.seed_keyword,
mv.seed_score,
mv.seed_session_id,
```

그리고 응답 매핑에 추가:
```typescript
seedKeyword: row.seed_keyword as string | null,
seedScore: row.seed_score as number | null,
seedSessionId: row.seed_session_id as string | null,
```

- [ ] **Step 3: 타입 에러 확인**

```bash
npx tsc --noEmit 2>&1 | grep -i "error" | head -20
```

Expected: 에러 없음 (또는 관련 없는 기존 에러만)

- [ ] **Step 4: 커밋**

```bash
git add src/components/sourcing/SourcingDashboard.tsx src/app/api/sourcing/analyze/route.ts
git commit -m "feat(ui): SourcingDashboard 시드 발굴 탭 추가 + analyze API seed 컬럼 포함"
```

---

## Task 10: 통합 검증

- [ ] **Step 1: 개발 서버 시작**

```bash
npm run dev
```

- [ ] **Step 2: 골든 패스 확인**

1. `/sourcing` 접속 → "🌱 시드 발굴" 탭 클릭 확인
2. 카테고리 "생활용품" + "문구/사무" 선택 → "▶ 시드 발굴 시작" 클릭
3. 진행 상태 패널에서 Step 2 완료 표시 확인
4. 키워드 목록에서 임의 항목에 리뷰수 입력
5. 리뷰수 50 이상 입력 시 자동 탈락 확인
6. 모든 입력 완료 후 "시드 점수 산출" 버튼 활성화 확인
7. 점수 산출 → S/A/B 등급 표시 확인
8. 30개 선택 후 "도매꾹 탭에 추가" 클릭
9. 도매꾹 탭 자동 이동 + 🌱 배지 표시 확인
10. "🌱 시드만" 필터 클릭 → 시드 상품만 표시 확인

- [ ] **Step 3: 전체 테스트 실행**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: 기존 테스트 + seed-scoring 테스트 모두 PASS

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: 시드 발굴 탭 전체 구현 완료"
```

---

## Self-Review

**스펙 커버리지 체크:**

| 스펙 요구사항 | 구현 Task |
|---|---|
| 탭 재구성 (7개) | Task 9 |
| Gate 0 회피 차단 | Task 4 (API) |
| 네이버 자동완성 | Task 4 |
| 검색량·경쟁 필터 | Task 4 |
| 쿠팡 리뷰 입력 (스킵불가) | Task 7 |
| 도매꾹 매칭 + 마진 | Task 5 (confirm 시 getItemView 호출) |
| Gate 1 마진 30% 탈락 | Task 7 (setTopReviewCount가 아닌 — 확인: Task 4에서 marginRate 30% 미달 시 isBlocked=true 설정 필요) |
| KIPRIS 검사 | Task 7 (setKiprisStatus 제공, 실제 KIPRIS 호출은 Task 4 확장 필요) |
| 시드 점수 (경쟁30+검색25+리뷰25+마진20) | Task 3, Task 6(store) |
| 30개 확정 | Task 7, Task 5 |
| 세션 히스토리 + 임시저장 | Task 6 (store), Task 4 (state_json) |
| DB 스키마 | Task 1 |
| 도매꾹 탭 시드 필터·정렬·배지 | Task 8 |
| analyze API seed 컬럼 | Task 9 |

**발견된 갭:**

1. **Gate 1 마진 탈락**: Task 4 API 응답에 `marginRate`를 포함하지 않아 클라이언트에서 마진 기반 차단이 동작하지 않는다. Task 4 Step 2에 도매꾹 매칭 후 `marginRate` 계산 및 `isBlocked` 설정 로직을 추가해야 한다. (현재는 Step 4 도매꾹 매칭과 분리되어 있어 `confirm` 시에만 처리됨 — 스토어의 `setTopReviewCount`가 리뷰만 처리하듯 `setMarginRate` 액션도 필요)

2. **도매꾹 매칭 단계 (Step 4)**:현재 `confirm` API에서 `getItemView`를 호출하지만, UI에서 Step 4 진행 상태를 보여주는 별도 API 호출이 없다. Task 7의 `StepScoreResult`가 `domItemNo`를 기반으로 하므로, `startAnalysis` 이후 도매꾹 매칭을 완료하는 별도 스토어 액션 `fetchDomeggookMatch`가 필요하다.

3. **KIPRIS 실제 호출**: 스토어에 `setKiprisStatus`는 있지만 자동 호출 트리거가 없다. 간단하게 Step 2 완료 후 백그라운드로 각 키워드에 대해 KIPRIS API를 호출하는 훅을 Task 7에 추가해야 한다.

> **구현 시 위 3개 갭을 Task 4와 Task 7에서 처리하되, 순서는 플랜 순서를 따르면 된다.**
