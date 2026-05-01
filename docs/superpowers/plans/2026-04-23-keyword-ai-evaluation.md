# 키워드 AI 평가 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 키워드 통과/탈락 판정을 고정 숫자 기준에서 Claude Haiku AI 평가로 교체해, 카테고리 맥락을 반영한 O/X 판정과 근거를 제공한다.

**Architecture:** 새 `/api/ai/keyword-evaluate` 라우트가 `evaluateKeyword` 헬퍼를 export하고, `/api/ai/keyword-suggest`가 이를 import해 enrichment 후 자동 평가한다. `KeywordTrackerTab`은 `aiPass`/`aiReasoning` 필드를 추가하고 수동 저장 시 비동기 평가를 호출한다.

**Tech Stack:** Next.js App Router, Claude Haiku (`claude-haiku-4-5-20251001`), Vitest, TypeScript

---

## 파일 구조

| 파일 | 변경 유형 | 역할 |
|------|---------|------|
| `src/app/api/ai/keyword-evaluate/route.ts` | 신규 | POST 핸들러 + `evaluateKeyword` 헬퍼 export |
| `src/__tests__/api/keyword-evaluate.test.ts` | 신규 | evaluate 라우트 단위 테스트 |
| `src/app/api/ai/keyword-suggest/route.ts` | 수정 | enrichment 후 `evaluateKeyword` 호출, `pass`/`reasoning` 포함 |
| `src/__tests__/api/keyword-suggest-with-evaluate.test.ts` | 신규 | suggest+evaluate 통합 테스트 |
| `src/components/sourcing/KeywordTrackerTab.tsx` | 수정 | `aiPass`/`aiReasoning` 필드, 수동 저장 트리거, 툴팁, 통계 |
| `src/__tests__/components/keyword-tracker-ai-eval.test.ts` | 신규 | 컴포넌트 정적 분석 테스트 |

---

## Task 1: `/api/ai/keyword-evaluate` 라우트 생성

**Files:**
- Create: `src/app/api/ai/keyword-evaluate/route.ts`
- Create: `src/__tests__/api/keyword-evaluate.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/api/keyword-evaluate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ pass: true, reasoning: '검색량 대비 경쟁이 낮아 신규 진입에 적합합니다.' }),
          },
        ],
      }),
    },
  }),
}));

async function getPost() {
  const mod = await import('@/app/api/ai/keyword-evaluate/route');
  return mod.POST;
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai/keyword-evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/keyword-evaluate', () => {
  it('pass와 reasoning을 반환한다', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.pass).toBe(true);
    expect(typeof json.data.reasoning).toBe('string');
    expect(json.data.reasoning.length).toBeGreaterThan(0);
  });

  it('topReviewCount 없어도 평가한다', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '캠핑 의자', searchVolume: 5000, competitorCount: 200 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('pass');
  });

  it('searchVolume 없으면 400 반환', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '방수 백팩', competitorCount: 312 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('competitorCount 없으면 400 반환', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '방수 백팩', searchVolume: 11700 }));
    expect(res.status).toBe(400);
  });

  it('keyword 없으면 400 반환', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ searchVolume: 11700, competitorCount: 312 }));
    expect(res.status).toBe(400);
  });

  it('Claude API 오류 시 pass: null, reasoning: null을 200으로 반환한다', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: {
        create: vi.fn().mockRejectedValueOnce(new Error('API down')),
      },
    } as unknown as ReturnType<typeof getAnthropicClient>);

    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.pass).toBeNull();
    expect(json.data.reasoning).toBeNull();
  });

  it('evaluateKeyword 헬퍼가 export된다', async () => {
    const mod = await import('@/app/api/ai/keyword-evaluate/route');
    expect(typeof mod.evaluateKeyword).toBe('function');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx vitest run src/__tests__/api/keyword-evaluate.test.ts
```

Expected: 모든 테스트 FAIL (파일 없음)

- [ ] **Step 3: 라우트 구현**

