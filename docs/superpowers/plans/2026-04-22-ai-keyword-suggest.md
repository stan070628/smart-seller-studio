# AI 키워드 추천 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KeywordTrackerTab 상단에 "AI 추천" 버튼을 추가해 Claude가 셀러 전략 기준에 맞는 키워드 15개를 제안하면, 사용자가 선택해서 트래커에 바로 추가할 수 있게 한다.

**Architecture:** `POST /api/ai/keyword-suggest` 라우트를 신규 생성해 Claude Haiku에 전략 기준 + 선택적 카테고리 힌트를 전달하고 키워드 15개를 JSON으로 받는다. `KeywordTrackerTab`에 AI 추천 모달 UI를 추가하고 선택한 키워드를 숫자 필드 비운 채로 트래커에 insert한다. 기존 `/api/ai/*` 패턴(getAnthropicClient + rate limit + validate)을 그대로 따른다.

**Tech Stack:** Next.js 15 App Router API Route, Anthropic SDK (`getAnthropicClient`), TypeScript, React, Vitest

---

## File Map

| 파일 | 상태 | 역할 |
|---|---|---|
| `src/app/api/ai/keyword-suggest/route.ts` | 신규 | Claude 호출 + 응답 파싱 API |
| `src/__tests__/api/keyword-suggest.test.ts` | 신규 | parseKeywordSuggestResponse 단위 테스트 |
| `src/components/sourcing/KeywordTrackerTab.tsx` | 수정 | AI 추천 버튼 + 모달 UI 추가 |

---

## Task 1: /api/ai/keyword-suggest 라우트

**Files:**
- Create: `src/app/api/ai/keyword-suggest/route.ts`
- Test: `src/__tests__/api/keyword-suggest.test.ts`

- [ ] **Step 1: 테스트 파일 작성 (failing)**

`src/__tests__/api/keyword-suggest.test.ts` 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { parseKeywordSuggestResponse } from '@/app/api/ai/keyword-suggest/route';

