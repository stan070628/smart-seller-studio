# 딥 키워드 엔진 Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `DeepKeywordEngine.tsx`의 빈 skeleton에 Naver 자동완성 + DataLab API를 연결하여, 대표 키워드에서 공략 가능한 하위 키워드 목록과 계절 점수를 실제로 보여주는 기능을 완성한다.

**Architecture:** 자동완성 API로 하위 키워드를 발굴하고, DataLab API로 각 키워드의 14개월 월별 검색량 인덱스를 조회한다. DataLab 응답은 Supabase DB에 24시간 TTL로 캐싱하여 rate limit을 방지한다. 계절 점수는 "작년 동기+2개월 대비 현재 검색량 × 성장률 × 50" 공식으로 산출하며, 경쟁 강도는 네이버 쇼핑 검색 결과 수로 계산한다.

**Tech Stack:** Next.js 15 API Routes, TypeScript, node-postgres (pg), Naver DataLab API (`openapi.naver.com/v1/datalab/search`), Naver Autocomplete API (`ac.search.naver.com/nx/ac`, 인증 불필요), Vitest

---

## File Map

| Action | Path | Role |
|--------|------|------|
| **Create** | `supabase/migrations/075_keyword_cache.sql` | `keyword_trend_cache` 테이블 DDL |
| **Create** | `src/lib/sourcing/deep-keyword.ts` | 비즈니스 로직: 자동완성 + DataLab + 캐싱 + 점수 계산 |
| **Create** | `src/lib/sourcing/__tests__/deep-keyword.test.ts` | `calcSeasonalScore` 단위 테스트 |
| **Create** | `src/app/api/sourcing/deep-keyword/route.ts` | POST API route: 입력 검증 → 로직 호출 → 반환 |
| **Modify** | `src/components/sourcing/DeepKeywordEngine.tsx` | UI 완성: 검색 활성화 + 결과 테이블 + 로딩/에러 상태 |

---

## Task 1: DB Migration — `keyword_trend_cache` 테이블

**Files:**
- Create: `supabase/migrations/075_keyword_cache.sql`

기존 마이그레이션 번호: `074_product_ad_spend.sql` → 다음은 `075`.

- [ ] **Step 1: migration 파일 생성**

파일 경로: `supabase/migrations/075_keyword_cache.sql`

```sql
-- 딥 키워드 엔진 DataLab API 응답 캐시
-- TTL 24시간 — 코드 레벨에서 체크 (fetched_at 기준)

CREATE TABLE IF NOT EXISTS public.keyword_trend_cache (
  keyword    TEXT        NOT NULL,
  data       JSONB       NOT NULL,        -- MonthlyRatio[] 직렬화
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (keyword)
);

COMMENT ON TABLE  public.keyword_trend_cache IS 'Naver DataLab 월별 ratio 캐시 (TTL 24h)';
COMMENT ON COLUMN public.keyword_trend_cache.data IS 'MonthlyRatio[]: [{period: "YYYY-MM-DD", ratio: number}]';
```

- [ ] **Step 2: migration 적용**

Supabase MCP로 적용:
```
mcp__plugin_supabase_supabase__apply_migration 으로 위 SQL 실행
```

또는 로컬 psql로 직접 실행 (SOURCING_DATABASE_URL 환경변수 사용):
```bash
psql "$SOURCING_DATABASE_URL" -f supabase/migrations/075_keyword_cache.sql
```

Expected: `CREATE TABLE`

- [ ] **Step 3: 테이블 확인**

```bash
psql "$SOURCING_DATABASE_URL" -c "\d public.keyword_trend_cache"
```

