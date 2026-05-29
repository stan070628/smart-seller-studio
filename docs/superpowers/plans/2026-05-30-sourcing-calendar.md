# 소싱 캘린더 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sourcing-validator 앱에 소싱 캘린더 탭을 추가해 DataLab 24개월 트렌드 기반으로 2개월 후 인기 키워드를 점수화해 표시한다.

**Architecture:** `seasonal.ts` 순수 함수로 계절 점수 계산 → `/api/calendar/analyze` POST 라우트에서 24개월 DataLab 데이터 수집 후 점수 반환 → `/calendar` 페이지에서 리스트 UI + localStorage 캐시 처리.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, SVG 스파크라인, Naver DataLab API, Vitest

---

## 파일 구조

| 파일 | 작업 |
|------|------|
| `src/lib/seasonal.ts` | 신규 — 계절 점수 계산 순수 함수 (`computeSeasonalScore`, `toStars`, `clamp`, 타입 정의) |
| `src/lib/__tests__/seasonal.test.ts` | 신규 — seasonal.ts 단위 테스트 |
| `src/lib/naver.ts` | 수정 — `fetchDatalabTrend24` 추가 (기존 함수 유지) |
| `src/lib/__tests__/naver.test.ts` | 수정 — `fetchDatalabTrend24` 테스트 추가 |
| `src/app/api/calendar/analyze/route.ts` | 신규 — POST 라우트, 키워드 배열 → 계절 점수 배열 |
| `src/app/layout.tsx` | 수정 — 상단 탭 네비게이션 추가 |
| `src/app/calendar/page.tsx` | 신규 — 소싱 캘린더 전체 UI |

---

## Task 1: seasonal.ts 순수 함수 + 타입

**Files:**
- Create: `src/lib/seasonal.ts`
- Create: `src/lib/__tests__/seasonal.test.ts`

작업 디렉토리: `~/Desktop/projects/sourcing-validator/`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/__tests__/seasonal.test.ts
import { describe, it, expect } from 'vitest';
import {
  clamp,
  toStars,
  computeSeasonalScore,
} from '../seasonal';
import type { TrendPoint } from '../naver';

function makeTrend(ratios: number[]): TrendPoint[] {
  return ratios.map((ratio, i) => ({
    period: `2024-${String(i + 1).padStart(2, '0')}-01`,
    ratio,
  }));
}

const TREND_24 = makeTrend([
  10, 20, 30, 40, 50, 60, 70, 80, 90, 80, 70, 60, // 24~13 months ago (indices 0-11)
  55, 65, 75, 85, 95, 85, 75, 65, 55, 50, 45, 60, // 12~1 months ago (indices 12-23)
]);

describe('clamp', () => {
  it('최솟값보다 작은 경우 최솟값 반환', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });
  it('최댓값보다 큰 경우 최댓값 반환', () => {
    expect(clamp(120, 0, 100)).toBe(100);
  });
  it('범위 안이면 그대로 반환', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
});

describe('toStars', () => {
  it('0-20 → 1점', () => { expect(toStars(15)).toBe(1); });
  it('21-40 → 2점', () => { expect(toStars(35)).toBe(2); });
  it('41-60 → 3점', () => { expect(toStars(55)).toBe(3); });
  it('61-80 → 4점', () => { expect(toStars(75)).toBe(4); });
  it('81-100 → 5점', () => { expect(toStars(90)).toBe(5); });
  it('경계값 20 → 1점', () => { expect(toStars(20)).toBe(1); });
  it('경계값 80 → 4점', () => { expect(toStars(80)).toBe(4); });
  it('경계값 81 → 5점', () => { expect(toStars(81)).toBe(5); });
});