describe('parseKeywordSuggestResponse', () => {
  it('정상 JSON 응답을 파싱한다', () => {
    const raw = '{"keywords": [{"keyword": "방수 직장인 백팩", "reason": "직장인 수요 꾸준, 경쟁 낮음"}]}';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('방수 직장인 백팩');
    expect(result[0].reason).toBe('직장인 수요 꾸준, 경쟁 낮음');
  });

  it('마크다운 코드블록으로 감싸진 JSON을 파싱한다', () => {
    const raw = '```json\n{"keywords": [{"keyword": "알루미늄 노트북 거치대", "reason": "재택근무 수요"}]}\n```';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('알루미늄 노트북 거치대');
  });

  it('keywords 필드가 없으면 빈 배열을 반환한다', () => {
    const raw = '{"data": []}';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toEqual([]);
  });

  it('유효하지 않은 JSON이면 빈 배열을 반환한다', () => {
    const raw = 'not valid json';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toEqual([]);
  });

  it('keyword 또는 reason이 문자열이 아닌 항목을 필터링한다', () => {
    const raw = '{"keywords": [{"keyword": "유효한 키워드", "reason": "이유"}, {"keyword": 123, "reason": "이유"}]}';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('유효한 키워드');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/keyword-suggest.test.ts 2>&1 | tail -10
```

Expected: `parseKeywordSuggestResponse` 를 찾을 수 없어 FAIL

- [ ] **Step 3: 라우트 파일 생성**

`src/app/api/ai/keyword-suggest/route.ts` 생성:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface SuggestedKeyword {
  keyword: string;
  reason: string;
}

interface ApiSuccessResponse {
  success: true;
  data: { keywords: SuggestedKeyword[] };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─── 응답 파서 (export — 테스트용) ───────────────────────────────────────────

export function parseKeywordSuggestResponse(raw: string): SuggestedKeyword[] {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.keywords || !Array.isArray(parsed.keywords)) return [];
    return parsed.keywords.filter(
      (k: unknown): k is SuggestedKeyword =>
        typeof k === 'object' &&
        k !== null &&
        typeof (k as Record<string, unknown>).keyword === 'string' &&
        typeof (k as Record<string, unknown>).reason === 'string'
    );
  } catch {
    return [];
  }
}

// ─── 프롬프트 ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 한국 온라인 쇼핑몰(네이버 스마트스토어, 쿠팡) 상품 키워드 전문가입니다.

셀러 전략 기준:
- 월 검색량: 3,000 ~ 30,000 (너무 크면 레드오션, 너무 작으면 수요 없음)
- 경쟁 상품 수: 500개 미만 (틈새시장)
- 상위 상품 리뷰 수: 50개 미만 (신규 진입 가능)
- 가격대: 8,000원 ~ 50,000원
- 소형 상품, 연중 수요 안정, 브랜드 로열티 낮은 카테고리

키워드 작성 원칙:
- 구체적이고 특화된 키워드 (예: "백팩"보다 "방수 직장인 백팩 15인치")
- 대형 브랜드 의존도 낮은 카테고리
- 실제 네이버/쿠팡 검색창에 입력할 법한 표현

반드시 JSON만 응답하세요. 다른 텍스트 없이:
{"keywords": [{"keyword": "키워드", "reason": "추천 이유 1~2문장"}]}`;

function buildUserPrompt(hint?: string): string {
  const hintLine = hint ? `카테고리/시즌 힌트: ${hint}\n\n` : '';
  return `${hintLine}위 전략 기준에 맞는 한국 온라인 쇼핑몰 상품 키워드 15개를 추천해주세요. 각 키워드는 실제 검색 가능한 구체적인 표현이어야 합니다.`;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
    const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'keyword-suggest'), RATE_LIMITS.AI_API);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429, headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() } }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const hint =
      typeof (body as Record<string, unknown>).hint === 'string'
        ? ((body as Record<string, unknown>).hint as string).trim().slice(0, 100) || undefined
        : undefined;

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(hint) }],
    });

    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const keywords = parseKeywordSuggestResponse(rawText);

    if (keywords.length === 0) {
      return NextResponse.json(
        { success: false, error: 'AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: { keywords } });
  } catch (error) {
    console.error('[keyword-suggest]', error);
    return NextResponse.json(
      { success: false, error: '키워드 추천 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/keyword-suggest.test.ts 2>&1 | tail -10
```

Expected: `5 passed`

- [ ] **Step 5: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "keyword-suggest" | head -5
```

Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/keyword-suggest/route.ts src/__tests__/api/keyword-suggest.test.ts
git commit -m "feat: add /api/ai/keyword-suggest route with Claude Haiku"
```

---

## Task 2: KeywordTrackerTab AI 추천 버튼 + 모달 UI

**Files:**
- Modify: `src/components/sourcing/KeywordTrackerTab.tsx`

현재 파일 구조 파악 후 다음 변경을 적용한다.

- [ ] **Step 1: 파일 읽기 — 현재 import, 타입, 상태 변수 위치 확인**

```bash
grep -n "import\|interface\|const \[" src/components/sourcing/KeywordTrackerTab.tsx | head -20
```

- [ ] **Step 2: SuggestedKeyword 타입 추가**

파일 상단 `interface KeywordEntry` 바로 아래에 삽입:

```typescript
interface SuggestedKeyword {
  keyword: string;
  reason: string;
}
```

- [ ] **Step 3: 컴포넌트 내부 상태 변수 추가**

`const [showForm, setShowForm] = useState(false);` 바로 아래에 삽입:

```typescript
const [showSuggestModal, setShowSuggestModal] = useState(false);
const [suggestHint, setSuggestHint] = useState('');
const [suggestLoading, setSuggestLoading] = useState(false);
const [suggestResults, setSuggestResults] = useState<SuggestedKeyword[]>([]);
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
```

- [ ] **Step 4: handleSuggest 함수 추가**

`function handleDelete` 바로 위에 삽입:

```typescript
async function handleSuggest() {
  setSuggestLoading(true);
  setSuggestResults([]);
  try {
    const res = await fetch('/api/ai/keyword-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hint: suggestHint.trim() || undefined }),
    });
    const json = await res.json();
    if (json.success) {
      const all = json.data.keywords as SuggestedKeyword[];
      setSuggestResults(all);
      setSelectedIds(new Set(all.map((_, i) => i)));
    }
  } catch {
    // 조용히 실패 — 사용자에게 재시도 안내는 모달 UI에서 처리
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
      searchVolume: 0,
      competitorCount: 0,
      topReviewCount: 0,
      domeggookNos: '',
      memo: s.reason,
      createdAt: new Date().toISOString(),
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
```

- [ ] **Step 5: 헤더 영역에 "AI 추천" 버튼 추가**

현재 헤더 버튼 영역:
```tsx
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
```

다음으로 교체 (버튼 2개 나란히):

```tsx
<div style={{ display: 'flex', gap: 8 }}>
  <button
    onClick={() => setShowSuggestModal(true)}
    style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 16px', fontSize: 13, fontWeight: 700,
      background: '#7c3aed', color: '#fff',
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
```

- [ ] **Step 6: AI 추천 모달 추가**

입력 폼(`{showForm && (...)}`)) 바로 위에 삽입:

```tsx
{/* AI 추천 모달 */}
{showSuggestModal && (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }}
    onClick={(e) => { if (e.target === e.currentTarget) setShowSuggestModal(false); }}
  >
    <div style={{
      background: '#fff', borderRadius: 16, padding: 28,
      width: 560, maxWidth: '92vw', maxHeight: '85vh',
      display: 'flex', flexDirection: 'column', gap: 16,
      boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    }}>
      {/* 모달 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>✨ AI 키워드 추천</h3>
          <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
            Claude가 셀러 전략 기준(검색량·경쟁·리뷰)에 맞는 키워드 15개를 제안합니다
          </p>
        </div>
        <button
          onClick={() => setShowSuggestModal(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.textSub, lineHeight: 1 }}
        >×</button>
      </div>

      {/* 힌트 입력 */}
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
          />
          <button
            onClick={handleSuggest}
            disabled={suggestLoading}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 700,
              background: suggestLoading ? '#a78bfa' : '#7c3aed',
              color: '#fff', border: 'none', borderRadius: 8,
              cursor: suggestLoading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {suggestLoading ? '추천 중...' : '추천 받기'}
          </button>
        </div>
      </div>

      {/* 추천 결과 */}
      {suggestLoading && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: C.textSub, fontSize: 13 }}>
          Claude가 키워드를 분석하는 중...
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
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(i)}
                  onChange={() => toggleSelectId(i)}
                  style={{ marginTop: 2, accentColor: '#7c3aed', flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.keyword}</div>
                  <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{s.reason}</div>
                </div>
              </label>
            ))}
          </div>

          {/* 선택 추가 버튼 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: C.textSub }}>
              {selectedIds.size}개 선택됨 · 숫자 필드는 아이템스카우트에서 직접 채우세요
            </span>
            <button
              onClick={handleAddSuggested}
              disabled={selectedIds.size === 0}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 700,
                background: selectedIds.size > 0 ? '#7c3aed' : '#ccc',
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
          힌트를 입력하거나 그냥 "추천 받기"를 눌러보세요
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 7: 빌드 확인**

```bash
npm run build 2>&1 | tail -8
```

Expected: `✓ Compiled successfully` 또는 Route 목록 출력

- [ ] **Step 8: 커밋**

```bash
git add src/components/sourcing/KeywordTrackerTab.tsx
git commit -m "feat: add AI keyword suggest modal to KeywordTrackerTab"
```