Expected: keyword, data, fetched_at 컬럼 3개 확인

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/075_keyword_cache.sql
git commit -m "feat(db): keyword_trend_cache 테이블 추가 (DataLab 캐시 TTL 24h)"
```

---

## Task 2: `deep-keyword.ts` 로직 유틸 + 단위 테스트

**Files:**
- Create: `src/lib/sourcing/deep-keyword.ts`
- Create: `src/lib/sourcing/__tests__/deep-keyword.test.ts`

### 전제 지식

**Naver DataLab API (`/v1/datalab/search`):**
- POST `https://openapi.naver.com/v1/datalab/search`
- 헤더: `X-Naver-Client-Id`, `X-Naver-Client-Secret` (기존 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 환경변수 사용)
- 요청: `{startDate, endDate, timeUnit: 'month', keywordGroups: [{groupName, keywords}]}`
- 응답: `{results: [{title, data: [{period: 'YYYY-MM-DD', ratio: number}]}]}`
- 1회 최대 5개 keywordGroups

**기존 코드 재활용:**
- `getNaverShoppingClient()` from `@/lib/niche/naver-shopping` → `.getSuggestions(query)` 메서드로 자동완성 호출
- `getSourcingPool()` from `@/lib/sourcing/db` → PostgreSQL 캐시 접근

### Step 1: 단위 테스트 파일 생성 (먼저 — TDD)

파일 경로: `src/lib/sourcing/__tests__/deep-keyword.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { calcSeasonalScore } from '../deep-keyword';
import type { MonthlyRatio } from '../deep-keyword';

function makeMonthly(ratios: number[]): MonthlyRatio[] {
  return ratios.map((ratio, i) => ({
    period: `2024-${String(i + 1).padStart(2, '0')}-01`,
    ratio,
  }));
}

describe('calcSeasonalScore', () => {
  it('데이터가 3개 이하이면 seasonalScore=0 반환', () => {
    expect(calcSeasonalScore(makeMonthly([50, 60, 70])).seasonalScore).toBe(0);
  });

  it('currentIndex가 0이면 seasonalScore=0 반환', () => {
    const monthly = makeMonthly([70, 70, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0]);
    expect(calcSeasonalScore(monthly).seasonalScore).toBe(0);
  });

  it('작년 동기가 현재보다 높고 성장세이면 점수 > 50', () => {
    // 14개월: [70, 70] = 작년 동기+2개월, [...50×10], [60, 70] = 현재
    const monthly = makeMonthly([70, 70, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 60, 70]);
    const { seasonalScore, growthRate } = calcSeasonalScore(monthly);
    expect(seasonalScore).toBeGreaterThan(50);
    expect(growthRate).toBeGreaterThan(1);
  });

  it('계절 점수는 100을 초과하지 않는다', () => {
    // 극단적: 작년=100, 현재=1 → cap
    const monthly = makeMonthly([100, 100, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(calcSeasonalScore(monthly).seasonalScore).toBeLessThanOrEqual(100);
  });

  it('4개월 이상 데이터 있으면 growthRate 계산됨', () => {
    const monthly = makeMonthly([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 60, 70]);
    const { growthRate } = calcSeasonalScore(monthly);
    expect(typeof growthRate).toBe('number');
    expect(growthRate).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/lib/sourcing/__tests__/deep-keyword.test.ts 2>&1 | tail -20
```

Expected: `Cannot find module '../deep-keyword'` 또는 FAIL (파일 없음)

- [ ] **Step 3: `deep-keyword.ts` 구현**

파일 경로: `src/lib/sourcing/deep-keyword.ts`