```typescript
// src/app/api/ai/keyword-evaluate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getAnthropicClient } from '@/lib/ai/claude';
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';

interface EvaluateParams {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  topReviewCount?: number;
}

interface EvaluateResult {
  pass: boolean | null;
  reasoning: string | null;
}

interface ApiSuccessResponse {
  success: true;
  data: EvaluateResult;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

const SYSTEM_PROMPT = `당신은 한국 온라인 쇼핑몰(네이버 스마트스토어, 쿠팡) 키워드 소싱 전문가입니다.
셀러가 신규로 진입할 수 있는 키워드인지 판단합니다.

판단 기준:
- 이 카테고리의 일반적인 경쟁 수준을 고려할 것
- 수요(검색량) 대비 공급(경쟁 상품수) 비율을 볼 것
- 상위 리뷰수가 있으면 경쟁 강도 추가 반영
- 신규 셀러 기준: 광고비 없이 자연 노출로 판매 가능한지

반드시 JSON만 응답:
{"pass": true/false, "reasoning": "판단 근거 1~2문장"}`;

export async function evaluateKeyword(params: EvaluateParams): Promise<EvaluateResult> {
  const { keyword, searchVolume, competitorCount, topReviewCount } = params;
  const reviewLine = topReviewCount != null ? `상위 리뷰수: ${topReviewCount}` : '상위 리뷰수: 데이터 없음';
  const userPrompt = `키워드: ${keyword}
월 검색량: ${searchVolume}
경쟁 상품수: ${competitorCount}
${reviewLine}

이 키워드가 신규 셀러 진입에 적합한지 판단해주세요.`;

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = response.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.pass !== 'boolean' || typeof parsed.reasoning !== 'string') {
      return { pass: null, reasoning: null };
    }
    return { pass: parsed.pass, reasoning: parsed.reasoning };
  } catch {
    return { pass: null, reasoning: null };
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse> | Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const keyword = typeof b.keyword === 'string' ? b.keyword.trim() : '';
  const searchVolume = typeof b.searchVolume === 'number' ? b.searchVolume : null;
  const competitorCount = typeof b.competitorCount === 'number' ? b.competitorCount : null;
  const topReviewCount = typeof b.topReviewCount === 'number' ? b.topReviewCount : undefined;

  if (!keyword) {
    return NextResponse.json({ success: false, error: 'keyword가 필요합니다.' }, { status: 400 });
  }
  if (searchVolume === null) {
    return NextResponse.json({ success: false, error: 'searchVolume이 필요합니다.' }, { status: 400 });
  }
  if (competitorCount === null) {
    return NextResponse.json({ success: false, error: 'competitorCount가 필요합니다.' }, { status: 400 });
  }

  const result = await evaluateKeyword({ keyword, searchVolume, competitorCount, topReviewCount });
  return NextResponse.json({ success: true, data: result });
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/keyword-evaluate.test.ts
```

Expected: 6/6 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/keyword-evaluate/route.ts src/__tests__/api/keyword-evaluate.test.ts
git commit -m "feat: keyword-evaluate API 라우트 추가 (AI 판정 + evaluateKeyword 헬퍼)"
```

---

## Task 2: `keyword-suggest` 라우트 — evaluate 통합

**Files:**
- Modify: `src/app/api/ai/keyword-suggest/route.ts`
- Create: `src/__tests__/api/keyword-suggest-with-evaluate.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/api/keyword-suggest-with-evaluate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
  RATE_LIMITS: { AI_API: {} },
}));

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              keywords: [
                { keyword: '방수 백팩', reason: '수요 안정적' },
                { keyword: '미니 선풍기', reason: '여름 수요' },
              ],
            }),
          },
        ],
      }),
    },
  }),
}));

vi.mock('@/lib/naver-ad', () => ({
  getKeywordStats: vi.fn().mockResolvedValue([
    { keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 },
    { keyword: '미니 선풍기', searchVolume: 42000, competitorCount: 1204 },
  ]),
}));

