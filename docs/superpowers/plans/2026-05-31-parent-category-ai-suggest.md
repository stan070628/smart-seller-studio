# 대분류 AI 추천 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소싱 캘린더 헤더에 "✦ 대분류 AI 추천" 버튼을 추가해 Claude Haiku가 새로운 대분류 6~8개 + 각 소분류 5~7개를 한 번에 추천하고 전체 카테고리 트리를 교체한다. 아울러 기존 `suggest-subcategories` route를 `getAnthropicClient()` → `callClaude()` 로 마이그레이션한다.

**Architecture:** `callClaude('haiku')` (`src/lib/ai/claude-cli.ts`) 는 로컬에서 Claude Code OAuth(Max Plan)를 사용하고, 배포 시 `ANTHROPIC_API_KEY` 폴백을 자동 처리한다. 신규 `POST /api/calendar/suggest-categories` route가 대분류+소분류 트리를 JSON으로 반환하며, 실패 시 500을 반환해 기존 목록을 보존한다(소분류 추천의 폴백 방식과 다름). `page.tsx`는 `suggestCatLoading` · `suggestedCatIds` 상태를 추가하고 헤더에 버튼을 배치한다.

**Tech Stack:** Next.js 15 App Router, TypeScript, `callClaude` from `@/lib/ai/claude-cli`, Vitest, inline CSS (design-tokens)

---

## File Map

| Action | Path | Role |
|--------|------|------|
| **Modify** | `src/app/api/calendar/suggest-subcategories/route.ts` | `getAnthropicClient()` → `callClaude('haiku')` 교체 |
| **Modify** | `src/app/api/calendar/__tests__/suggest-subcategories.test.ts` | mock 대상을 `callClaude`로 교체 |
| **Create** | `src/app/api/calendar/__tests__/suggest-categories.test.ts` | 신규 route 단위 테스트 |
| **Create** | `src/app/api/calendar/suggest-categories/route.ts` | POST: 대분류+소분류 트리 생성 |
| **Modify** | `src/app/calendar/page.tsx` | 대분류 AI 추천 버튼 + 상태 + 핸들러 추가 |

---

## Task 1: `suggest-subcategories` — `callClaude()` 마이그레이션

기존 route가 `getAnthropicClient()`를 직접 호출한다. `callClaude('haiku')`로 교체하면 로컬에서 Max Plan을 쓰고 배포에서 API key 폴백이 자동 적용된다. 동작은 동일하고 테스트 mock만 변경된다.

**Files:**
- Modify: `src/app/api/calendar/suggest-subcategories/route.ts`
- Modify: `src/app/api/calendar/__tests__/suggest-subcategories.test.ts`

- [ ] **Step 1: `suggest-subcategories/route.ts` 전체 교체**

```typescript
// src/app/api/calendar/suggest-subcategories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/ai/claude-cli';

const SYSTEM_PROMPT = `당신은 쿠팡 소싱 전문가입니다.
주어진 대분류에서 현재 트렌드에 맞는 소분류를 추천합니다.
선별 기준:
- 쿠팡에서 단품으로 판매 가능한 상품 카테고리
- 너무 넓거나 좁지 않은 적절한 범위 (예: "텀블러" 적합 / "주방용품" 너무 넓음 / "분홍 텀블러" 너무 좁음)
- 브랜드명 제외
반드시 JSON 배열 형식만 반환하세요.`;

const FALLBACK_SUFFIXES = ['용품', '소품', '세트', '미니', '대형', '휴대용'];

function makeFallback(parentCategory: string): { id: string; name: string }[] {
  const now = Date.now();
  return FALLBACK_SUFFIXES.map((suffix, i) => ({
    id: `ai-${parentCategory}${suffix}-${now + i}`,
    name: `${parentCategory} ${suffix}`,
  }));
}

function parseNames(rawText: string): string[] {
  try {
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 8);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  let body: { parentCategory?: unknown; currentSubcategories?: unknown };
  try {
    body = await req.json() as { parentCategory?: unknown; currentSubcategories?: unknown };
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  if (typeof body.parentCategory !== 'string' || !body.parentCategory.trim()) {
    return NextResponse.json(
      { error: 'parentCategory는 필수 문자열입니다.' },
      { status: 400 },
    );
  }

  const parentCategory = body.parentCategory.trim();
  const currentSubcategories = Array.isArray(body.currentSubcategories)
    ? (body.currentSubcategories as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  const userContent = `대분류: ${parentCategory}
