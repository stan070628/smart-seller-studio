# 소분류 AI 추천 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소싱 캘린더 페이지에 "✦ 소분류 AI 추천" 버튼을 추가해, 대분류 기반으로 Claude Haiku가 소싱 유망 소분류 6~8개를 추천하고 현재 소분류 목록을 교체한다.

**Architecture:** `src/lib/categories.ts`에 2-depth 카테고리 트리(타입+데이터)를 정의한다. `POST /api/calendar/suggest-subcategories`가 Claude Haiku를 호출하여 소분류 이름 배열을 반환한다. 소싱 캘린더 페이지(`src/app/calendar/page.tsx`)는 카테고리 탭 + 소분류 그리드 + AI 추천 버튼을 렌더링하며, 추천 결과를 localStorage에 저장한다. API 키 없거나 Claude 오류 시 접미어 조합 폴백으로 200 응답한다.

**Tech Stack:** Next.js 15 App Router, TypeScript, Anthropic SDK (`getAnthropicClient` 싱글톤), Vitest, inline CSS (design-tokens)

---

## File Map

| Action | Path | Role |
|--------|------|------|
| **Create** | `src/lib/categories.ts` | `Subcategory` · `ParentCategory` 타입 + `DEFAULT_CATEGORY_TREE` (6개 대분류) |
| **Create** | `src/app/api/calendar/__tests__/suggest-subcategories.test.ts` | API route 단위 테스트 (TDD) |
| **Create** | `src/app/api/calendar/suggest-subcategories/route.ts` | POST 핸들러: Claude Haiku 호출 + 폴백 |
| **Create** | `src/app/calendar/page.tsx` | 소싱 캘린더 페이지: 대분류 탭 + 소분류 그리드 + AI 추천 버튼 |

---

## Task 1: `src/lib/categories.ts` — 타입 + 기본 카테고리 트리

**Files:**
- Create: `src/lib/categories.ts`

- [ ] **Step 1: 파일 생성**

```typescript
// src/lib/categories.ts

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

- [ ] **Step 2: TypeScript 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep "categories" | head -10
```

Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/lib/categories.ts
git commit -m "feat: categories.ts — 2-depth 카테고리 트리 타입 + 기본 데이터 6개 대분류"
```

---

## Task 2: API Route — 테스트 먼저 (TDD)

**Files:**
- Create: `src/app/api/calendar/__tests__/suggest-subcategories.test.ts`

- [ ] **Step 1: `__tests__` 디렉터리 확인**

```bash
mkdir -p /Users/seungminlee/Desktop/projects/smart_seller_studio/src/app/api/calendar/__tests__
```

Expected: 디렉터리 생성 (이미 있으면 무시)

- [ ] **Step 2: 실패 테스트 작성**

```typescript
// src/app/api/calendar/__tests__/suggest-subcategories.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn(),
}));

import { getAnthropicClient } from '@/lib/ai/claude';
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

  it('Claude 정상 응답 시 소분류 배열 반환 (200)', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '["보온병", "캠핑컵", "스포츠 텀블러", "아이스 텀블러", "소형 텀블러", "이중 텀블러"]' }],
    });
    (getAnthropicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      messages: { create: mockCreate },
    });

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

  it('ANTHROPIC_API_KEY 없어서 getAnthropicClient throw 시 폴백 반환 (200)', async () => {
    (getAnthropicClient as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다');
    });

    const res = await POST(makeReq({
      parentCategory: '잡화',
      currentSubcategories: [],
    }));
    expect(res.status).toBe(200);
    const data = await res.json() as { subcategories: { id: string; name: string }[] };
    expect(data.subcategories.length).toBeGreaterThan(0);
    expect(data.subcategories[0].name).toContain('잡화');
  });

  it('Claude API 호출 실패 시 폴백 반환 (200)', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('네트워크 오류'));
    (getAnthropicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      messages: { create: mockCreate },
    });

    const res = await POST(makeReq({
      parentCategory: '잡화',
      currentSubcategories: [],
    }));
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

- [ ] **Step 3: 테스트 실행 — FAIL 확인 (파일 없음)**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/app/api/calendar/__tests__/suggest-subcategories.test.ts 2>&1 | tail -10
```

Expected: `Cannot find module '../suggest-subcategories/route'` 또는 FAIL

---

## Task 3: API Route 구현

**Files:**
- Create: `src/app/api/calendar/suggest-subcategories/route.ts`

- [ ] **Step 1: 파일 생성**

```typescript
// src/app/api/calendar/suggest-subcategories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude';

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
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const rawText = (message.content[0] as { type: string; text: string }).text;
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