```typescript
import { getSourcingPool } from '@/lib/sourcing/db';
import { getNaverShoppingClient } from '@/lib/niche/naver-shopping';

// ─── 공개 타입 ────────────────────────────────────────────────────────────────

export interface MonthlyRatio {
  period: string;   // 'YYYY-MM-DD'
  ratio: number;    // 0~100 (DataLab 상대 검색량 인덱스)
}

export interface DeepKeywordItem {
  keyword: string;
  parentKeyword: string | null;  // root이면 null, 하위이면 root 키워드
  monthly: MonthlyRatio[];
  avgRatio: number;              // 최근 2개월 평균 (0~100)
  seasonalScore: number;         // 0~100
  growthRate: number;            // 성장률 (1.0 = 변화없음, >1 = 상승)
  competitionCount: number;      // 네이버쇼핑 검색 결과 수
}

export interface DeepKeywordResult {
  rootKeyword: string;
  items: DeepKeywordItem[];
  fetchedAt: string;  // ISO string
}

// ─── 순수 함수: 계절 점수 계산 ────────────────────────────────────────────────

/**
 * 14개월 월별 ratio 배열에서 계절 점수·성장률·현재 평균을 계산한다.
 *
 * 계절 점수 공식:
 *   last_year_index = months[0..1] avg  (14-13개월 전 = 작년 동기+2개월)
 *   current_index   = months[-2..] avg  (최근 2개월)
 *   prev_index      = months[-4..-2] avg (3-4개월 전)
 *   growthRate      = current_index / prev_index
 *   seasonalScore   = min(100, round((lastYear / current) × growthRate × 50))
 */
export function calcSeasonalScore(monthly: MonthlyRatio[]): {
  seasonalScore: number;
  growthRate: number;
  avgRatio: number;
} {
  if (monthly.length < 4) return { seasonalScore: 0, growthRate: 1, avgRatio: 0 };

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  const currentIndex = avg(monthly.slice(-2).map((d) => d.ratio));
  const lastYearIndex = avg(monthly.slice(0, 2).map((d) => d.ratio));
  const prevIndex = avg(monthly.slice(-4, -2).map((d) => d.ratio));

  const growthRate = prevIndex > 0 ? currentIndex / prevIndex : 1;

  if (currentIndex === 0) return { seasonalScore: 0, growthRate, avgRatio: 0 };

  const raw = (lastYearIndex / currentIndex) * growthRate * 50;
  const seasonalScore = Math.min(100, Math.round(raw));

  return { seasonalScore, growthRate, avgRatio: currentIndex };
}

// ─── DataLab API 타입 ─────────────────────────────────────────────────────────

interface DataLabResponse {
  results: Array<{
    title: string;
    data: MonthlyRatio[];
  }>;
}

// ─── 내부: DataLab 14개월 데이터 조회 (캐시 우선) ────────────────────────────

const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24시간

async function fetchDataLabMonthly(keyword: string): Promise<MonthlyRatio[]> {
  const pool = getSourcingPool();

  // 캐시 체크
  const cacheRes = await pool.query<{ data: MonthlyRatio[]; fetched_at: Date }>(
    'SELECT data, fetched_at FROM public.keyword_trend_cache WHERE keyword = $1',
    [keyword],
  );

  if (cacheRes.rows.length > 0) {
    const age = Date.now() - new Date(cacheRes.rows[0].fetched_at).getTime();
    if (age < CACHE_TTL_MS) {
      return cacheRes.rows[0].data;
    }
  }

  // DataLab API 호출 — 14개월 월별 데이터
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 13);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const res = await fetch(DATALAB_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID ?? '',
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET ?? '',
    },
    body: JSON.stringify({
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      timeUnit: 'month',
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`DataLab API 오류: ${res.status}`);
  }

  const json = (await res.json()) as DataLabResponse;
  const monthly: MonthlyRatio[] = json.results?.[0]?.data ?? [];

  // 캐시 저장 (UPSERT)
  await pool.query(
    `INSERT INTO public.keyword_trend_cache (keyword, data, fetched_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (keyword) DO UPDATE
       SET data = $2::jsonb, fetched_at = now()`,
    [keyword, JSON.stringify(monthly)],
  );

  return monthly;
}

// ─── 내부: 네이버쇼핑 경쟁 상품 수 조회 ─────────────────────────────────────

async function fetchCompetitionCount(keyword: string): Promise<number> {
  try {
    const params = new URLSearchParams({ query: keyword, display: '1', start: '1' });
    const res = await fetch(
      `https://openapi.naver.com/v1/search/shop.json?${params.toString()}`,
      {
        headers: {
          'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID ?? '',
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET ?? '',
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { total: number };
    return data.total ?? 0;
  } catch {
    return 0;
  }
}

// ─── 공개: 딥 키워드 분석 메인 함수 ─────────────────────────────────────────

const SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 대표 키워드에서 자동완성 하위 키워드를 발굴하고
 * 각 키워드의 DataLab 14개월 데이터 + 계절 점수 + 경쟁 강도를 반환한다.
 *
 * rate limit 방지:
 *  - DataLab 호출 간 300ms 딜레이
 *  - 응답은 keyword_trend_cache에 24h 캐싱
 */
export async function analyzeDeepKeywords(rootKeyword: string): Promise<DeepKeywordResult> {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    throw new Error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정');
  }

  const client = getNaverShoppingClient();

  // 자동완성으로 하위 키워드 발굴 (최대 8개)
  const suggestions = await client.getSuggestions(rootKeyword);
  const subKeywords = suggestions.slice(0, 8);
  const allKeywords = [rootKeyword, ...subKeywords];

  const items: DeepKeywordItem[] = [];

  for (const kw of allKeywords) {
    const [monthly, competitionCount] = await Promise.all([
      fetchDataLabMonthly(kw).catch(() => [] as MonthlyRatio[]),
      fetchCompetitionCount(kw).catch(() => 0),
    ]);

    const { seasonalScore, growthRate, avgRatio } = calcSeasonalScore(monthly);

    items.push({
      keyword: kw,
      parentKeyword: kw === rootKeyword ? null : rootKeyword,
      monthly,
      avgRatio,
      seasonalScore,
      growthRate,
      competitionCount,
    });

    // DataLab rate limit 방지
    await SLEEP(300);
  }

  return {
    rootKeyword,
    items,
    fetchedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
npx vitest run src/lib/sourcing/__tests__/deep-keyword.test.ts 2>&1 | tail -20
```

Expected: `5 tests passed`

- [ ] **Step 5: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "deep-keyword" | head -10
```

Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/lib/sourcing/deep-keyword.ts src/lib/sourcing/__tests__/deep-keyword.test.ts
git commit -m "feat: deep-keyword 유틸 — DataLab 14개월 캐시 + 계절점수 계산"
```

---

## Task 3: API Route `/api/sourcing/deep-keyword`

**Files:**
- Create: `src/app/api/sourcing/deep-keyword/route.ts`

- [ ] **Step 1: route 파일 생성**

파일 경로: `src/app/api/sourcing/deep-keyword/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { analyzeDeepKeywords } from '@/lib/sourcing/deep-keyword';

export async function POST(req: NextRequest) {
  let keyword: string;

  try {
    const body = (await req.json()) as { keyword?: unknown };
    if (typeof body.keyword !== 'string' || body.keyword.trim() === '') {
      return NextResponse.json(
        { error: '키워드를 입력해 주세요.' },
        { status: 400 },
      );
    }
    keyword = body.keyword.trim().slice(0, 50);  // 최대 50자
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  // API 키 미설정 체크 — 503으로 클라이언트에 안내
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수 미설정' },
      { status: 503 },
    );
  }

  try {
    const result = await analyzeDeepKeywords(keyword);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[deep-keyword] 분석 오류:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "deep-keyword" | head -10
```

Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/app/api/sourcing/deep-keyword/route.ts
git commit -m "feat: POST /api/sourcing/deep-keyword route 추가"
```

---

## Task 4: `DeepKeywordEngine.tsx` UI 완성

**Files:**
- Modify: `src/components/sourcing/DeepKeywordEngine.tsx`

현재 파일은 `query` 상태와 disabled 버튼만 있는 skeleton입니다. 실제 API 호출 + 결과 테이블 UI로 교체합니다.

- [ ] **Step 1: 파일 전체 교체**

```tsx
'use client';

import React, { useState } from 'react';
import { Search, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import type { DeepKeywordResult, DeepKeywordItem } from '@/lib/sourcing/deep-keyword';

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function seasonalLabel(score: number): { text: string; color: string } {
  if (score >= 70) return { text: '🔥 핫', color: '#be0014' };
  if (score >= 45) return { text: '📈 주목', color: '#d97706' };
  if (score >= 20) return { text: '🌙 보통', color: '#6366f1' };
  return { text: '❄️ 낮음', color: '#71717a' };
}

function growthIcon(rate: number) {
  if (rate > 1.1) return <TrendingUp size={14} color="#16a34a" />;
  if (rate < 0.9) return <TrendingDown size={14} color="#dc2626" />;
  return <Minus size={14} color="#a1a1aa" />;
}

function competitionLabel(count: number, avgRatio: number): string {
  if (avgRatio === 0) return '—';
  const ratio = count / avgRatio;
  if (ratio < 1000) return '낮음 ✅';
  if (ratio < 5000) return '보통';
  return '높음';
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function DeepKeywordEngine() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeepKeywordResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    const kw = query.trim();
    if (!kw) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/sourcing/deep-keyword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw }),
      });

      const data = await res.json() as DeepKeywordResult & { error?: string };

      if (!res.ok) {
        setError(data.error ?? '분석 중 오류가 발생했습니다.');
        return;
      }

      setResult(data);
    } catch {
      setError('네트워크 오류. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>
          🔍 딥 키워드 추천 엔진
        </h2>
        <p style={{ fontSize: 12, color: C.textSub, margin: 0 }}>
          대표 키워드를 입력하면 공략 가능한 하위 키워드와 계절 점수를 분석합니다.
          (예: 텀블러 → 사무실 텀블러, 차량용 텀블러)
        </p>
      </div>

      {/* 검색 인풋 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: 텀블러"
          disabled={loading}
          style={{
            flex: 1, padding: '10px 14px', fontSize: 14,
            border: `1px solid ${C.border}`, borderRadius: 8,
            outline: 'none', color: C.text, background: loading ? '#f4f4f5' : '#fff',
          }}
          onKeyDown={(e) => e.key === 'Enter' && !loading && handleAnalyze()}
        />
        <button
          onClick={handleAnalyze}
          disabled={loading || !query.trim()}
          style={{
            padding: '10px 20px', fontSize: 14, fontWeight: 600,
            background: loading || !query.trim() ? '#d4d4d8' : C.accent,
            color: '#fff', border: 'none', borderRadius: 8,
            cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
          }}
        >
          <Search size={14} />
          {loading ? '분석 중...' : '분석'}
        </button>
      </div>

      {/* 에러 */}
      {error && (
        <div style={{
          background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)',
          borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#dc2626', marginBottom: 16,
        }}>
          ⚠️ {error}
          {error.includes('환경변수') && (
            <a href="/settings" style={{ marginLeft: 8, color: '#dc2626', fontWeight: 600 }}>
              설정 바로가기 →
            </a>
          )}
        </div>
      )}

      {/* 로딩 skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[85, 65, 75, 55, 70].map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0' }}>
              <div style={{ width: `${w}%`, height: 14, background: '#e4e4e7', borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
              <div style={{ width: 44, height: 14, background: '#e4e4e7', borderRadius: 4 }} />
              <div style={{ width: 36, height: 14, background: '#e4e4e7', borderRadius: 4 }} />
            </div>
          ))}
          <p style={{ fontSize: 12, color: C.textSub, textAlign: 'center', marginTop: 8 }}>
            자동완성 + DataLab API 조회 중... (최대 30초)
          </p>
        </div>
      )}

      {/* 결과 테이블 */}
      {result && !loading && (
        <>
          <div style={{ marginBottom: 10, fontSize: 12, color: C.textSub }}>
            <strong style={{ color: C.text }}>"{result.rootKeyword}"</strong> 분석 결과
            — {result.items.length}개 키워드
            <span style={{ marginLeft: 8 }}>
              ({new Date(result.fetchedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 기준)
            </span>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f3f3f3', borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>키워드</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 80 }}>계절 점수</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 70 }}>성장세</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 90 }}>평균 검색량</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 90 }}>경쟁 강도</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item, idx) => {
                  const isRoot = item.parentKeyword === null;
                  const label = seasonalLabel(item.seasonalScore);
                  return (
                    <tr key={item.keyword} style={{
                      background: isRoot ? 'rgba(190,0,20,0.04)' : idx % 2 === 0 ? '#fff' : C.bg,
                      borderTop: `1px solid ${C.border}`,
                    }}>
                      <td style={{ padding: '10px 16px', color: C.text, fontWeight: isRoot ? 700 : 400 }}>
                        {!isRoot && <span style={{ marginRight: 6, color: C.textSub }}>└</span>}
                        {item.keyword}
                        {isRoot && <span style={{ marginLeft: 6, fontSize: 11, color: C.textSub }}>대표</span>}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                          background: `${label.color}15`, color: label.color, fontSize: 12, fontWeight: 600,
                        }}>
                          {label.text} {item.seasonalScore}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          {growthIcon(item.growthRate)}
                          <span style={{ fontSize: 12, color: C.textSub }}>
                            {item.growthRate > 0 ? `×${item.growthRate.toFixed(1)}` : '—'}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: C.textSub }}>
                        {item.avgRatio > 0 ? item.avgRatio.toFixed(1) : '—'}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                        <span style={{ fontSize: 12, color: C.textSub }}>
                          {competitionLabel(item.competitionCount, item.avgRatio)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 10, fontSize: 11, color: C.textSub }}>
            계절 점수: 작년 동기 대비 현재 성장률 기반 (높을수록 2개월 후 수요 증가 예상)
            · 경쟁 강도: 네이버쇼핑 상품 수 / 검색량 비율
          </p>
        </>
      )}

      {/* 초기 상태 안내 */}
      {!result && !loading && !error && (
        <div style={{
          border: `1px dashed ${C.border}`, borderRadius: 12,
          padding: '32px 24px', textAlign: 'center', color: C.textSub,
        }}>
          <p style={{ fontSize: 14, margin: '0 0 8px' }}>키워드를 입력하고 분석 버튼을 눌러 주세요.</p>
          <p style={{ fontSize: 12, margin: 0 }}>예: <strong>텀블러</strong>, <strong>무선청소기</strong>, <strong>캠핑의자</strong></p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep "DeepKeywordEngine\|deep-keyword" | head -10
```

Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/components/sourcing/DeepKeywordEngine.tsx
git commit -m "feat: DeepKeywordEngine UI 완성 — API 연동 + 결과 테이블 + 로딩/에러 상태"
```

---

## Self-Review

### Spec Coverage

| 요구사항 | 태스크 |
|---------|--------|
| 키워드 계층 트리 — 네이버 자동완성 | Task 2 (`analyzeDeepKeywords` → `getSuggestions`) |
| 월별 검색량 인덱스 (14개월) — DataLab | Task 2 (`fetchDataLabMonthly`) |
| 24시간 DB 캐싱 | Task 1 (테이블) + Task 2 (캐시 로직) |
| 계절 점수 (0~100) | Task 2 (`calcSeasonalScore`) |
| 경쟁 강도 | Task 2 (`fetchCompetitionCount`) |
| Fallback: API 키 없음 → 503 안내 | Task 3 (route), Task 4 (에러 배너) |
| Fallback: 결과 0건 → 초기 상태 안내 | Task 4 (빈 상태 UI) |
| 검색 버튼 활성화 | Task 4 |
| 로딩 skeleton | Task 4 |

### Placeholder Scan

없음 — 모든 단계에 완성된 코드 있음.

### Type Consistency

- `MonthlyRatio`, `DeepKeywordItem`, `DeepKeywordResult` 타입이 Task 2에서 정의되고 Task 4에서 import됨 (`import type { ... } from '@/lib/sourcing/deep-keyword'`) — 일관됨.
- `calcSeasonalScore` 반환 타입 `{ seasonalScore, growthRate, avgRatio }` 가 Task 2 테스트와 deep-keyword.ts 구현에서 동일하게 사용됨 — 일관됨.