vi.mock('@/app/api/ai/keyword-evaluate/route', () => ({
  evaluateKeyword: vi.fn().mockResolvedValue({ pass: true, reasoning: '검색량 대비 경쟁 낮음' }),
}));

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/ai/keyword-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/keyword-suggest (evaluate 통합)', () => {
  it('키워드에 pass와 reasoning 필드가 포함된다', async () => {
    const { POST } = await import('@/app/api/ai/keyword-suggest/route');
    const res = await POST(makeRequest({}));
    const json = await res.json();
    expect(json.success).toBe(true);
    const kw = json.data.keywords[0];
    expect(kw).toHaveProperty('pass');
    expect(kw).toHaveProperty('reasoning');
  });

  it('searchVolume이 있는 키워드는 evaluateKeyword가 호출된다', async () => {
    const { evaluateKeyword } = await import('@/app/api/ai/keyword-evaluate/route');
    vi.mocked(evaluateKeyword).mockClear();
    const { POST } = await import('@/app/api/ai/keyword-suggest/route');
    await POST(makeRequest({}));
    expect(vi.mocked(evaluateKeyword)).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 }),
    );
  });

  it('Naver API 실패 시 pass가 null이다', async () => {
    const { getKeywordStats } = await import('@/lib/naver-ad');
    vi.mocked(getKeywordStats).mockRejectedValueOnce(new Error('Naver down'));
    const { POST } = await import('@/app/api/ai/keyword-suggest/route');
    const res = await POST(makeRequest({}));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.keywords[0].pass).toBeNull();
    expect(json.data.keywords[0].reasoning).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/keyword-suggest-with-evaluate.test.ts
```

Expected: FAIL (pass/reasoning 필드 없음)

- [ ] **Step 3: `keyword-suggest/route.ts` 수정**

`src/app/api/ai/keyword-suggest/route.ts`의 `SuggestedKeyword` 인터페이스를 수정한다:

```typescript
export interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
  pass: boolean | null;
  reasoning: string | null;
}
```

파일 상단의 import에 `evaluateKeyword` 추가:

```typescript
import { evaluateKeyword } from '@/app/api/ai/keyword-evaluate/route';
```

POST 핸들러에서 Naver 조회 이후, return 직전에 3단계 평가 추가:

```typescript
  // 3단계: AI 평가 (searchVolume + competitorCount 있는 키워드만)
  const evaluationMap = new Map<string, { pass: boolean | null; reasoning: string | null }>();
  const toEvaluate = keywords.filter(
    (k) => k.searchVolume !== null && k.competitorCount !== null,
  );
  if (toEvaluate.length > 0) {
    await Promise.all(
      toEvaluate.map(async (k) => {
        const result = await evaluateKeyword({
          keyword: k.keyword,
          searchVolume: k.searchVolume!,
          competitorCount: k.competitorCount!,
        });
        evaluationMap.set(k.keyword, result);
      }),
    );
  }

  const enrichedKeywords: SuggestedKeyword[] = keywords.map((k) => {
    const ev = evaluationMap.get(k.keyword);
    return {
      ...k,
      pass: ev?.pass ?? null,
      reasoning: ev?.reasoning ?? null,
    };
  });

  return NextResponse.json({ success: true, data: { keywords: enrichedKeywords } });
```

기존 `return NextResponse.json({ success: true, data: { keywords } });` 줄을 위 블록으로 교체한다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/keyword-suggest-with-evaluate.test.ts src/__tests__/api/keyword-suggest-enriched.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/keyword-suggest/route.ts src/__tests__/api/keyword-suggest-with-evaluate.test.ts
git commit -m "feat: keyword-suggest에 AI 평가 통합 — pass/reasoning 필드 추가"
```

---

## Task 3: `KeywordTrackerTab` 수정 — AI 평가 기반 UI