- [ ] **Step 2: 테스트 실행 — PASS 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/app/api/calendar/__tests__/suggest-subcategories.test.ts 2>&1 | tail -15
```

Expected: `5 tests passed`

- [ ] **Step 3: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "suggest-subcategories\|calendar" | head -10
```

Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/app/api/calendar/__tests__/suggest-subcategories.test.ts src/app/api/calendar/suggest-subcategories/route.ts
git commit -m "feat: POST /api/calendar/suggest-subcategories — Claude Haiku 소분류 추천 + 폴백"
```

---

## Task 4: 소싱 캘린더 페이지

**Files:**
- Create: `src/app/calendar/page.tsx`

- [ ] **Step 1: 디렉터리 생성**

```bash
mkdir -p /Users/seungminlee/Desktop/projects/smart_seller_studio/src/app/calendar
```

- [ ] **Step 2: 파일 생성**

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
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(new Set());
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
    if (!activeCat || suggestLoading) return;
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

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Noto Sans KR', sans-serif", color: C.text }}>
      {/* 헤더 */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '16px 24px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: C.text }}>소싱 캘린더</h1>
        <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
          카테고리별 소싱 후보 관리 · AI 소분류 추천
        </p>
      </div>

      {/* 대분류 탭 + AI 추천 버튼 */}
      <div style={{
        background: C.card, borderBottom: `2px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px',
      }}>
        <div style={{ display: 'flex', flex: 1, flexWrap: 'wrap' }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleSelectParent(cat.id)}
              style={{
                padding: '12px 20px', border: 'none', cursor: 'pointer', fontSize: 14,
                fontWeight: activeCatId === cat.id ? 700 : 500,
                color: activeCatId === cat.id ? C.accent : C.textSub,
                background: 'transparent',
                borderBottom: activeCatId === cat.id ? `2px solid ${C.accent}` : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.15s',
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <button
          onClick={handleSuggest}
          disabled={suggestLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', fontSize: 12, fontWeight: 600,
            background: suggestLoading ? '#f4f4f5' : 'rgba(99,102,241,0.08)',
            color: suggestLoading ? C.textSub : '#6366f1',
            border: `1px solid ${suggestLoading ? C.border : 'rgba(99,102,241,0.3)'}`,
            borderRadius: 8, cursor: suggestLoading ? 'not-allowed' : 'pointer',
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
                <span style={{
                  fontSize: 13,
                  color: isActive ? C.accent : C.text,
                  fontWeight: isActive ? 600 : 400,
                }}>
                  {sub.name}
                </span>
                {isSuggested && (
                  <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700, marginLeft: 2 }}>AI</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSub(sub.id); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 2, color: C.textSub, display: 'flex',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}

          {/* 소분류 추가 */}
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
                style={{
                  padding: '6px 10px', fontSize: 13, background: C.accent,
                  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
                }}
              >추가</button>
              <button
                onClick={() => { setAddingNew(false); setNewSubName(''); }}
                style={{
                  padding: '6px 10px', fontSize: 13, background: C.bg, color: C.textSub,
                  border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
                }}
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

        {/* 선택 안내 */}
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

- [ ] **Step 3: TypeScript 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep "calendar" | head -10
```

Expected: 에러 없음

- [ ] **Step 4: 빌드 확인**

```bash
npm run build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully` 또는 기존 경고와 동일

- [ ] **Step 5: Commit**

```bash
git add src/app/calendar/page.tsx
git commit -m "feat: 소싱 캘린더 페이지 — 2-depth 카테고리 탭 + ✦ 소분류 AI 추천 버튼"
```

---

## Self-Review

### Spec Coverage

| 설계 요구사항 | 구현 위치 |
|------------|---------|
| "✦ 소분류 AI 추천" 버튼 — 대분류 탭 우측 끝 | Task 4 (page.tsx 헤더 탭 바 오른쪽) |
| 클릭 → `suggestLoading=true`, 기존 소분류 흐리게 | Task 4 (`opacity: suggestLoading ? 0.5 : 1`) |
| `POST /api/calendar/suggest-subcategories` 호출 | Task 3 (route.ts), Task 4 (handleSuggest) |
| 응답 subcategories로 해당 대분류 소분류 교체 | Task 4 (`persistCategories(updated)`) |
| `persistCategories(updated)` → localStorage 저장 | Task 4 (`loadCategories` + `persistCategories`) |
| `activeSubId` 초기화 | Task 4 (`setActiveSubId(null)`) |
| `suggestLoading=false` | Task 4 (`finally` 블록) |
| AI 추천 소분류 보라색 하이라이트 (1회성) | Task 4 (`suggestedIds`, `#a5b4fc` 보더 + `AI` 뱃지) |
| ANTHROPIC_API_KEY 없음 → 폴백 반환 | Task 3 (`catch` 블록 → `makeFallback`) |
| Claude API 실패 → 폴백 반환 | Task 3 (`catch` 블록 → `makeFallback`) |
| parentCategory 없음 → 400 | Task 3 (유효성 검사) |
| 소분류 추가(+ 추가 버튼) / 삭제 기능 유지 | Task 4 (`handleAddSub`, `handleDeleteSub`) |
| ID: `ai-${name}-${Date.now() + index}` 형식 | Task 3 (`makeFallback`, 정상 응답 모두) |

### Placeholder Scan

없음 — 모든 태스크에 완성된 코드 포함.

### Type Consistency

- `Subcategory` · `ParentCategory` — Task 1 정의, Task 4 import (`@/lib/categories`)
- `SuggestResponse.subcategories: Subcategory[]` — Task 4에서 `Subcategory` 타입 재사용
- API route 반환: `{ subcategories: { id: string; name: string }[], suggestedAt: string }` — 테스트(Task 2)와 구현(Task 3)에서 동일한 필드명 사용
- `makeFallback` 반환 타입이 `{ id: string; name: string }[]`로 `Subcategory` 인터페이스와 호환됨

---

## Verification (완료 후 검증)

```bash
# 1. 로컬 서버 실행
npm run dev

# 2. 브라우저에서 /calendar 접근
# → 대분류 탭 6개, 소분류 그리드, ✦ 소분류 AI 추천 버튼 확인

# 3. "✦ 소분류 AI 추천" 클릭
# → 버튼이 "추천 중..."으로 바뀌고, 소분류 흐려짐
# → 새 소분류 6~8개 표시, AI 뱃지 + 보라색 보더
# → localStorage sourcing-calendar-categories 갱신 확인 (DevTools > Application)

# 4. 페이지 새로고침 → localStorage에서 커스텀 소분류 복원 확인

# 5. 소분류 추가(+ 추가) · 삭제(휴지통) 동작 확인

# 6. 테스트 재확인
npx vitest run src/app/api/calendar/__tests__/suggest-subcategories.test.ts
```
