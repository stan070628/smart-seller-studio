# 소싱 캘린더 V2 (AI 키워드 추천) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소싱 캘린더를 2-depth 카테고리 브라우징 + Naver 자동완성 + Claude 소싱 필터링으로 전면 개편해 AI가 깊이 있는 서브키워드를 자동 추천하게 한다.

**Architecture:** `categories.ts`에 2-depth 카테고리 트리를 정의하고, `/api/calendar/recommend` 라우트에서 Naver 자동완성 후보를 Claude Haiku로 소싱 관점 필터링한다. `calendar/page.tsx`는 대분류 탭 → 소분류 그리드 → 키워드+계절점수 테이블의 3단계 UI로 전면 재작성한다.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, Vitest, `@anthropic-ai/sdk`, Naver DataLab/자동완성 API (기존)

---

## 파일 구조

```
sourcing-validator/src/
├── lib/
│   ├── categories.ts                        ← 신규: 2-depth 카테고리 트리 타입 + 데이터
│   ├── seasonal.ts                          ← 변경 없음
│   └── naver.ts                             ← fetchAutocomplete export 추가
├── app/
│   ├── api/calendar/
│   │   ├── recommend/route.ts               ← 신규: POST → Naver + Claude 키워드 추천
│   │   └── analyze/route.ts                 ← 변경 없음
│   └── calendar/page.tsx                    ← 전면 재작성: 2-depth UI
```

---

## Task 1: @anthropic-ai/sdk 설치 + fetchAutocomplete export

**Files:**
- Modify: `sourcing-validator/package.json` (npm install)
- Modify: `sourcing-validator/src/lib/naver.ts` — `fetchAutocomplete`에 `export` 추가
- Modify: `sourcing-validator/src/lib/__tests__/naver.test.ts` — fetchAutocomplete 직접 테스트 추가

- [ ] **Step 1: @anthropic-ai/sdk 설치**

```bash
cd ~/Desktop/projects/sourcing-validator
npm install @anthropic-ai/sdk
```

Expected: `package.json`의 `dependencies`에 `"@anthropic-ai/sdk": "^..."` 추가됨.

- [ ] **Step 2: fetchAutocomplete에 export 추가하는 테스트 작성**

`src/lib/__tests__/naver.test.ts`의 기존 내용 끝에 다음 describe 블록을 추가한다:

```typescript
describe('fetchAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('자동완성 API를 호출해 string[] 반환', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_AUTOCOMPLETE),
    });

    const { fetchAutocomplete } = await import('../naver');
    const result = await fetchAutocomplete('텀블러');
    expect(result).toEqual(['사무실텀블러', '차량용텀블러']);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('ac.search.naver.com');
  });

  it('API 실패 시 에러를 던진다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const { fetchAutocomplete } = await import('../naver');
    await expect(fetchAutocomplete('텀블러')).rejects.toThrow('[Autocomplete API] failed: 404');
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인 (fetchAutocomplete가 export되지 않아 에러 발생)**

```bash
cd ~/Desktop/projects/sourcing-validator
npm test -- src/lib/__tests__/naver.test.ts
```

Expected: `fetchAutocomplete` is not exported 에러 또는 테스트 실패.

- [ ] **Step 4: naver.ts의 fetchAutocomplete에 export 추가**

`src/lib/naver.ts`의 `fetchAutocomplete` 함수 선언을 다음과 같이 수정한다:

```typescript
export async function fetchAutocomplete(keyword: string): Promise<string[]> {
```

(기존 `async function fetchAutocomplete` → `export async function fetchAutocomplete`)

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
cd ~/Desktop/projects/sourcing-validator
npm test -- src/lib/__tests__/naver.test.ts
```

Expected: 모든 테스트 PASS.

- [ ] **Step 6: .env.local에 ANTHROPIC_API_KEY 항목 추가 (실제 키는 사용자가 직접 입력)**

`~/Desktop/projects/sourcing-validator/.env.local`의 끝에 다음 줄을 추가한다:

```
ANTHROPIC_API_KEY=sk-ant-여기에_실제_키_입력
```

- [ ] **Step 7: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator
git add package.json package-lock.json src/lib/naver.ts src/lib/__tests__/naver.test.ts .env.local
git commit -m "feat: @anthropic-ai/sdk 설치 + fetchAutocomplete export 추가"
```

---

## Task 2: categories.ts — 2-depth 카테고리 트리

**Files:**
- Create: `sourcing-validator/src/lib/categories.ts`
- Create: `sourcing-validator/src/lib/__tests__/categories.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

파일 생성: `src/lib/__tests__/categories.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_CATEGORY_TREE } from '../categories';
import type { ParentCategory } from '../categories';

describe('DEFAULT_CATEGORY_TREE', () => {
  it('6개의 대분류를 포함한다', () => {
    expect(DEFAULT_CATEGORY_TREE).toHaveLength(6);
  });

  it('모든 대분류에 id, name, subcategories가 있다', () => {
    for (const parent of DEFAULT_CATEGORY_TREE) {
      expect(parent.id).toBeTruthy();
      expect(parent.name).toBeTruthy();
      expect(Array.isArray(parent.subcategories)).toBe(true);
    }
  });

  it('모든 소분류에 id, name이 있다', () => {
    for (const parent of DEFAULT_CATEGORY_TREE) {
      for (const sub of parent.subcategories) {
        expect(sub.id).toBeTruthy();
        expect(sub.name).toBeTruthy();
      }
    }
  });

  it('모든 id가 고유하다 (대분류 + 소분류 통틀어)', () => {
    const allIds: string[] = [];
    for (const parent of DEFAULT_CATEGORY_TREE) {
      allIds.push(parent.id);
      for (const sub of parent.subcategories) {
        allIds.push(sub.id);
      }
    }
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  it('각 대분류마다 소분류가 최소 1개 이상이다', () => {
    for (const parent of DEFAULT_CATEGORY_TREE) {
      expect(parent.subcategories.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('잡화 대분류에 텀블러 소분류가 있다', () => {
    const goods = DEFAULT_CATEGORY_TREE.find((p: ParentCategory) => p.id === 'goods');
    expect(goods).toBeDefined();
    const tumbler = goods!.subcategories.find((s) => s.id === 'tumbler');
    expect(tumbler?.name).toBe('텀블러');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd ~/Desktop/projects/sourcing-validator
npm test -- src/lib/__tests__/categories.test.ts
```

Expected: `Cannot find module '../categories'` 에러.

- [ ] **Step 3: categories.ts 구현**

파일 생성: `src/lib/categories.ts`

```typescript
export interface Subcategory {
  id: string;
  name: string;
}

export interface ParentCategory {
  id: string;
  name: string;
  subcategories: Subcategory[];
}

export const DEFAULT_CATEGORY_TREE: ParentCategory[] = [
  {
    id: 'goods',
    name: '잡화',
    subcategories: [
      { id: 'tumbler',  name: '텀블러' },
      { id: 'mug',      name: '머그컵' },
      { id: 'bottle',   name: '물병' },
      { id: 'ecobag',   name: '에코백' },
      { id: 'umbrella', name: '우산' },
      { id: 'wallet',   name: '지갑' },
      { id: 'pouch',    name: '파우치' },
    ],
  },
  {
    id: 'beauty',
    name: '뷰티/위생',
    subcategories: [
      { id: 'sunscreen', name: '선크림' },
      { id: 'maskpack',  name: '마스크팩' },
      { id: 'handcream', name: '핸드크림' },
      { id: 'lipbalm',   name: '립밤' },
      { id: 'shampoo',   name: '샴푸' },
      { id: 'bodywash',  name: '바디워시' },
    ],
  },
  {
    id: 'living',
    name: '생활용품',
    subcategories: [
      { id: 'storage',   name: '수납함' },
      { id: 'cleaning',  name: '청소용품' },
      { id: 'kitchen',   name: '주방용품' },
      { id: 'bathroom',  name: '욕실용품' },
      { id: 'fragrance', name: '방향제' },
    ],
  },
  {
    id: 'fashion',
    name: '패션잡화',
    subcategories: [
      { id: 'hat',   name: '모자' },
      { id: 'socks', name: '양말' },
      { id: 'belt',  name: '벨트' },
      { id: 'scarf', name: '스카프' },
      { id: 'glove', name: '장갑' },
    ],
  },
  {
    id: 'sports',
    name: '스포츠',
    subcategories: [
      { id: 'camping',  name: '캠핑용품' },
      { id: 'hiking',   name: '등산용품' },
      { id: 'swimming', name: '수영용품' },
      { id: 'fitness',  name: '헬스용품' },
      { id: 'cycling',  name: '자전거용품' },
    ],
  },
  {
    id: 'food',
    name: '식품',
    subcategories: [
      { id: 'health',    name: '건강식품' },
      { id: 'snack',     name: '간식' },
      { id: 'beverage',  name: '차/음료' },
      { id: 'seasoning', name: '조미료' },
    ],
  },
];
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd ~/Desktop/projects/sourcing-validator
npm test -- src/lib/__tests__/categories.test.ts
```

Expected: 6개 테스트 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator
git add src/lib/categories.ts src/lib/__tests__/categories.test.ts
git commit -m "feat: 2-depth 카테고리 트리 (categories.ts) 추가"
```

---

## Task 3: /api/calendar/recommend — Naver + Claude 키워드 추천 라우트

**Files:**
- Create: `sourcing-validator/src/app/api/calendar/recommend/route.ts`
- Create: `sourcing-validator/src/app/api/calendar/__tests__/recommend.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

디렉토리 생성 후 파일 작성:
`src/app/api/calendar/__tests__/recommend.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../recommend/route';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

const MOCK_AUTOCOMPLETE = {
  items: [[
    ['사무실텀블러', '0'],
    ['차량용텀블러', '0'],
    ['캠핑텀블러', '0'],
    ['대용량텀블러', '0'],
    ['미니텀블러', '0'],
    ['스텐텀블러', '0'],
    ['유리텀블러', '0'],
    ['보온텀블러', '0'],
    ['귀여운텀블러', '0'],
    ['텀블러세트', '0'],
  ]],
};

function makeRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/calendar/recommend', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/calendar/recommend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAVER_CLIENT_ID = 'test-id';
    process.env.NAVER_CLIENT_SECRET = 'test-secret';
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('Naver 자동완성 + Claude 필터링으로 키워드 8개 반환', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_AUTOCOMPLETE),
    });
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '["사무실텀블러", "차량용텀블러", "캠핑텀블러", "대용량텀블러", "미니텀블러", "스텐텀블러", "유리텀블러", "보온텀블러"]' }],
    });

    const req = makeRequest({ subcategory: '텀블러', parentCategory: '잡화' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.keywords)).toBe(true);
    expect(data.keywords.length).toBeLessThanOrEqual(8);
    expect(data.recommendedAt).toBeTruthy();
    expect(data.fallback).toBeUndefined();
  });

  it('ANTHROPIC_API_KEY 없으면 Naver 결과 상위 8개로 폴백', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_AUTOCOMPLETE),
    });

    const req = makeRequest({ subcategory: '텀블러', parentCategory: '잡화' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.fallback).toBe(true);
    expect(data.keywords.length).toBeLessThanOrEqual(8);
  });

  it('Claude API 실패 시 Naver 결과로 폴백', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_AUTOCOMPLETE),
    });
    mockMessagesCreate.mockRejectedValueOnce(new Error('API timeout'));

    const req = makeRequest({ subcategory: '텀블러', parentCategory: '잡화' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.fallback).toBe(true);
    expect(Array.isArray(data.keywords)).toBe(true);
  });

  it('Naver 자동완성 실패 시 접미어 조합 폴백 반환', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '["텀블러 용", "텀블러 형"]' }],
    });

    const req = makeRequest({ subcategory: '텀블러', parentCategory: '잡화' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.keywords)).toBe(true);
  });

  it('subcategory 없으면 400 반환', async () => {
    const req = makeRequest({ parentCategory: '잡화' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('parentCategory 없으면 400 반환', async () => {
    const req = makeRequest({ subcategory: '텀블러' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd ~/Desktop/projects/sourcing-validator
npm test -- src/app/api/calendar/__tests__/recommend.test.ts
```

Expected: `Cannot find module '../recommend/route'` 에러.

- [ ] **Step 3: recommend/route.ts 구현**

파일 생성: `src/app/api/calendar/recommend/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { fetchAutocomplete } from '@/lib/naver';

const SUFFIXES = ['용', '형', '세트', '대용량', '소형', '미니', '휴대용'];

function fallbackCandidates(subcategory: string): string[] {
  return SUFFIXES.map((s) => `${subcategory} ${s}`);
}

export async function POST(req: NextRequest) {
  let body: { subcategory?: string; parentCategory?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { subcategory, parentCategory } = body;
  if (!subcategory || !parentCategory) {
    return NextResponse.json(
      { error: 'subcategory와 parentCategory가 필요합니다.' },
      { status: 400 }
    );
  }

  // Step 1: Naver 자동완성으로 후보 수집
  let candidates: string[] = [];
  try {
    candidates = await fetchAutocomplete(subcategory);
  } catch {
    candidates = fallbackCandidates(subcategory);
  }
  if (candidates.length === 0) {
    candidates = fallbackCandidates(subcategory);
  }

  // Step 2: Claude로 소싱 관점 필터링 (API 키 없으면 폴백)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      keywords: candidates.slice(0, 8),
      recommendedAt: new Date().toISOString(),
      fallback: true,
    });
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: `당신은 쿠팡 소싱 전문가입니다. 주어진 키워드 후보 중에서 실제로 판매 가능성이 높은 것만 골라냅니다.
선별 기준:
- 구체적인 용도/대상/특징이 있는 키워드 (예: "사무실 텀블러" 적합 / "텀블러" 부적합)
- 브랜드명, 너무 일반적인 단어 제외
- 쿠팡에서 단품으로 판매 가능한 상품이어야 함
반드시 JSON 배열 형식만 반환하세요.`,
      messages: [
        {
          role: 'user',
          content: `대분류: ${parentCategory}\n소분류: ${subcategory}\n후보 키워드: ${candidates.join(', ')}\n\n위 후보에서 소싱 관점으로 가장 유망한 8개를 골라 JSON 배열만 반환하세요.\n예시: ["사무실 텀블러", "차량용 텀블러"]`,
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    const keywords: string[] = match ? (JSON.parse(match[0]) as string[]) : candidates.slice(0, 8);

    return NextResponse.json({
      keywords: keywords.slice(0, 8),
      recommendedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      keywords: candidates.slice(0, 8),
      recommendedAt: new Date().toISOString(),
      fallback: true,
    });
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd ~/Desktop/projects/sourcing-validator
npm test -- src/app/api/calendar/__tests__/recommend.test.ts
```

Expected: 6개 테스트 모두 PASS.

- [ ] **Step 5: 전체 테스트 실행 — 기존 테스트 회귀 확인**

```bash
cd ~/Desktop/projects/sourcing-validator
npm test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator
git add src/app/api/calendar/recommend/route.ts src/app/api/calendar/__tests__/recommend.test.ts
git commit -m "feat: /api/calendar/recommend 라우트 추가 (Naver + Claude 키워드 추천)"
```

---

## Task 4: calendar/page.tsx — UI 전면 재작성

**Files:**
- Modify: `sourcing-validator/src/app/calendar/page.tsx` (전면 재작성)

기존 V1 캘린더 페이지를 2-depth 카테고리 UI로 전면 교체한다.

- [ ] **Step 1: calendar/page.tsx 재작성**

`src/app/calendar/page.tsx`를 다음 내용으로 완전히 교체한다:

```tsx
'use client';

import { useState, useEffect } from 'react';
import type { ParentCategory, Subcategory } from '@/lib/categories';
import { DEFAULT_CATEGORY_TREE } from '@/lib/categories';
import type { TrendPoint } from '@/lib/naver';

const RECOMMEND_PREFIX = 'sourcing-calendar-recommend-';
const RESULT_PREFIX = 'sourcing-calendar-result-';
const CATEGORIES_KEY = 'sourcing-calendar-categories';

interface AnalysisItem {
  keyword: string;
  predicted: number;
  targetLastYear: number;
  yoyGrowth: number;
  stars: number;
  sparkline: TrendPoint[];
  error?: string;
}

function Sparkline({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) return <span className="text-gray-300 text-xs">—</span>;
  const values = data.map((d) => d.ratio);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 60;
  const h = 20;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="inline-block">
      <polyline points={points} fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function StarDisplay({ stars }: { stars: number }) {
  return (
    <span className="text-yellow-500">
      {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
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
  const [categories, setCategories] = useState<ParentCategory[]>(DEFAULT_CATEGORY_TREE);
  const [activeParentId, setActiveParentId] = useState<string>(DEFAULT_CATEGORY_TREE[0].id);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [results, setResults] = useState<AnalysisItem[]>([]);
  const [recommendedAt, setRecommendedAt] = useState<string | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingParentId, setEditingParentId] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CATEGORIES_KEY);
      if (stored) setCategories(JSON.parse(stored) as ParentCategory[]);
    } catch {
      // corrupt data → use default
    }
  }, []);

  function persistCategories(cats: ParentCategory[]) {
    setCategories(cats);
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(cats));
  }

  function selectSub(sub: Subcategory) {
    setActiveSubId(sub.id);
    setError(null);
    setFallback(false);
    try {
      const recRaw = localStorage.getItem(RECOMMEND_PREFIX + sub.id);
      const resRaw = localStorage.getItem(RESULT_PREFIX + sub.id);
      if (recRaw) {
        const { keywords: kw, recommendedAt: rat } = JSON.parse(recRaw) as {
          keywords: string[];
          recommendedAt: string;
        };
        setKeywords(kw);
        setRecommendedAt(rat);
      } else {
        setKeywords([]);
        setRecommendedAt(null);
      }
      if (resRaw) {
        const { results: res, analyzedAt: aat } = JSON.parse(resRaw) as {
          results: AnalysisItem[];
          analyzedAt: string;
        };
        setResults(res);
        setAnalyzedAt(aat);
      } else {
        setResults([]);
        setAnalyzedAt(null);
      }
    } catch {
      setKeywords([]);
      setResults([]);
      setRecommendedAt(null);
      setAnalyzedAt(null);
    }
  }

  function selectParent(parentId: string) {
    setActiveParentId(parentId);
    setActiveSubId(null);
    setKeywords([]);
    setResults([]);
    setRecommendedAt(null);
    setAnalyzedAt(null);
    setError(null);
    setFallback(false);
  }

  async function handleRecommend(forceNew: boolean) {
    if (!activeSubId) return;
    const parent = categories.find((p) => p.id === activeParentId);
    const sub = parent?.subcategories.find((s) => s.id === activeSubId);
    if (!sub || !parent) return;

    setRecommendLoading(true);
    setError(null);
    setFallback(false);
    try {
      const res = await fetch('/api/calendar/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subcategory: sub.name, parentCategory: parent.name }),
      });
      const data = (await res.json()) as {
        keywords: string[];
        recommendedAt: string;
        fallback?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? '추천 실패');
      setKeywords(data.keywords);
      setRecommendedAt(data.recommendedAt);
      if (data.fallback) setFallback(true);
      localStorage.setItem(
        RECOMMEND_PREFIX + activeSubId,
        JSON.stringify({ keywords: data.keywords, recommendedAt: data.recommendedAt })
      );
      if (forceNew) {
        setResults([]);
        setAnalyzedAt(null);
        localStorage.removeItem(RESULT_PREFIX + activeSubId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '추천 중 오류가 발생했습니다.');
    } finally {
      setRecommendLoading(false);
    }
  }

  async function handleAnalyze() {
    if (keywords.length === 0) return;
    setAnalyzeLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/calendar/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });
      const data = (await res.json()) as {
        results: AnalysisItem[];
        analyzedAt: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? '분석 실패');
      const sorted = [...data.results].sort((a, b) => b.predicted - a.predicted);
      setResults(sorted);
      setAnalyzedAt(data.analyzedAt);
      if (activeSubId) {
        localStorage.setItem(
          RESULT_PREFIX + activeSubId,
          JSON.stringify({ results: sorted, analyzedAt: data.analyzedAt })
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzeLoading(false);
    }
  }

  function addSubcategory(parentId: string) {
    const name = newSubName.trim();
    if (!name) return;
    const id = `custom-${Date.now()}`;
    const updated = categories.map((p) =>
      p.id === parentId
        ? { ...p, subcategories: [...p.subcategories, { id, name }] }
        : p
    );
    persistCategories(updated);
    setNewSubName('');
    setEditingParentId(null);
  }

  function deleteSubcategory(parentId: string, subId: string) {
    const updated = categories.map((p) =>
      p.id === parentId
        ? { ...p, subcategories: p.subcategories.filter((s) => s.id !== subId) }
        : p
    );
    persistCategories(updated);
    if (activeSubId === subId) {
      setActiveSubId(null);
      setKeywords([]);
      setResults([]);
    }
  }

  const activeParent = categories.find((p) => p.id === activeParentId);
  const activeSub = activeParent?.subcategories.find((s) => s.id === activeSubId);
  const hasKeywords = keywords.length > 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">소싱 캘린더</h1>

      {fallback && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm px-4 py-2 rounded">
          ANTHROPIC_API_KEY 없이 Naver 자동완성만으로 추천했습니다.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded">
          {error}
        </div>
      )}

      {/* 대분류 탭 */}
      <div className="flex gap-1 border-b border-gray-200 pb-0 flex-wrap">
        {categories.map((parent) => (
          <button
            key={parent.id}
            onClick={() => selectParent(parent.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeParentId === parent.id
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {parent.name}
          </button>
        ))}
      </div>

      {/* 소분류 그리드 */}
      {activeParent && (
        <div className="flex flex-wrap gap-2 items-center">
          {activeParent.subcategories.map((sub) => (
            <div key={sub.id} className="relative group">
              <button
                onClick={() => selectSub(sub)}
                className={`px-4 py-2 rounded border text-sm font-medium transition-colors ${
                  activeSubId === sub.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                }`}
              >
                {sub.name}
              </button>
              <button
                onClick={() => deleteSubcategory(activeParent.id, sub.id)}
                className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 bg-red-500 text-white rounded-full text-xs items-center justify-center leading-none"
              >
                ×
              </button>
            </div>
          ))}
          {editingParentId === activeParent.id ? (
            <div className="flex gap-1 items-center">
              <input
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSubcategory(activeParent.id)}
                placeholder="소분류명"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24 focus:outline-none focus:border-blue-400"
                autoFocus
              />
              <button
                onClick={() => addSubcategory(activeParent.id)}
                className="px-2 py-1.5 bg-blue-600 text-white text-sm rounded"
              >
                추가
              </button>
              <button
                onClick={() => { setEditingParentId(null); setNewSubName(''); }}
                className="px-2 py-1.5 text-gray-500 text-sm"
              >
                취소
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingParentId(activeParent.id)}
              className="px-3 py-2 border border-dashed border-gray-300 rounded text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
            >
              + 추가
            </button>
          )}
        </div>
      )}

      {/* 키워드 패널 */}
      {activeSub ? (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm text-gray-500 font-medium">
              {activeParent?.name} &gt; {activeSub.name}
            </span>
            <div className="flex gap-2 flex-wrap">
              {!hasKeywords ? (
                <button
                  onClick={() => handleRecommend(false)}
                  disabled={recommendLoading}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {recommendLoading ? '추천 중...' : '추천받기'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleRecommend(true)}
                    disabled={recommendLoading}
                    className="px-3 py-1.5 border border-gray-300 text-gray-600 text-sm rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    {recommendLoading ? '추천 중...' : '새로 추천받기'}
                  </button>
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzeLoading || keywords.length === 0}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {analyzeLoading ? '분석 중...' : '분석하기'}
                  </button>
                </>
              )}
            </div>
          </div>

          {recommendedAt && (
            <p className="text-xs text-gray-400">
              마지막 추천: {new Date(recommendedAt).toLocaleString('ko-KR')}
            </p>
          )}

          {/* 추천 키워드 (분석 전 미리보기) */}
          {hasKeywords && results.length === 0 && !analyzeLoading && (
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((kw) => (
                <span key={kw} className="px-2 py-1 bg-blue-50 text-blue-700 text-sm rounded">
                  {kw}
                </span>
              ))}
            </div>
          )}

          {analyzeLoading && (
            <p className="text-sm text-gray-500">
              계절 점수 분석 중... (키워드 수에 따라 최대 30초 소요)
            </p>
          )}

          {/* 결과 테이블 */}
          {results.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-4 font-medium">키워드</th>
                      <th className="py-2 pr-4 font-medium text-right">점수</th>
                      <th className="py-2 pr-4 font-medium text-center">★</th>
                      <th className="py-2 pr-4 font-medium text-right">YoY</th>
                      <th className="py-2 font-medium text-center">트렌드</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((item) => (
                      <tr key={item.keyword} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 pr-4 font-medium text-gray-900">
                          {item.keyword}
                          {item.error && (
                            <span className="ml-1 text-xs text-red-400">({item.error})</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-700">
                          {item.error ? '—' : item.predicted}
                        </td>
                        <td className="py-2 pr-4 text-center">
                          {item.error ? '—' : <StarDisplay stars={item.stars} />}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {item.error ? '—' : <YoYBadge value={item.yoyGrowth} />}
                        </td>
                        <td className="py-2 text-center">
                          {item.sparkline?.length >= 2 ? (
                            <Sparkline data={item.sparkline} />
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analyzedAt && (
                <p className="text-xs text-gray-400">
                  마지막 분석: {new Date(analyzedAt).toLocaleString('ko-KR')}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-center py-10 text-gray-400 text-sm">
          소분류를 선택하면 AI가 소싱 키워드를 추천합니다.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 전체 테스트 실행 — 회귀 없는지 확인**

```bash
cd ~/Desktop/projects/sourcing-validator
npm test
```

Expected: 전체 테스트 PASS (TypeScript 컴파일 에러 없음).

- [ ] **Step 3: 개발 서버 실행 후 수동 검증**

```bash
cd ~/Desktop/projects/sourcing-validator
npm run dev
```

브라우저에서 `http://localhost:3001/calendar` 접속. 다음을 확인한다:
- 대분류 탭 6개(잡화/뷰티/생활용품/패션잡화/스포츠/식품) 표시
- 잡화 탭 클릭 → 소분류 그리드(텀블러/머그컵/물병...) 표시
- 텀블러 클릭 → 키워드 패널 표시 + "추천받기" 버튼 표시
- ".env.local에 ANTHROPIC_API_KEY 설정 시" "추천받기" → 키워드 8개 표시
- "분석하기" → 계절 점수 테이블 표시 (별/YoY/스파크라인)
- 소분류 다시 클릭 → localStorage 캐시에서 즉시 로드
- "새로 추천받기" 버튼 동작 확인
- `+ 추가` 버튼 → 소분류 추가 → localStorage 저장 확인
- 소분류 호버 → `×` 버튼 → 삭제 확인

- [ ] **Step 4: 커밋**

```bash
cd ~/Desktop/projects/sourcing-validator
git add src/app/calendar/page.tsx
git commit -m "feat: 소싱 캘린더 V2 UI 전면 재작성 (2-depth 카테고리 + AI 키워드 추천)"
```