**Files:**
- Modify: `src/components/sourcing/KeywordTrackerTab.tsx`
- Create: `src/__tests__/components/keyword-tracker-ai-eval.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/components/keyword-tracker-ai-eval.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.resolve(__dirname, '../../components/sourcing/KeywordTrackerTab.tsx'),
  'utf-8',
);

describe('KeywordTrackerTab — AI 평가 기반', () => {
  it('KeywordEntry에 aiPass 필드가 있다', () => {
    expect(src).toContain('aiPass: boolean | null');
  });

  it('KeywordEntry에 aiReasoning 필드가 있다', () => {
    expect(src).toContain('aiReasoning: string | null');
  });

  it('judgeKeyword 함수가 제거되었다', () => {
    expect(src).not.toContain('function judgeKeyword');
  });

  it('isSuggestedPass 함수가 제거되었다', () => {
    expect(src).not.toContain('function isSuggestedPass');
  });

  it('테이블에서 aiPass === true 분기로 ✅를 렌더링한다', () => {
    expect(src).toContain('aiPass === true');
  });

  it('테이블에서 aiPass === false 분기로 ❌를 렌더링한다', () => {
    expect(src).toContain('aiPass === false');
  });

  it('reasoning을 title 속성으로 툴팁에 표시한다', () => {
    expect(src).toMatch(/title.*aiReasoning|aiReasoning.*title/s);
  });

  it('상단 통계에 미평가 카운트가 있다', () => {
    expect(src).toContain('미평가');
    expect(src).toContain('nullCount');
  });

  it('수동 저장 시 /api/ai/keyword-evaluate를 호출한다', () => {
    expect(src).toContain('/api/ai/keyword-evaluate');
  });

  it('SuggestedKeyword에 pass 필드가 있다', () => {
    expect(src).toContain('pass: boolean | null');
  });

  it('SuggestedKeyword에 reasoning 필드가 있다', () => {
    expect(src).toMatch(/reasoning.*string.*null|string.*null.*reasoning/s);
  });

  it('모달 배지가 s.pass로 판정한다', () => {
    expect(src).toContain('s.pass');
  });

  it('handleAddSuggested가 aiPass를 저장한다', () => {
    expect(src).toContain('aiPass: s.pass');
  });

  it('통과/탈락 기준 안내 고정 텍스트가 제거되었다', () => {
    expect(src).not.toContain('월 검색량 3,000~30,000');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/keyword-tracker-ai-eval.test.ts
```

Expected: 다수 FAIL

- [ ] **Step 3: `KeywordTrackerTab.tsx` 전체 교체**

`src/components/sourcing/KeywordTrackerTab.tsx`를 아래 내용으로 교체한다:

```typescript
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { C as BASE_C } from '@/lib/design-tokens';

const C = {
  ...BASE_C,
  green: '#16a34a',
  greenBg: 'rgba(22,163,74,0.08)',
  red: '#dc2626',
  redBg: 'rgba(220,38,38,0.07)',
  yellow: '#d97706',
  purple: '#7c3aed',
  purpleDisabled: '#a78bfa',
};

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface KeywordEntry {
  id: string;
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  topReviewCount: number;
  domeggookNos: string;
  memo: string;
  createdAt: string;
  aiPass: boolean | null;
  aiReasoning: string | null;
}

interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
  pass: boolean | null;
  reasoning: string | null;
}

const STORAGE_KEY = 'plan_keywords';

function loadKeywords(): KeywordEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as KeywordEntry[]) : [];
  } catch { return []; }
}

function saveKeywords(entries: KeywordEntry[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ─── 빈 폼 초기값 ────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  keyword: '',
  searchVolume: '' as string | number,
  competitorCount: '' as string | number,
  topReviewCount: '' as string | number,
  domeggookNos: '',
  memo: '',
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: 13,
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  outline: 'none',
  color: C.text,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
};

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function KeywordTrackerTab() {
  const [entries, setEntries] = useState<KeywordEntry[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showForm, setShowForm] = useState(false);
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [suggestHint, setSuggestHint] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestResults, setSuggestResults] = useState<SuggestedKeyword[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [suggestError, setSuggestError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(loadKeywords());
  }, []);

  async function handleAdd() {
    if (!form.keyword.trim()) return;
    const sv = Number(form.searchVolume) || 0;
    const cc = Number(form.competitorCount) || 0;
    const rv = Number(form.topReviewCount) || 0;
    const newEntry: KeywordEntry = {
      id: crypto.randomUUID(),
      keyword: form.keyword.trim(),
      searchVolume: sv,
      competitorCount: cc,
      topReviewCount: rv,
      domeggookNos: form.domeggookNos.trim(),
      memo: form.memo.trim(),
      createdAt: new Date().toISOString(),
      aiPass: null,
      aiReasoning: null,
    };
    const updated = [newEntry, ...entries];
    setEntries(updated);
    saveKeywords(updated);
    setForm({ ...EMPTY_FORM });
    setShowForm(false);

    if (sv > 0 && cc > 0) {
      try {
        const res = await fetch('/api/ai/keyword-evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: newEntry.keyword,
            searchVolume: sv,
            competitorCount: cc,
            ...(rv > 0 ? { topReviewCount: rv } : {}),
          }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setEntries((prev) => {
              const next = prev.map((e) =>
                e.id === newEntry.id
                  ? { ...e, aiPass: json.data.pass, aiReasoning: json.data.reasoning }
                  : e,
              );
              saveKeywords(next);
              return next;
            });
          }
        }
      } catch {
        // aiPass stays null
      }
    }
  }

  async function handleSuggest() {
    setSuggestLoading(true);
    setSuggestResults([]);
    setSuggestError(null);
    try {
      const res = await fetch('/api/ai/keyword-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hint: suggestHint.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '알 수 없는 오류가 발생했습니다');
      if (!Array.isArray(json.data?.keywords)) throw new Error('잘못된 응답 형식입니다');
      const all = json.data.keywords as SuggestedKeyword[];
      const sorted = [...all].sort((a, b) => {
        if (a.pass === true && b.pass !== true) return -1;
        if (a.pass !== true && b.pass === true) return 1;
        return 0;
      });
      setSuggestResults(sorted);
      setSelectedIds(new Set(sorted.map((_, i) => i)));
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : '키워드 추천 중 오류가 발생했습니다');
    } finally {
      setSuggestLoading(false);
    }
  }

  function handleAddSuggested() {
    const toAdd = suggestResults
      .filter((_, i) => selectedIds.has(i))
      .map((s) => ({
        id: crypto.randomUUID(),
        keyword: s.keyword,
        searchVolume: s.searchVolume ?? 0,
        competitorCount: s.competitorCount ?? 0,
        topReviewCount: 0,
        domeggookNos: '',
        memo: s.reason,
        createdAt: new Date().toISOString(),
        aiPass: s.pass ?? null,
        aiReasoning: s.reasoning ?? null,
      }));
    if (toAdd.length === 0) return;
    const updated = [...toAdd, ...entries];
    setEntries(updated);
    saveKeywords(updated);
    setShowSuggestModal(false);
    setSuggestResults([]);
    setSelectedIds(new Set());
    setSuggestHint('');
  }

  function toggleSelectId(i: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function handleDelete(id: string) {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    saveKeywords(updated);
  }

  const { passCount, failCount, nullCount } = useMemo(() =>
    entries.reduce(
      (acc, e) => {
        if (e.aiPass === true) acc.passCount++;
        else if (e.aiPass === false) acc.failCount++;
        else acc.nullCount++;
        return acc;
      },
      { passCount: 0, failCount: 0, nullCount: 0 }
    ),
    [entries]
  );

  return (
    <div style={{ padding: '20px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>키워드 트래커</h2>
          <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
            총 {entries.length}개 · 통과 {passCount}개 · 탈락 {failCount}개 · 미평가 {nullCount}개
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowSuggestModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              background: C.purple, color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            ✨ AI 추천
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              background: C.accent, color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> 키워드 추가
          </button>
        </div>
      </div>

      {/* AI 추천 모달 */}
      {showSuggestModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSuggestModal(false); }}
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowSuggestModal(false); }}
        >
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28,
            width: 560, maxWidth: '92vw', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', gap: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>✨ AI 키워드 추천</h3>
                <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
                  Claude가 카테고리 맥락을 분석해 키워드 15개를 제안합니다
                </p>
              </div>
              <button
                onClick={() => setShowSuggestModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.textSub, lineHeight: 1 }}
              >×</button>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 6 }}>
                카테고리 / 시즌 힌트 <span style={{ fontWeight: 400 }}>(선택 — 비워두면 AI가 자유롭게 추천)</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{
                    flex: 1, padding: '8px 12px', fontSize: 13,
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    outline: 'none', color: C.text,
                  }}
                  placeholder="예: 봄 시즌 / 주방용품 / 남성 데스크 소품"
                  value={suggestHint}
                  onChange={(e) => setSuggestHint(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !suggestLoading) handleSuggest(); }}
                  autoFocus
                />
                <button
                  onClick={handleSuggest}
                  disabled={suggestLoading}
                  style={{
                    padding: '8px 20px', fontSize: 13, fontWeight: 700,
                    background: suggestLoading ? C.purpleDisabled : C.purple,
                    color: '#fff', border: 'none', borderRadius: 8,
                    cursor: suggestLoading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {suggestLoading ? '추천 중...' : '추천 받기'}
                </button>
              </div>
            </div>

            {suggestError && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, fontSize: 13,
                background: 'rgba(220,38,38,0.07)', color: '#dc2626',
                border: '1px solid rgba(220,38,38,0.2)',
              }}>
                ⚠️ {suggestError}
              </div>
            )}

            {suggestLoading && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: C.textSub, fontSize: 13 }}>
                Claude 분석 + 네이버 검색량 조회 중...
              </div>
            )}

            {!suggestLoading && suggestResults.length > 0 && (
              <>
                <div style={{ overflowY: 'auto', maxHeight: 340, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  {suggestResults.map((s, i) => (
                    <label
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 14px',
                        borderBottom: i < suggestResults.length - 1 ? `1px solid ${C.border}` : 'none',
                        cursor: 'pointer',
                        background: selectedIds.has(i) ? 'rgba(124,58,237,0.04)' : '#fff',
                        opacity: s.pass === false ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(i)}
                        onChange={() => toggleSelectId(i)}
                        style={{ marginTop: 2, accentColor: C.purple, flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.keyword}</span>
                          {s.pass !== null && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                              background: s.pass ? C.greenBg : C.redBg,
                              color: s.pass ? C.green : C.red,
                            }}>
                              {s.pass ? '✅ 통과' : '❌ 탈락'}
                            </span>
                          )}
                        </div>
                        {s.searchVolume !== null && s.competitorCount !== null && (
                          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
                            검색량 {s.searchVolume.toLocaleString()} · 경쟁 {s.competitorCount.toLocaleString()}개
                          </div>
                        )}
                        {s.reasoning && (
                          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2, fontStyle: 'italic' }}>
                            {s.reasoning}
                          </div>
                        )}
                        {!s.reasoning && (
                          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{s.reason}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.textSub }}>
                    {selectedIds.size}개 선택됨
                  </span>
                  <button
                    onClick={handleAddSuggested}
                    disabled={selectedIds.size === 0}
                    style={{
                      padding: '8px 20px', fontSize: 13, fontWeight: 700,
                      background: selectedIds.size > 0 ? C.purple : '#ccc',
                      color: '#fff', border: 'none', borderRadius: 8,
                      cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                    }}
                  >
                    선택 추가 ({selectedIds.size}개)
                  </button>
                </div>
              </>
            )}

            {!suggestLoading && suggestResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: C.textSub, fontSize: 13 }}>
                힌트를 입력하거나 그냥 &ldquo;추천 받기&rdquo;를 눌러보세요
              </div>
            )}
          </div>
        </div>
      )}

      {/* 입력 폼 */}
      {showForm && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 20, marginBottom: 20,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>키워드 *</label>
              <input
                style={inputStyle}
                placeholder="예: 방수 백팩 직장인"
                value={form.keyword}
                onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>월 검색량</label>
              <input
                style={inputStyle} type="number" placeholder="예: 8500"
                value={form.searchVolume}
                onChange={(e) => setForm((f) => ({ ...f, searchVolume: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>경쟁 상품 수</label>
              <input
                style={inputStyle} type="number" placeholder="예: 320"
                value={form.competitorCount}
                onChange={(e) => setForm((f) => ({ ...f, competitorCount: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>상위 리뷰 수</label>
              <input
                style={inputStyle} type="number" placeholder="예: 23"
                value={form.topReviewCount}
                onChange={(e) => setForm((f) => ({ ...f, topReviewCount: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>도매꾹 번호</label>
              <input
                style={inputStyle} placeholder="12345, 67890"
                value={form.domeggookNos}
                onChange={(e) => setForm((f) => ({ ...f, domeggookNos: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>메모</label>
            <input
              style={inputStyle} placeholder="추가 메모"
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={!form.keyword.trim()}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 700,
                background: form.keyword.trim() ? C.accent : '#ccc',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: form.keyword.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              저장
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '8px 16px', fontSize: 13,
                background: C.bg, color: C.textSub,
                border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 목록 테이블 */}
      {entries.length > 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f3f3f3', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub, width: 44 }}>판정</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>키워드</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 90 }}>월검색량</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 80 }}>경쟁수</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 80 }}>상위리뷰</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>도매꾹</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>메모</th>
                <th style={{ padding: '10px 16px', width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr key={entry.id} style={{ background: idx % 2 === 0 ? '#fff' : C.bg, borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                    {entry.aiPass === true && (
                      <span title={entry.aiReasoning ?? undefined} style={{ cursor: entry.aiReasoning ? 'help' : 'default' }}>
                        <CheckCircle size={16} color={C.green} />
                      </span>
                    )}
                    {entry.aiPass === false && (
                      <span title={entry.aiReasoning ?? undefined} style={{ cursor: entry.aiReasoning ? 'help' : 'default' }}>
                        <XCircle size={16} color={C.red} />
                      </span>
                    )}
                    {entry.aiPass === null && <span style={{ color: C.textSub, fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 16px', fontWeight: 600, color: C.text }}>{entry.keyword}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.searchVolume === 0 ? C.textSub : C.text }}>
                    {entry.searchVolume ? entry.searchVolume.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.competitorCount === 0 ? C.textSub : C.text }}>
                    {entry.competitorCount ? entry.competitorCount.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.topReviewCount === 0 ? C.textSub : C.text }}>
                    {entry.topReviewCount ? entry.topReviewCount.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: C.textSub, fontSize: 12, fontFamily: 'monospace' }}>
                    {entry.domeggookNos || '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: C.textSub, fontSize: 12 }}>{entry.memo || '—'}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.textSub }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.textSub, fontSize: 14 }}>
          아이템스카우트에서 조사한 키워드를 추가하세요
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/keyword-tracker-ai-eval.test.ts src/__tests__/components/keyword-tracker-modal.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 전체 테스트 실행 — 회귀 없음 확인**

```bash
npx vitest run
```

Expected: 모든 기존 테스트 PASS + 신규 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/KeywordTrackerTab.tsx src/__tests__/components/keyword-tracker-ai-eval.test.ts
git commit -m "feat: KeywordTrackerTab — AI 평가 기반 판정 (judgeKeyword 제거, aiPass/aiReasoning 툴팁)"
```