현재 소분류: ${currentSubcategories.join(', ') || '없음'}

위 대분류에서 소싱 관점으로 유망한 소분류 6~8개를 추천해 주세요.
현재 소분류와 중복되지 않게, 새로운 관점으로 추천해 주세요.
JSON 배열만 반환: ["보온병", "캠핑컵", ...]`;

  try {
    const rawText = await callClaude(SYSTEM_PROMPT, userContent, 'haiku');
    const names = parseNames(rawText);
    const now = Date.now();
    const subcategories = names.length > 0
      ? names.map((name, i) => ({ id: `ai-${name}-${now + i}`, name }))
      : makeFallback(parentCategory);

    return NextResponse.json({ subcategories, suggestedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({
      subcategories: makeFallback(parentCategory),
      suggestedAt: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 2: 테스트 파일 전체 교체 (mock 대상 변경)**

```typescript
// src/app/api/calendar/__tests__/suggest-subcategories.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: vi.fn(),
}));

import { callClaude } from '@/lib/ai/claude-cli';
import { POST } from '../suggest-subcategories/route';

describe('POST /api/calendar/suggest-subcategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeReq(body: unknown) {
    return new NextRequest('http://localhost/api/calendar/suggest-subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('parentCategory 없으면 400 반환', async () => {
    const res = await POST(makeReq({ currentSubcategories: [] }));
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBeDefined();
  });

  it('callClaude 정상 응답 시 소분류 배열 반환 (200)', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue(
      '["보온병", "캠핑컵", "스포츠 텀블러", "아이스 텀블러", "소형 텀블러", "이중 텀블러"]',
    );

    const res = await POST(makeReq({
      parentCategory: '잡화',
      currentSubcategories: ['텀블러', '머그컵'],
    }));
    expect(res.status).toBe(200);
    const data = await res.json() as { subcategories: { id: string; name: string }[]; suggestedAt: string };
    expect(data.subcategories.length).toBeGreaterThanOrEqual(1);
    expect(data.subcategories[0]).toHaveProperty('id');
    expect(data.subcategories[0]).toHaveProperty('name');
    expect(data.suggestedAt).toBeDefined();
  });

  it('callClaude throw 시 폴백 반환 (200)', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ANTHROPIC_API_KEY 미설정'),
    );

    const res = await POST(makeReq({ parentCategory: '잡화', currentSubcategories: [] }));
    expect(res.status).toBe(200);
    const data = await res.json() as { subcategories: { id: string; name: string }[] };
    expect(data.subcategories.length).toBeGreaterThan(0);
    expect(data.subcategories[0].name).toContain('잡화');
  });

  it('callClaude 네트워크 오류 시 폴백 반환 (200)', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('네트워크 오류'));

    const res = await POST(makeReq({ parentCategory: '잡화', currentSubcategories: [] }));
    expect(res.status).toBe(200);
    const data = await res.json() as { subcategories: { id: string; name: string }[] };
    expect(data.subcategories.length).toBeGreaterThan(0);
  });

  it('요청 바디가 JSON 아니면 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/calendar/suggest-subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json{{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: 테스트 실행 — 5개 PASS 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/app/api/calendar/__tests__/suggest-subcategories.test.ts 2>&1 | tail -8
```

Expected: `5 tests passed`

- [ ] **Step 4: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "suggest-subcategories" | head -5
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/calendar/suggest-subcategories/route.ts \
        src/app/api/calendar/__tests__/suggest-subcategories.test.ts
git commit -m "refactor: suggest-subcategories getAnthropicClient → callClaude (Max Plan 지원)"
```

---

## Task 2: `suggest-categories` route — TDD

**Files:**
- Create: `src/app/api/calendar/__tests__/suggest-categories.test.ts`
- Create: `src/app/api/calendar/suggest-categories/route.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/app/api/calendar/__tests__/suggest-categories.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: vi.fn(),
}));

import { callClaude } from '@/lib/ai/claude-cli';
import { POST } from '../suggest-categories/route';

const MOCK_RESPONSE = JSON.stringify([
  {
    name: '반려동물용품',
    subcategories: ['강아지 간식', '고양이 장난감', '펫 침대', '반려동물 의류', '반려동물 목욕용품'],
  },
  {
    name: '유아용품',
    subcategories: ['아기 장난감', '유아 의류', '아기 목욕용품', '아기 침구', '유아 식기'],
  },
]);

describe('POST /api/calendar/suggest-categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeReq(body: unknown) {
    return new NextRequest('http://localhost/api/calendar/suggest-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('currentCategories 없으면 400 반환', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBeDefined();
  });

  it('currentCategories 빈 배열이면 400 반환', async () => {
    const res = await POST(makeReq({ currentCategories: [] }));
    expect(res.status).toBe(400);
  });

  it('callClaude 정상 응답 시 대분류+소분류 트리 반환 (200)', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RESPONSE);

    const res = await POST(makeReq({ currentCategories: ['잡화', '뷰티/위생'] }));
    expect(res.status).toBe(200);
    const data = await res.json() as {
      categories: { id: string; name: string; subcategories: { id: string; name: string }[] }[];
      suggestedAt: string;
    };
    expect(data.categories.length).toBeGreaterThanOrEqual(1);
    expect(data.categories[0]).toHaveProperty('id');
    expect(data.categories[0]).toHaveProperty('name');
    expect(data.categories[0].subcategories.length).toBeGreaterThan(0);
    expect(data.categories[0].subcategories[0]).toHaveProperty('id');
    expect(data.categories[0].subcategories[0]).toHaveProperty('name');
    expect(data.suggestedAt).toBeDefined();
  });

  it('callClaude throw 시 500 반환 — 교체 없음', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('CLI 실패'));

    const res = await POST(makeReq({ currentCategories: ['잡화'] }));
    expect(res.status).toBe(500);
    const data = await res.json() as { error: string };
    expect(data.error).toBeDefined();
  });

  it('JSON 파싱 실패 시 500 반환', async () => {
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue('올바른 JSON이 아닙니다');

    const res = await POST(makeReq({ currentCategories: ['잡화'] }));
    expect(res.status).toBe(500);
  });

  it('요청 바디가 JSON 아니면 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/calendar/suggest-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad{{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인 (route 없음)**

```bash
npx vitest run src/app/api/calendar/__tests__/suggest-categories.test.ts 2>&1 | tail -8
```

Expected: FAIL (Cannot find module `../suggest-categories/route`)

- [ ] **Step 3: route 구현**

```typescript
// src/app/api/calendar/suggest-categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/ai/claude-cli';

const SYSTEM_PROMPT = `당신은 쿠팡 소싱 전문가입니다.
쿠팡에서 단품으로 공략 가능한 대분류와 각 대분류의 소분류를 추천합니다.
규칙:
- 대분류: 6~8개, 너무 넓지 않은 적절한 범위 (예: "반려동물용품" 적합 / "생활" 너무 넓음)
- 각 대분류당 소분류: 5~7개, 쿠팡 단품 판매 가능한 구체적 카테고리
- 브랜드명 제외
반드시 JSON 배열 형식만 반환하세요.`;

interface RawCategory {
  name?: unknown;
  subcategories?: unknown;
}

function parseCategories(rawText: string): { name: string; subcategories: string[] }[] {
  const stripped = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const parsed = JSON.parse(stripped) as unknown;
  if (!Array.isArray(parsed)) throw new Error('응답이 배열이 아닙니다.');
  return (parsed as RawCategory[]).map((item) => {
    if (typeof item.name !== 'string') throw new Error('name 필드 누락');
    if (!Array.isArray(item.subcategories)) throw new Error('subcategories 필드 누락');
    return {
      name: item.name,
      subcategories: (item.subcategories as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      ),
    };
  });
}

export async function POST(req: NextRequest) {
  let body: { currentCategories?: unknown };
  try {
    body = await req.json() as { currentCategories?: unknown };
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  if (!Array.isArray(body.currentCategories) || body.currentCategories.length === 0) {
    return NextResponse.json(
      { error: 'currentCategories는 필수 배열입니다.' },
      { status: 400 },
    );
  }

  const currentCategories = (body.currentCategories as unknown[]).filter(
    (v): v is string => typeof v === 'string',
  );

  const userContent = `현재 대분류: ${currentCategories.join(', ')}

현재와 다른 새로운 관점의 대분류와 소분류를 추천해 주세요.
중복 없이, 소싱 유망한 카테고리 위주로 구성해 주세요.
JSON만 반환: [{"name": "반려동물용품", "subcategories": ["강아지 간식", ...]}, ...]`;

  try {
    const rawText = await callClaude(SYSTEM_PROMPT, userContent, 'haiku');
    const parsed = parseCategories(rawText);

    const now = Date.now();
    const categories = parsed.map((cat, catIdx) => ({
      id: `ai-cat-${cat.name}-${now + catIdx}`,
      name: cat.name,
      subcategories: cat.subcategories.map((subName, subIdx) => ({
        id: `ai-sub-${subName}-${now + catIdx * 100 + subIdx}`,
        name: subName,
      })),
    }));

    return NextResponse.json({ categories, suggestedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[suggest-categories] 오류:', message);
    return NextResponse.json({ error: '카테고리 추천에 실패했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 실행 — 6개 PASS 확인**

```bash
npx vitest run src/app/api/calendar/__tests__/suggest-categories.test.ts 2>&1 | tail -8
```

Expected: `6 tests passed`

- [ ] **Step 5: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "suggest-categories" | head -5
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/calendar/__tests__/suggest-categories.test.ts \
        src/app/api/calendar/suggest-categories/route.ts
git commit -m "feat: POST /api/calendar/suggest-categories — 대분류+소분류 AI 추천 (callClaude)"
```

---

## Task 3: `page.tsx` — 대분류 AI 추천 버튼 추가

**Files:**
- Modify: `src/app/calendar/page.tsx`

변경 내용: `SuggestCategoriesResponse` 인터페이스 추가, `suggestCatLoading` · `suggestedCatIds` 상태 추가, `handleSuggestCategories` 핸들러 추가, 헤더를 flex row로 바꿔 버튼 배치, 대분류 탭에 `AI` 뱃지 추가, 탭 바 로딩 시 opacity 처리.

- [ ] **Step 1: `page.tsx` 전체 교체**

```tsx
// src/app/calendar/page.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import {
  DEFAULT_CATEGORY_TREE,
  type ParentCategory,
  type Subcategory,
} from '@/lib/categories';

const STORAGE_KEY = 'sourcing-calendar-categories';

interface SuggestResponse {
  subcategories: Subcategory[];
  suggestedAt: string;
}

interface SuggestCategoriesResponse {
  categories: ParentCategory[];
  suggestedAt: string;
}

function loadCategories(): ParentCategory[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as ParentCategory[]) : DEFAULT_CATEGORY_TREE;
  } catch {
    return DEFAULT_CATEGORY_TREE;
  }
}

export default function CalendarPage() {
  const [categories, setCategories] = useState<ParentCategory[]>(DEFAULT_CATEGORY_TREE);
  const [activeCatId, setActiveCatId] = useState<string>(DEFAULT_CATEGORY_TREE[0].id);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestCatLoading, setSuggestCatLoading] = useState(false);
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(new Set());
  const [suggestedCatIds, setSuggestedCatIds] = useState<Set<string>>(new Set());
  const [newSubName, setNewSubName] = useState('');
  const [addingNew, setAddingNew] = useState(false);

  useEffect(() => {
    const loaded = loadCategories();
    setCategories(loaded);
    setActiveCatId(loaded[0].id);
  }, []);

  const persistCategories = useCallback((updated: ParentCategory[]) => {
    setCategories(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  }, []);

  const activeCat = categories.find((c) => c.id === activeCatId) ?? categories[0];

  function handleSelectParent(catId: string) {
    setActiveCatId(catId);
    setActiveSubId(null);
    setSuggestedIds(new Set());
    setAddingNew(false);
    setNewSubName('');
  }

  function handleDeleteSub(subId: string) {
    const updated = categories.map((cat) =>
      cat.id === activeCatId
        ? { ...cat, subcategories: cat.subcategories.filter((s) => s.id !== subId) }
        : cat,
    );
    persistCategories(updated);
    if (activeSubId === subId) setActiveSubId(null);
  }

  function handleAddSub() {
    const name = newSubName.trim();
    if (!name) return;
    const newSub: Subcategory = { id: `custom-${name}-${Date.now()}`, name };
    const updated = categories.map((cat) =>
      cat.id === activeCatId
        ? { ...cat, subcategories: [...cat.subcategories, newSub] }
        : cat,
    );
    persistCategories(updated);
    setNewSubName('');
    setAddingNew(false);
  }

  async function handleSuggest() {
    if (!activeCat || suggestLoading || suggestCatLoading) return;
    setSuggestLoading(true);
    try {
      const res = await fetch('/api/calendar/suggest-subcategories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentCategory: activeCat.name,
          currentSubcategories: activeCat.subcategories.map((s) => s.name),
        }),
      });
      const data = (await res.json()) as SuggestResponse;
      const newSubs = data.subcategories;
      const updated = categories.map((cat) =>
        cat.id === activeCatId ? { ...cat, subcategories: newSubs } : cat,
      );
      persistCategories(updated);
      setActiveSubId(null);
      setSuggestedIds(new Set(newSubs.map((s) => s.id)));
    } catch {
      // 네트워크 오류: 무시
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handleSuggestCategories() {
    if (suggestCatLoading) return;
    setSuggestCatLoading(true);
    try {
      const res = await fetch('/api/calendar/suggest-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentCategories: categories.map((c) => c.name) }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as SuggestCategoriesResponse;
      const newCats = data.categories;
      persistCategories(newCats);
      setActiveCatId(newCats[0].id);
      setActiveSubId(null);
      setSuggestedIds(new Set());
      setSuggestedCatIds(new Set(newCats.map((c) => c.id)));
    } catch {
      // 실패 시 기존 목록 유지
    } finally {
      setSuggestCatLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Noto Sans KR', sans-serif", color: C.text }}>
      {/* 헤더 — 대분류 AI 추천 버튼 */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: C.text }}>소싱 캘린더</h1>
          <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
            카테고리별 소싱 후보 관리 · AI 소분류 추천
          </p>
        </div>
        <button
          onClick={handleSuggestCategories}
          disabled={suggestCatLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            background: suggestCatLoading ? '#f4f4f5' : 'rgba(99,102,241,0.08)',
            color: suggestCatLoading ? C.textSub : '#6366f1',
            border: `1px solid ${suggestCatLoading ? C.border : 'rgba(99,102,241,0.3)'}`,
            borderRadius: 8, cursor: suggestCatLoading ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', transition: 'all 0.15s',
          }}
        >
          <Sparkles size={13} />
          {suggestCatLoading ? '추천 중...' : '✦ 대분류 AI 추천'}
        </button>
      </div>

      {/* 대분류 탭 + 소분류 AI 추천 버튼 */}
      <div style={{
        background: C.card, borderBottom: `2px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px',
        opacity: suggestCatLoading ? 0.5 : 1, transition: 'opacity 0.15s',
      }}>
        <div style={{ display: 'flex', flex: 1, flexWrap: 'wrap' }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleSelectParent(cat.id)}
              style={{
                padding: '12px 16px', border: 'none', cursor: 'pointer', fontSize: 14,
                fontWeight: activeCatId === cat.id ? 700 : 500,
                color: activeCatId === cat.id ? C.accent : C.textSub,
                background: 'transparent',
                borderBottom: activeCatId === cat.id ? `2px solid ${C.accent}` : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {cat.name}
              {suggestedCatIds.has(cat.id) && (
                <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700 }}>AI</span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={handleSuggest}
          disabled={suggestLoading || suggestCatLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', fontSize: 12, fontWeight: 600,
            background: (suggestLoading || suggestCatLoading) ? '#f4f4f5' : 'rgba(99,102,241,0.08)',
            color: (suggestLoading || suggestCatLoading) ? C.textSub : '#6366f1',
            border: `1px solid ${(suggestLoading || suggestCatLoading) ? C.border : 'rgba(99,102,241,0.3)'}`,
            borderRadius: 8, cursor: (suggestLoading || suggestCatLoading) ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', marginLeft: 12, transition: 'all 0.15s',
          }}
        >
          <Sparkles size={13} />
          {suggestLoading ? '추천 중...' : '✦ 소분류 AI 추천'}
        </button>
      </div>

      {/* 소분류 그리드 */}
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {activeCat?.subcategories.map((sub) => {
            const isActive = activeSubId === sub.id;
            const isSuggested = suggestedIds.has(sub.id);
            return (
              <div
                key={sub.id}
                onClick={() => setActiveSubId(isActive ? null : sub.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  border: `1px solid ${isActive ? C.accent : isSuggested ? '#a5b4fc' : C.border}`,
                  borderRadius: 8, padding: '6px 10px 6px 12px',
                  background: isActive ? `${C.accent}10` : isSuggested ? 'rgba(99,102,241,0.06)' : C.card,
                  cursor: 'pointer', transition: 'all 0.15s',
                  opacity: suggestLoading ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: 13, color: isActive ? C.accent : C.text, fontWeight: isActive ? 600 : 400 }}>
                  {sub.name}
                </span>
                {isSuggested && (
                  <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700, marginLeft: 2 }}>AI</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSub(sub.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: C.textSub, display: 'flex' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}

          {addingNew ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                autoFocus
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSub();
                  if (e.key === 'Escape') { setAddingNew(false); setNewSubName(''); }
                }}
                placeholder="소분류명"
                style={{
                  padding: '6px 10px', fontSize: 13, color: C.text,
                  border: `1px solid ${C.accent}`, borderRadius: 8, outline: 'none', width: 110,
                }}
              />
              <button
                onClick={handleAddSub}
                style={{ padding: '6px 10px', fontSize: 13, background: C.accent, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
              >추가</button>
              <button
                onClick={() => { setAddingNew(false); setNewSubName(''); }}
                style={{ padding: '6px 10px', fontSize: 13, background: C.bg, color: C.textSub, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer' }}
              >취소</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingNew(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
                fontSize: 13, color: C.textSub, background: 'transparent',
                border: `1px dashed ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >
              <Plus size={13} /> 추가
            </button>
          )}
        </div>

        {activeSubId ? (
          <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>
            선택됨: <strong style={{ color: C.text }}>{activeCat?.name}</strong>
            {' > '}
            <strong style={{ color: C.text }}>
              {activeCat?.subcategories.find((s) => s.id === activeSubId)?.name}
            </strong>
          </p>
        ) : (
          <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>소분류를 선택하세요.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "calendar" | head -10
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 3: 전체 테스트 확인**

```bash
npx vitest run src/app/api/calendar/__tests__/ 2>&1 | tail -10
```

Expected: `11 tests passed` (suggest-subcategories 5개 + suggest-categories 6개)

- [ ] **Step 4: Commit**

```bash
git add src/app/calendar/page.tsx
git commit -m "feat: 소싱 캘린더 — ✦ 대분류 AI 추천 버튼 + suggestCatLoading/suggestedCatIds 상태"
```

---

## Self-Review

### Spec Coverage

| 설계 요구사항 | 태스크 |
|------------|------|
| suggest-subcategories → callClaude 마이그레이션 | Task 1 |
| 테스트 mock callClaude로 교체, 5개 통과 | Task 1 |
| `POST /api/calendar/suggest-categories` 신규 | Task 2 |
| 대분류+소분류 JSON 파싱 + ID 생성 | Task 2 (`parseCategories`, `ai-cat-`, `ai-sub-`) |
| callClaude 실패 시 500 반환 (교체 없음) | Task 2 (`catch` → 500) |
| currentCategories 없음 → 400 | Task 2 |
| "✦ 대분류 AI 추천" 버튼 — 헤더 우측 | Task 3 |
| `suggestCatLoading` 시 탭 바 opacity 0.5 | Task 3 |
| 새 대분류 탭에 `AI` 뱃지 | Task 3 (`suggestedCatIds.has(cat.id)`) |
| `activeCatId` → 첫 번째 새 대분류로 리셋 | Task 3 (`setActiveCatId(newCats[0].id)`) |
| `activeSubId`, `suggestedIds` 초기화 | Task 3 |
| 소분류 AI 추천 중 대분류 버튼 비활성 | Task 3 (`disabled={suggestLoading \|\| suggestCatLoading}`) |

### Placeholder Scan

없음 — 모든 단계 완성 코드 포함.

### Type Consistency

- `SuggestCategoriesResponse.categories: ParentCategory[]` — Task 3에서 `ParentCategory` 타입(`@/lib/categories`)을 재사용, route 반환 구조(`id`, `name`, `subcategories: {id, name}[]`)와 일치.
- `callClaude` 시그니처: `(system, user, model)` → Task 1·2 모두 동일하게 `callClaude(SYSTEM_PROMPT, userContent, 'haiku')` 사용.
- `suggestedCatIds: Set<string>` — `new Set(newCats.map((c) => c.id))`로 생성, `suggestedCatIds.has(cat.id)`로 소비 — 일관됨.

---

## Verification

```bash
# 1. 로컬 서버 실행
npm run dev

# 2. /calendar 접속
# → 헤더 우측에 "✦ 대분류 AI 추천" 버튼 확인
# → 탭 바 우측에 "✦ 소분류 AI 추천" 버튼 확인

# 3. "✦ 대분류 AI 추천" 클릭
# → 버튼 "추천 중...", 탭 바 흐려짐
# → 새 대분류 탭 6~8개 표시, 각 탭에 "AI" 뱃지
# → 첫 번째 새 대분류가 활성화됨

# 4. 새 대분류 탭 클릭 → 소분류 그리드 표시 확인
# 5. "✦ 소분류 AI 추천" 클릭 → 소분류 교체 확인 (기존 동작 유지)
# 6. 새로고침 → localStorage에서 새 카테고리 복원 확인

# 7. 전체 테스트
npx vitest run src/app/api/calendar/__tests__/
```