describe('computeSeasonalScore', () => {
  it('24개월 미만 데이터면 에러를 던진다', () => {
    const shortTrend = makeTrend([10, 20, 30]);
    expect(() => computeSeasonalScore(shortTrend)).toThrow('24개월 데이터 필요');
  });

  it('predicted, stars, yoyGrowth, sparkline을 반환한다', () => {
    const result = computeSeasonalScore(TREND_24);
    expect(result).toMatchObject({
      predicted: expect.any(Number),
      targetLastYear: expect.any(Number),
      yoyGrowth: expect.any(Number),
      stars: expect.any(Number),
    });
    expect(result.sparkline).toHaveLength(12);
  });

  it('targetLastYear는 trend[13] (0-indexed)의 ratio다', () => {
    const result = computeSeasonalScore(TREND_24);
    // trend.length=24, targetOffset=2: trend[24 - (13-2)] = trend[13]
    expect(result.targetLastYear).toBe(TREND_24[13].ratio); // 65
  });

  it('yoyGrowth 계산: (currentMonth - lastYearSame) / lastYearSame', () => {
    // currentMonth = trend[23] = 60
    // lastYearSame = trend[11] = 60
    // yoyGrowth = (60 - 60) / 60 = 0
    const result = computeSeasonalScore(TREND_24);
    expect(result.yoyGrowth).toBeCloseTo(0, 5);
  });

  it('predicted = round(targetLastYear * (1 + yoyGrowth)), 0-100 범위', () => {
    // targetLastYear=65, yoyGrowth=0 → predicted=65
    const result = computeSeasonalScore(TREND_24);
    expect(result.predicted).toBe(65);
    expect(result.predicted).toBeGreaterThanOrEqual(0);
    expect(result.predicted).toBeLessThanOrEqual(100);
  });

  it('sparkline은 마지막 12개월 슬라이스다', () => {
    const result = computeSeasonalScore(TREND_24);
    expect(result.sparkline).toEqual(TREND_24.slice(12));
  });

  it('lastYearSame이 0이면 yoyGrowth는 0', () => {
    const zeroBase = makeTrend(Array(24).fill(0).map((_, i) => i === 11 ? 0 : 50));
    const result = computeSeasonalScore(zeroBase);
    expect(result.yoyGrowth).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd ~/Desktop/projects/sourcing-validator && npx vitest run src/lib/__tests__/seasonal.test.ts
```
Expected: FAIL with "Cannot find module '../seasonal'"

- [ ] **Step 3: seasonal.ts 구현**

```typescript
// src/lib/seasonal.ts
import type { TrendPoint } from './naver';

export interface SeasonalResult {
  predicted: number;
  targetLastYear: number;
  yoyGrowth: number;
  stars: number;
  sparkline: TrendPoint[];
}

export interface Category {
  id: string;
  name: string;
  keywords: string[];
}

export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: 'summer',
    name: '여름용품',
    keywords: ['선풍기', '아이스팩', '텀블러', '수영복', '돗자리', '모기장', '쿨매트'],
  },
  {
    id: 'camping',
    name: '캠핑용품',
    keywords: ['캠핑의자', '텐트', '랜턴', '코펠', '핫팩', '버너', '그라운드시트'],
  },
  {
    id: 'beauty',
    name: '뷰티/위생',
    keywords: ['자외선차단제', '선크림', '마스크팩', '핸드크림', '립밤'],
  },
  {
    id: 'custom',
    name: '커스텀',
    keywords: [],
  },
];

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function toStars(score: number): number {
  if (score <= 20) return 1;
  if (score <= 40) return 2;
  if (score <= 60) return 3;
  if (score <= 80) return 4;
  return 5;
}

export function computeSeasonalScore(
  trend: TrendPoint[],
  targetOffset: number = 2
): SeasonalResult {
  if (trend.length < 24) throw new Error('24개월 데이터 필요');

  const len = trend.length;
  // 작년의 "현재+targetOffset개월" 인덱스
  const targetLastYear = trend[len - (13 - targetOffset)].ratio;
  const currentMonth = trend[len - 1].ratio;
  const lastYearSame = trend[len - 13].ratio;

  const yoyGrowth =
    lastYearSame > 0 ? (currentMonth - lastYearSame) / lastYearSame : 0;

  const predicted = clamp(
    Math.round(targetLastYear * (1 + yoyGrowth)),
    0,
    100
  );

  return {
    predicted,
    targetLastYear,
    yoyGrowth,
    stars: toStars(predicted),
    sparkline: trend.slice(len - 12),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd ~/Desktop/projects/sourcing-validator && npx vitest run src/lib/__tests__/seasonal.test.ts
```
Expected: PASS (모든 테스트 통과)

- [ ] **Step 5: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator && git add src/lib/seasonal.ts src/lib/__tests__/seasonal.test.ts && git commit -m "feat: seasonal.ts 계절 점수 계산 순수 함수 추가"
```

---

## Task 2: naver.ts에 fetchDatalabTrend24 추가

**Files:**
- Modify: `src/lib/naver.ts`
- Modify: `src/lib/__tests__/naver.test.ts`

기존 `fetchDatalabTrend`는 12개월, `fetchDatalabTrend24`는 24개월 조회.

- [ ] **Step 1: 실패 테스트 작성**

기존 `src/lib/__tests__/naver.test.ts` 파일 끝에 아래 테스트 블록을 추가한다:

```typescript
// 파일 맨 위 import에 fetchDatalabTrend24 추가 필요:
// import { collectNaverData, fetchDatalabTrend24 } from '../naver';

const MOCK_DATALAB_24 = {
  results: [{
    data: Array.from({ length: 24 }, (_, i) => ({
      period: `2024-${String(i + 1).padStart(2, '0')}-01`,
      ratio: 10 + i * 3,
    }))
  }]
};

describe('fetchDatalabTrend24', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAVER_CLIENT_ID = 'test-id';
    process.env.NAVER_CLIENT_SECRET = 'test-secret';
  });

  it('24개월 기간으로 DataLab API를 호출해 TrendPoint[] 반환', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_DATALAB_24),
    });

    const result = await fetchDatalabTrend24('텀블러', 'test-id', 'test-secret');

    expect(result).toHaveLength(24);
    expect(result[0]).toEqual({ period: '2024-01-01', ratio: 10 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('startDate가 endDate 기준 24개월 전이다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_DATALAB_24),
    });

    await fetchDatalabTrend24('텀블러', 'test-id', 'test-secret');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const start = new Date(body.startDate);
    const end = new Date(body.endDate);
    const diffMonths =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    expect(diffMonths).toBe(24);
  });

  it('API 실패 시 에러를 던진다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(
      fetchDatalabTrend24('텀블러', 'test-id', 'test-secret')
    ).rejects.toThrow('[Datalab API] failed: 500');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd ~/Desktop/projects/sourcing-validator && npx vitest run src/lib/__tests__/naver.test.ts
```
Expected: FAIL with "fetchDatalabTrend24 is not a function" (또는 export 없음 에러)

- [ ] **Step 3: naver.ts에 fetchDatalabTrend24 + export 추가**

`src/lib/naver.ts` 파일에서 기존 `fetchDatalabTrend` 함수 바로 뒤에 아래를 추가한다:

```typescript
export async function fetchDatalabTrend24(
  keyword: string,
  clientId: string,
  clientSecret: string
): Promise<TrendPoint[]> {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 24);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: formatDate(start),
        endDate: formatDate(end),
        timeUnit: 'month',
        keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
      }),
    });

    if (!res.ok) {
      throw new Error(`[Datalab API] failed: ${res.status}`);
    }

    const data = await res.json();
    return (data.results?.[0]?.data ?? []) as TrendPoint[];
  } finally {
    clearTimeout(timer);
  }
}
```

naver.test.ts 파일 최상단의 import 라인을 아래와 같이 수정한다:

```typescript
import { collectNaverData, fetchDatalabTrend24 } from '../naver';
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd ~/Desktop/projects/sourcing-validator && npx vitest run src/lib/__tests__/naver.test.ts
```
Expected: PASS (기존 테스트 포함 모두 통과)

- [ ] **Step 5: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator && git add src/lib/naver.ts src/lib/__tests__/naver.test.ts && git commit -m "feat: fetchDatalabTrend24 추가 (24개월 DataLab 조회)"
```

---

## Task 3: /api/calendar/analyze POST 라우트

**Files:**
- Create: `src/app/api/calendar/analyze/route.ts`

- [ ] **Step 1: 디렉토리 생성 확인**

```bash
mkdir -p ~/Desktop/projects/sourcing-validator/src/app/api/calendar/analyze
```

- [ ] **Step 2: route.ts 구현**

```typescript
// src/app/api/calendar/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchDatalabTrend24 } from '@/lib/naver';
import { computeSeasonalScore } from '@/lib/seasonal';
import type { SeasonalResult } from '@/lib/seasonal';

interface AnalyzeRequest {
  keywords: string[];
}

interface AnalyzeResultItem extends SeasonalResult {
  keyword: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  let body: AnalyzeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { keywords } = body;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ error: 'keywords 배열이 필요합니다.' }, { status: 400 });
  }

  const results: AnalyzeResultItem[] = await Promise.all(
    keywords.map(async (keyword) => {
      try {
        const trend = await fetchDatalabTrend24(keyword, clientId, clientSecret);
        if (trend.length < 24) {
          return { keyword, predicted: 0, targetLastYear: 0, yoyGrowth: 0, stars: 1, sparkline: trend, error: '데이터 부족 (24개월 미만)' };
        }
        const score = computeSeasonalScore(trend);
        return { keyword, ...score };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { keyword, predicted: 0, targetLastYear: 0, yoyGrowth: 0, stars: 1, sparkline: [], error: message };
      }
    })
  );

  return NextResponse.json({
    results,
    analyzedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 3: 동작 확인 (개발 서버 기준)**

개발 서버 실행 후 curl로 테스트:
```bash
curl -X POST http://localhost:3001/api/calendar/analyze \
  -H "Content-Type: application/json" \
  -d '{"keywords":["선풍기"]}' | python3 -m json.tool
```
Expected: `results` 배열에 `predicted`, `stars`, `yoyGrowth`, `sparkline` 포함된 JSON

- [ ] **Step 4: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator && git add src/app/api/calendar/analyze/route.ts && git commit -m "feat: /api/calendar/analyze POST 라우트 추가"
```

---

## Task 4: layout.tsx 탭 네비게이션 추가

**Files:**
- Modify: `src/app/layout.tsx`

현재 layout.tsx는 단순 body wrapper만 있다. 상단에 탭 네비게이션을 추가한다.

- [ ] **Step 1: layout.tsx 전체 교체**

```typescript
// src/app/layout.tsx
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '소싱 도구',
  description: '소싱 검증기 + 소싱 캘린더',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gray-50">
        <nav className="bg-white border-b border-gray-200 px-4">
          <div className="max-w-3xl mx-auto flex gap-0">
            <Link
              href="/"
              className="px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 border-b-2 border-transparent hover:border-gray-300 transition-colors"
            >
              소싱 검증기
            </Link>
            <Link
              href="/calendar"
              className="px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 border-b-2 border-transparent hover:border-gray-300 transition-colors"
            >
              소싱 캘린더
            </Link>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: 브라우저 확인**

개발 서버(`npm run dev -- --port 3001`)가 실행 중인 상태에서 `http://localhost:3001` 접속.
상단에 "소싱 검증기", "소싱 캘린더" 탭 링크가 보여야 한다.

- [ ] **Step 3: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator && git add src/app/layout.tsx && git commit -m "feat: 상단 탭 네비게이션 추가 (소싱 검증기 | 소싱 캘린더)"
```

---

## Task 5: calendar/page.tsx 소싱 캘린더 UI

**Files:**
- Create: `src/app/calendar/page.tsx`

전체 소싱 캘린더 UI. 카테고리 탭, 키워드 리스트, SVG 스파크라인, 편집 모드.

- [ ] **Step 1: 디렉토리 생성**

```bash
mkdir -p ~/Desktop/projects/sourcing-validator/src/app/calendar
```

- [ ] **Step 2: calendar/page.tsx 전체 구현**

```typescript
// src/app/calendar/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TrendPoint } from '@/lib/naver';
import { DEFAULT_CATEGORIES } from '@/lib/seasonal';
import type { Category } from '@/lib/seasonal';

interface SeasonalResultItem {
  keyword: string;
  predicted: number;
  targetLastYear: number;
  yoyGrowth: number;
  stars: number;
  sparkline: TrendPoint[];
  error?: string;
}

interface AnalyzeResponse {
  results: SeasonalResultItem[];
  analyzedAt: string;
}

interface CachedResult {
  results: SeasonalResultItem[];
  analyzedAt: string;
}

const LS_CATEGORIES = 'sourcing-calendar-categories';
const LS_LAST_RESULT = 'sourcing-calendar-last-result';

function Sparkline({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) return <span className="text-gray-300 text-xs">—</span>;

  const max = Math.max(...data.map((d) => d.ratio), 1);
  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * 58 + 1;
      const y = 19 - (d.ratio / max) * 17;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 60 20" className="w-16 h-5 text-blue-500" fill="none">
      <polyline points={points} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function StarDisplay({ count }: { count: number }) {
  return (
    <span className="text-yellow-500">
      {'★'.repeat(count)}{'☆'.repeat(5 - count)}
    </span>
  );
}

function YoYBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const positive = pct >= 0;
  return (
    <span className={`text-xs font-medium ${positive ? 'text-green-600' : 'text-red-500'}`}>
      {positive ? '+' : ''}{pct}%
    </span>
  );
}

export default function CalendarPage() {
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [activeCatId, setActiveCatId] = useState<string>('all');
  const [results, setResults] = useState<SeasonalResultItem[]>([]);
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // localStorage 로드
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CATEGORIES);
      if (raw) setCategories(JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem(LS_LAST_RESULT);
      if (raw) {
        const cached: CachedResult = JSON.parse(raw);
        setResults(cached.results);
        setAnalyzedAt(cached.analyzedAt);
      }
    } catch {}
  }, []);

  const saveCategories = useCallback((cats: Category[]) => {
    setCategories(cats);
    localStorage.setItem(LS_CATEGORIES, JSON.stringify(cats));
  }, []);

  const activeKeywords = useCallback((): string[] => {
    if (activeCatId === 'all') {
      return [...new Set(categories.flatMap((c) => c.keywords))];
    }
    return categories.find((c) => c.id === activeCatId)?.keywords ?? [];
  }, [activeCatId, categories]);

  const handleAnalyze = useCallback(async () => {
    const keywords = activeKeywords();
    if (keywords.length === 0) {
      setError('분석할 키워드가 없습니다. 카테고리에 키워드를 추가해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/calendar/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data: AnalyzeResponse = await res.json();
      const sorted = [...data.results].sort((a, b) => b.predicted - a.predicted);
      setResults(sorted);
      setAnalyzedAt(data.analyzedAt);
      localStorage.setItem(LS_LAST_RESULT, JSON.stringify({ results: sorted, analyzedAt: data.analyzedAt }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [activeKeywords]);

  const startEdit = (cat: Category) => {
    setEditingCatId(cat.id);
    setEditText(cat.keywords.join('\n'));
  };

  const saveEdit = () => {
    if (!editingCatId) return;
    const keywords = editText
      .split('\n')
      .map((k) => k.trim())
      .filter(Boolean);
    const updated = categories.map((c) =>
      c.id === editingCatId ? { ...c, keywords } : c
    );
    saveCategories(updated);
    setEditingCatId(null);
  };

  const addCustomCategory = () => {
    const name = prompt('새 카테고리 이름:');
    if (!name?.trim()) return;
    const id = `custom-${Date.now()}`;
    saveCategories([...categories, { id, name: name.trim(), keywords: [] }]);
  };

  const deleteCategory = (id: string) => {
    if (!confirm('카테고리를 삭제하시겠습니까?')) return;
    saveCategories(categories.filter((c) => c.id !== id));
    if (activeCatId === id) setActiveCatId('all');
  };

  const displayResults = activeCatId === 'all'
    ? results
    : results.filter((r) =>
        categories.find((c) => c.id === activeCatId)?.keywords.includes(r.keyword)
      );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">소싱 캘린더</h1>
        <div className="flex gap-2">
          <button
            onClick={addCustomCategory}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            + 카테고리
          </button>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '분석 중...' : '분석하기'}
          </button>
        </div>
      </div>

      {/* 카테고리 탭 */}
      <div className="flex gap-1 mb-4 flex-wrap">
        <button
          onClick={() => setActiveCatId('all')}
          className={`px-3 py-1 text-sm rounded-full border transition-colors ${
            activeCatId === 'all'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-gray-300 text-gray-600 hover:border-gray-400'
          }`}
        >
          전체
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCatId(cat.id)}
            className={`px-3 py-1 text-sm rounded-full border transition-colors ${
              activeCatId === cat.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* 활성 카테고리 편집 패널 */}
      {activeCatId !== 'all' && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          {editingCatId === activeCatId ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">한 줄에 키워드 하나</p>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full h-28 text-sm border border-gray-300 rounded px-2 py-1 font-mono resize-none"
              />
              <div className="flex gap-2">
                <button onClick={saveEdit} className="px-3 py-1 text-sm bg-blue-600 text-white rounded">저장</button>
                <button onClick={() => setEditingCatId(null)} className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-600">취소</button>
                <button
                  onClick={() => deleteCategory(activeCatId)}
                  className="px-3 py-1 text-sm text-red-500 border border-red-200 rounded ml-auto hover:bg-red-50"
                >
                  카테고리 삭제
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">
                키워드: {categories.find((c) => c.id === activeCatId)?.keywords.join(', ') || '없음'}
              </span>
              <button
                onClick={() => startEdit(categories.find((c) => c.id === activeCatId)!)}
                className="text-xs text-blue-600 hover:underline"
              >
                편집
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 결과 테이블 */}
      {displayResults.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2 font-medium text-gray-600">키워드</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">점수</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600">★</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">YoY</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600">트렌드</th>
              </tr>
            </thead>
            <tbody>
              {displayResults.map((item) => (
                <tr key={item.keyword} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {item.keyword}
                    {item.error && (
                      <span className="ml-1 text-xs text-red-400">({item.error})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{item.predicted}</td>
                  <td className="px-3 py-2 text-center">
                    <StarDisplay count={item.stars} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <YoYBadge value={item.yoyGrowth} />
                  </td>
                  <td className="px-3 py-2 flex justify-center">
                    <Sparkline data={item.sparkline} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {results.length === 0
              ? '"분석하기" 버튼을 눌러 키워드 점수를 확인하세요.'
              : '선택한 카테고리에 결과가 없습니다.'}
          </div>
        )
      )}

      {loading && (
        <div className="text-center py-12 text-gray-400 text-sm">
          DataLab 데이터 수집 중... (키워드 수에 따라 최대 30초 소요)
        </div>
      )}

      {analyzedAt && !loading && (
        <p className="mt-3 text-xs text-gray-400 text-right">
          마지막 분석: {new Date(analyzedAt).toLocaleString('ko-KR')}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 전체 테스트 스위트 통과 확인**

```bash
cd ~/Desktop/projects/sourcing-validator && npx vitest run
```
Expected: 모든 기존 테스트 + 신규 테스트 PASS

- [ ] **Step 4: 브라우저 동작 확인**

개발 서버 실행:
```bash
cd ~/Desktop/projects/sourcing-validator && npm run dev -- --port 3001
```

확인 항목:
1. `http://localhost:3001/calendar` 접속 → 소싱 캘린더 페이지 로드
2. 카테고리 탭 클릭 → 활성 탭 강조 + 키워드 목록 표시
3. "분석하기" 클릭 → "분석 중..." 표시 후 결과 테이블 렌더링
4. ★점수 / YoY% / SVG 스파크라인 표시 확인
5. "편집" 클릭 → textarea 편집 후 저장 → localStorage 반영
6. 브라우저 새로고침 후 마지막 분석 결과 캐시 복원 확인

- [ ] **Step 5: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator && git add src/app/calendar/page.tsx && git commit -m "feat: 소싱 캘린더 UI 추가 (카테고리 탭, 결과 테이블, 편집 모드)"
```