---

## Self-Review

**1. Spec coverage 체크:**

| 스펙 요구사항 | 구현 위치 |
|-------------|---------|
| `POST { keyword, searchVolume, competitorCount, topReviewCount? }` → `{ pass, reasoning }` | Task 1 |
| Claude Haiku 사용 | Task 1 `evaluateKeyword` |
| API 오류 시 `pass: null, reasoning: null` | Task 1 오류 처리 |
| `SuggestedKeyword`에 `pass`, `reasoning` 추가 | Task 2 |
| AI 추천 시 자동 평가 | Task 2 |
| `KeywordEntry`에 `aiPass`, `aiReasoning` 추가 | Task 3 |
| `judgeKeyword` 제거 | Task 3 |
| 수동 저장 시 searchVolume + competitorCount 모두 있으면 평가 | Task 3 `handleAdd` |
| ✅/❌ 배지에 마우스 오버 → reasoning 툴팁 | Task 3 `title` 속성 |
| 상단 통계 `미평가` 카운트 | Task 3 `nullCount` |
| 데이터 부족 시 `—` 표시 | Task 3 `aiPass === null` 분기 |

**2. Placeholder 없음** ✓

**3. 타입 일관성:**
- `evaluateKeyword` → Task 1에서 정의, Task 2에서 import ✓
- `SuggestedKeyword.pass`, `.reasoning` → Task 2에서 추가, Task 3에서 사용 ✓
- `KeywordEntry.aiPass`, `.aiReasoning` → Task 3에서 정의 및 사용 ✓
