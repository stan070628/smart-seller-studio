# Trademark Block Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 1688 발주 전 상품명을 입력하면 KIPRIS 등록상표를 RED 차단 기준으로 즉시 검사하고, 통과 시에만 1688 검색 링크를 활성화하는 독립 사전체크 도구를 구현한다.

**Architecture:** 기존 cron-only `legal-trademark` route를 재사용하지 않고, 사용자 요청용 동기 API `/api/sourcing/trademark-precheck`를 신설. 기존 `checkTrademark()` 함수의 결과(YELLOW)를 사전체크 컨텍스트에서 RED로 격상. 결과는 `trademark_precheck_logs` 테이블에 audit 기록. UI는 독립 페이지 `/sourcing/trademark-precheck`로 시작하고, 추후 winner-dashboard 구현 시 컴포넌트만 임포트하여 통합.

**Tech Stack:** Next.js App Router, Supabase Postgres (sourcing schema), 기존 KIPRIS 모듈, React Server Components, Tailwind
**전략 v2 의존도:** critical (Week 4 시작 전 완료 필수)
**근거 spec:** `docs/superpowers/specs/2026-04-27-seller-strategy-v2-design.md` §6.2

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 신규 | `src/lib/sourcing/legal/precheck.ts` | `precheckTrademark()` — checkTrademark 결과를 RED로 격상하는 wrapper |
| 신규 | `supabase/migrations/<timestamp>_trademark_precheck_logs.sql` | audit 테이블 마이그레이션 |
| 신규 | `src/app/api/sourcing/trademark-precheck/route.ts` | POST 동기 사전체크 API |
| 신규 | `src/app/sourcing/trademark-precheck/page.tsx` | UI 페이지 (서버 컴포넌트) |
| 신규 | `src/components/sourcing/TrademarkPrecheckForm.tsx` | 입력 폼 (클라이언트 컴포넌트) |
| 신규 | `src/components/sourcing/TrademarkPrecheckResultCard.tsx` | 결과 카드 + 1688 링크 토글 |
| 신규 | `src/lib/sourcing/__tests__/precheck.test.ts` | precheck wrapper 테스트 |
| 신규 | `src/__tests__/api/trademark-precheck.test.ts` | API 라우트 통합 테스트 |

---

## Task 1: precheck wrapper — YELLOW → RED 격상

기존 `checkTrademark()`는 cron 컨텍스트에서 YELLOW(경고)로 반환. 사전체크 컨텍스트에서는 RED(차단)로 격상.

**Files:**
- Create: `src/lib/sourcing/legal/precheck.ts`
- Test: `src/lib/sourcing/__tests__/precheck.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sourcing/__tests__/precheck.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LegalIssue } from '../legal/types';

// checkTrademark mock
vi.mock('../legal/kipris', async () => {
  const actual = await vi.importActual<typeof import('../legal/kipris')>('../legal/kipris');
  return {
    ...actual,
    checkTrademark: vi.fn(),
  };
});

import { checkTrademark } from '../legal/kipris';
import { precheckTrademark } from '../legal/precheck';

const mockedCheckTrademark = vi.mocked(checkTrademark);

describe('precheckTrademark — 1688 발주 사전체크 RED 격상', () => {
  beforeEach(() => {
    mockedCheckTrademark.mockReset();
  });

  it('등록상표 발견 (TRADEMARK_CAUTION YELLOW) → RED 격상', async () => {
    mockedCheckTrademark.mockResolvedValue({
      layer: 'trademark',
      severity: 'YELLOW',
      code: 'TRADEMARK_CAUTION',
      message: "등록상표 발견: 'XYZ' (출원번호: 12345)",
      detail: { word: 'XYZ', applicationNumber: '12345' },
    } satisfies LegalIssue);

    const result = await precheckTrademark('XYZ 텀블러');

    expect(result.status).toBe('blocked');
    expect(result.issue?.severity).toBe('RED');
    expect(result.issue?.code).toBe('TRADEMARK_BLOCK');
    expect(result.canProceed).toBe(false);
  });

  it('출원 중 상표 (TRADEMARK_PENDING YELLOW) → YELLOW 유지', async () => {
    mockedCheckTrademark.mockResolvedValue({
      layer: 'trademark',
      severity: 'YELLOW',
      code: 'TRADEMARK_PENDING',
      message: "출원 중: 'XYZ'",
      detail: {},
    } satisfies LegalIssue);

    const result = await precheckTrademark('XYZ 텀블러');

    expect(result.status).toBe('warning');
    expect(result.issue?.severity).toBe('YELLOW');
    expect(result.canProceed).toBe(true);
  });

  it('상표 없음 → safe', async () => {
    mockedCheckTrademark.mockResolvedValue(null);

    const result = await precheckTrademark('일반 텀블러 500ml');

    expect(result.status).toBe('safe');
    expect(result.issue).toBeNull();
    expect(result.canProceed).toBe(true);
  });

  it('extractBrandCandidate가 null 반환 → safe (조사할 단어 없음)', async () => {
    mockedCheckTrademark.mockResolvedValue(null);
    const result = await precheckTrademark('세트 팩 매');
    expect(result.status).toBe('safe');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/precheck.test.ts`
Expected: FAIL — `precheck` 모듈 없음

- [ ] **Step 3: precheck.ts 구현**

`src/lib/sourcing/legal/precheck.ts`:

```ts
/**
 * 1688 발주 사전체크 — checkTrademark 결과를 RED 차단으로 격상
 *
 * 채널 spec v2 §6.2: "등록상표 발견 시 빨간 배너 + 발주 차단"
 * cron 배치(YELLOW)와 분리된 컨텍스트로 동작.
 */

import { checkTrademark } from './kipris';
import type { LegalIssue } from './types';

export type PrecheckStatus = 'safe' | 'warning' | 'blocked';

export interface TrademarkPrecheckResult {
  status: PrecheckStatus;
  issue: LegalIssue | null;
  canProceed: boolean;
  brandCandidate: string | null;
}

export async function precheckTrademark(title: string): Promise<TrademarkPrecheckResult> {
  const issue = await checkTrademark(title);

  if (!issue) {
    return { status: 'safe', issue: null, canProceed: true, brandCandidate: null };
  }

  // TRADEMARK_CAUTION (등록상표) → RED 격상, 차단
  if (issue.code === 'TRADEMARK_CAUTION') {
    const escalated: LegalIssue = {
      ...issue,
      severity: 'RED',
      code: 'TRADEMARK_BLOCK',
      message: issue.message.replace('등록상표 발견', '[발주차단] 등록상표 충돌'),
    };
    return {
      status: 'blocked',
      issue: escalated,
      canProceed: false,
      brandCandidate: (issue.detail as { word?: string }).word ?? null,
    };
  }

  // TRADEMARK_PENDING → YELLOW 유지, 진행 가능 (사용자 판단)
  return {
    status: 'warning',
    issue,
    canProceed: true,
    brandCandidate: (issue.detail as { word?: string }).word ?? null,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/precheck.test.ts`
Expected: PASS — 4개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/legal/precheck.ts src/lib/sourcing/__tests__/precheck.test.ts
git commit -m "feat(legal): add precheckTrademark wrapper escalating to RED block"
```

---

## Task 2: audit 테이블 마이그레이션

사용자 사전체크 요청을 audit 로그에 기록. 추후 분석/회고에 활용.

**Files:**
- Create: `supabase/migrations/<timestamp>_trademark_precheck_logs.sql`

- [ ] **Step 1: 마이그레이션 파일명 결정**

Run: `date +%Y%m%d%H%M%S`
Expected: 예시 `20260427143015`

마이그레이션 경로: `supabase/migrations/20260427143015_trademark_precheck_logs.sql`
(실제 timestamp는 실행 시점 기준 사용)

- [ ] **Step 2: 마이그레이션 SQL 작성**

`supabase/migrations/<timestamp>_trademark_precheck_logs.sql`:

```sql
-- 1688 발주 사전체크 audit 로그
-- 채널 spec v2 §6.2 — 사전체크 결과 기록 + 회고 데이터

CREATE TABLE IF NOT EXISTS trademark_precheck_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  title TEXT NOT NULL,
  brand_candidate TEXT,
  status TEXT NOT NULL CHECK (status IN ('safe', 'warning', 'blocked')),
  issue_code TEXT,
  issue_message TEXT,
  issue_detail JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trademark_precheck_logs_user_id
  ON trademark_precheck_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_trademark_precheck_logs_checked_at
  ON trademark_precheck_logs (checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_trademark_precheck_logs_status
  ON trademark_precheck_logs (status);

COMMENT ON TABLE trademark_precheck_logs IS
  '1688 발주 사전체크 KIPRIS 결과 audit. spec 2026-04-27-seller-strategy-v2 §6.2';
```

- [ ] **Step 3: 로컬 마이그레이션 적용**

Run: `npx supabase migration up`
Expected: `Applied migration ...trademark_precheck_logs.sql`

수동 검증:
Run: `npx supabase db dump --schema public 2>/dev/null | grep -A2 "trademark_precheck_logs"`
Expected: CREATE TABLE 출력

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/
git commit -m "feat(db): add trademark_precheck_logs audit table"
```

---

## Task 3: API 라우트 — POST /api/sourcing/trademark-precheck

복수 상품명을 받아 일괄 사전체크. 결과를 audit에 기록.

**Files:**
- Create: `src/app/api/sourcing/trademark-precheck/route.ts`
- Test: `src/__tests__/api/trademark-precheck.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/api/trademark-precheck.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/sourcing/legal/precheck', () => ({
  precheckTrademark: vi.fn(),
}));

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
  }),
}));

import { POST } from '@/app/api/sourcing/trademark-precheck/route';
import { precheckTrademark } from '@/lib/sourcing/legal/precheck';

const mocked = vi.mocked(precheckTrademark);

describe('POST /api/sourcing/trademark-precheck', () => {
  beforeEach(() => mocked.mockReset());

  it('단일 상품명 사전체크 → 결과 배열 반환', async () => {
    mocked.mockResolvedValue({
      status: 'safe',
      issue: null,
      canProceed: true,
      brandCandidate: null,
    });

    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({ titles: ['일반 텀블러'] }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0].status).toBe('safe');
  });

  it('빈 titles 배열 → 400', async () => {
    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({ titles: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('titles 배열 없음 → 400', async () => {
    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('titles 길이 50 초과 → 400 (rate limit)', async () => {
    const titles = Array.from({ length: 51 }, (_, i) => `item ${i}`);
    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({ titles }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('blocked 결과는 canProceed=false 포함', async () => {
    mocked.mockResolvedValue({
      status: 'blocked',
      issue: {
        layer: 'trademark',
        severity: 'RED',
        code: 'TRADEMARK_BLOCK',
        message: '[발주차단] 등록상표 충돌',
        detail: {},
      },
      canProceed: false,
      brandCandidate: 'XYZ',
    });

    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({ titles: ['XYZ 컵'] }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.results[0].canProceed).toBe(false);
    expect(json.results[0].status).toBe('blocked');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/api/trademark-precheck.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: API 라우트 구현**

`src/app/api/sourcing/trademark-precheck/route.ts`:

```ts
/**
 * POST /api/sourcing/trademark-precheck
 *
 * 1688 발주 사전체크 — 일괄 KIPRIS RED 차단
 * spec v2 §6.2
 *
 * 입력:  { titles: string[] }  (최대 50건)
 * 출력:  { results: Array<{ title, status, canProceed, brandCandidate, issue? }> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { precheckTrademark } from '@/lib/sourcing/legal/precheck';
import { getSourcingPool } from '@/lib/sourcing/db';

const MAX_TITLES = 50;
const REQUEST_DELAY_MS = 500; // KIPRIS API 부하 회피

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const titles = (body?.titles ?? null) as string[] | null;

  if (!Array.isArray(titles) || titles.length === 0) {
    return NextResponse.json(
      { success: false, error: 'titles must be non-empty array' },
      { status: 400 },
    );
  }

  if (titles.length > MAX_TITLES) {
    return NextResponse.json(
      { success: false, error: `titles length must be <= ${MAX_TITLES}` },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const results: Array<{
    title: string;
    status: 'safe' | 'warning' | 'blocked';
    canProceed: boolean;
    brandCandidate: string | null;
    issue: ReturnType<typeof precheckTrademark> extends Promise<infer R>
      ? R extends { issue: infer I }
        ? I
        : never
      : never;
  }> = [];

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const result = await precheckTrademark(title);

    // audit 기록
    await pool.query(
      `INSERT INTO trademark_precheck_logs
         (title, brand_candidate, status, issue_code, issue_message, issue_detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        title,
        result.brandCandidate,
        result.status,
        result.issue?.code ?? null,
        result.issue?.message ?? null,
        result.issue?.detail ? JSON.stringify(result.issue.detail) : null,
      ],
    ).catch((e) => {
      console.error('[trademark-precheck] audit insert failed', e);
    });

    results.push({
      title,
      status: result.status,
      canProceed: result.canProceed,
      brandCandidate: result.brandCandidate,
      issue: result.issue,
    });

    if (i < titles.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  return NextResponse.json({ success: true, results });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/trademark-precheck.test.ts`
Expected: PASS — 5개 테스트 모두 통과

- [ ] **Step 5: 타입체크 + lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/sourcing/trademark-precheck/`
Expected: 에러 0건

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/sourcing/trademark-precheck/ src/__tests__/api/trademark-precheck.test.ts
git commit -m "feat(api): add /api/sourcing/trademark-precheck batch endpoint"
```

---

## Task 4: UI — TrademarkPrecheckForm 클라이언트 컴포넌트

상품명을 줄바꿈으로 입력받아 API 호출하고 결과를 표시.

**Files:**
- Create: `src/components/sourcing/TrademarkPrecheckForm.tsx`

- [ ] **Step 1: 폼 컴포넌트 작성**

`src/components/sourcing/TrademarkPrecheckForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import TrademarkPrecheckResultCard from './TrademarkPrecheckResultCard';

export interface PrecheckResult {
  title: string;
  status: 'safe' | 'warning' | 'blocked';
  canProceed: boolean;
  brandCandidate: string | null;
  issue: {
    severity: 'RED' | 'YELLOW' | 'GREEN';
    code: string;
    message: string;
  } | null;
}

export default function TrademarkPrecheckForm() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PrecheckResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResults([]);

    const titles = input
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (titles.length === 0) {
      setError('상품명을 한 줄에 하나씩 입력하세요.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/sourcing/trademark-precheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titles }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? '사전체크 실패');
      } else {
        setResults(data.results);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  const blockedCount = results.filter((r) => r.status === 'blocked').length;

  return (
    <div className="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-sm font-medium">
          상품명 (한 줄에 하나, 최대 50개)
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={8}
          className="w-full rounded border border-gray-300 p-3 font-mono text-sm"
          placeholder={'스테인리스 텀블러 500ml\n캠핑 코펠 4인용\n...'}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? '검사 중…' : '1688 발주 사전체크'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {results.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="text-sm text-gray-600">
            총 {results.length}건 검사 — 차단 {blockedCount}건 / 통과 {results.length - blockedCount}건
          </div>
          {results.map((r, i) => (
            <TrademarkPrecheckResultCard key={`${i}-${r.title}`} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건 (TrademarkPrecheckResultCard 미정의 에러만 — 다음 Task에서 해결)

- [ ] **Step 3: 커밋 보류 — 다음 Task와 묶음 커밋**

(Form만 단독으로는 동작하지 않으므로 ResultCard 작성 후 함께 커밋)

---

## Task 5: UI — TrademarkPrecheckResultCard

결과별 상태 카드 + 1688 검색 링크 (RED일 때 disabled).

**Files:**
- Create: `src/components/sourcing/TrademarkPrecheckResultCard.tsx`

- [ ] **Step 1: 결과 카드 컴포넌트 작성**

`src/components/sourcing/TrademarkPrecheckResultCard.tsx`:

```tsx
'use client';

import { build1688SearchUrl } from '@/lib/niche/sourcing-links';
import type { PrecheckResult } from './TrademarkPrecheckForm';

const STATUS_STYLE: Record<
  PrecheckResult['status'],
  { bg: string; border: string; label: string; emoji: string }
> = {
  safe:    { bg: 'bg-green-50',  border: 'border-green-300',  label: '발주 가능',     emoji: '✅' },
  warning: { bg: 'bg-yellow-50', border: 'border-yellow-300', label: '주의 (수동검토)', emoji: '⚠️' },
  blocked: { bg: 'bg-red-50',    border: 'border-red-400',    label: '발주 차단',     emoji: '🚫' },
};

export default function TrademarkPrecheckResultCard({ result }: { result: PrecheckResult }) {
  const s = STATUS_STYLE[result.status];
  const search1688Url = build1688SearchUrl(result.brandCandidate ?? result.title);

  return (
    <div className={`rounded border p-4 ${s.bg} ${s.border}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold tracking-wide text-gray-500">
            {s.emoji} {s.label}
          </div>
          <div className="mt-1 font-medium">{result.title}</div>
          {result.brandCandidate && (
            <div className="mt-1 text-sm text-gray-600">
              검색 단어: <code className="rounded bg-white px-1">{result.brandCandidate}</code>
            </div>
          )}
        </div>

        {result.canProceed ? (
          <a
            href={search1688Url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
          >
            1688 검색 →
          </a>
        ) : (
          <button
            disabled
            className="cursor-not-allowed rounded bg-gray-300 px-3 py-2 text-sm font-medium text-gray-500"
            title="등록상표 충돌로 발주 차단됨"
          >
            1688 검색 차단
          </button>
        )}
      </div>

      {result.issue && (
        <div className="mt-3 rounded bg-white p-2 text-sm">
          <span className="font-medium">[{result.issue.code}]</span> {result.issue.message}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: build1688SearchUrl 헬퍼 export 확인**

Run: `grep -n "export.*build1688SearchUrl\|export.*1688" src/lib/niche/sourcing-links.ts`

만약 named export가 없다면, 기존 `PLATFORM_CONFIG['1688'].buildUrl` 사용으로 변경:

`TrademarkPrecheckResultCard.tsx`의 import를 다음으로 교체:

```tsx
import { buildSourcingUrl } from '@/lib/niche/sourcing-links';
// ...
const search1688Url = buildSourcingUrl('1688', result.brandCandidate ?? result.title);
```

`buildSourcingUrl`이 없으면 `src/lib/niche/sourcing-links.ts`에 다음 export 추가:

```ts
export function buildSourcingUrl(platform: SourcingPlatform, query: string): string {
  return PLATFORM_CONFIG[platform].buildUrl(query);
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건

- [ ] **Step 4: 커밋 (Task 4 + 5 묶음)**

```bash
git add src/components/sourcing/TrademarkPrecheckForm.tsx src/components/sourcing/TrademarkPrecheckResultCard.tsx src/lib/niche/sourcing-links.ts
git commit -m "feat(ui): add trademark precheck form + result card with 1688 link gate"
```

---

## Task 6: UI 페이지 라우트

App Router 페이지 생성. 서버 컴포넌트로 폼을 wrap.

**Files:**
- Create: `src/app/sourcing/trademark-precheck/page.tsx`

- [ ] **Step 1: 페이지 작성**

`src/app/sourcing/trademark-precheck/page.tsx`:

```tsx
import TrademarkPrecheckForm from '@/components/sourcing/TrademarkPrecheckForm';

export const metadata = {
  title: '1688 발주 사전체크',
  description: '상품명을 KIPRIS 등록상표 DB에 사전 검사하여 발주 차단 여부를 판단합니다.',
};

export default function TrademarkPrecheckPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">1688 발주 사전체크</h1>
      <p className="mb-6 text-sm text-gray-600">
        위너 후보 상품명을 입력하면 KIPRIS 등록상표를 검사합니다.
        등록상표 충돌 시 1688 검색 링크가 자동 차단됩니다.
        (전략 v2 §6.2)
      </p>
      <TrademarkPrecheckForm />
    </main>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공, `/sourcing/trademark-precheck` 경로 빌드 산출물에 포함

- [ ] **Step 3: 커밋**

```bash
git add src/app/sourcing/trademark-precheck/
git commit -m "feat(page): add /sourcing/trademark-precheck page route"
```

---

## Task 7: 수동 동작 검증

직접 dev 서버 띄우고 사용자 플로우 검증.

- [ ] **Step 1: dev 서버 시작**

Run: `npm run dev`
Expected: localhost:3000 listening

- [ ] **Step 2: 브라우저로 페이지 접근**

URL: `http://localhost:3000/sourcing/trademark-precheck`
Expected: 폼 페이지 정상 렌더링

- [ ] **Step 3: 검증 케이스 1 — 일반 상품**

textarea에 입력:
```
스테인리스 텀블러 500ml
일반 코펠 캠핑용
```

버튼 클릭 → Expected:
- 두 줄 모두 ✅ "발주 가능" 카드
- 1688 검색 링크 활성화 (오렌지 버튼)

- [ ] **Step 4: 검증 케이스 2 — 등록상표 의심**

textarea에 입력:
```
나이키 운동화 정품
다이슨 청소기 정품
```

버튼 클릭 → Expected:
- 두 줄 중 1개 이상 🚫 "발주 차단"
- 1688 검색 링크 회색 비활성

(KIPRIS 응답에 따라 결과 다름. 최소 1건은 차단 케이스 발생 예상)

- [ ] **Step 5: audit 로그 확인**

Run: `npx supabase db psql -c "SELECT title, status, issue_code FROM trademark_precheck_logs ORDER BY checked_at DESC LIMIT 10;"`
Expected: 위 검증 단계의 입력 상품명들이 status와 함께 기록

- [ ] **Step 6: 검증 결과 메모**

만약 KIPRIS API가 너무 느리거나 timeout 발생 → `legal/kipris.ts:75`의 timeout 10초 → 15초로 상향 검토.

만약 false positive(일반 단어인데 차단)가 많음 → `legal/kipris.ts:14`의 `SKIP_WORDS`에 단어 추가.

- [ ] **Step 7: 메모를 spec에 반영 (필요 시)**

발견사항을 spec v2 §10 근거자료 섹션 또는 별도 retrospective 노트로 추가.

---

## Self-Review Checklist

**1. Spec coverage** ✅
- §6.2 "위너 1688 발주 전 KIPRIS 자동 검색" → Task 1 (precheck wrapper), Task 3 (API)
- §6.2 "등록상표 발견 시 빨간 배너 + 발주 차단" → Task 5 (ResultCard 빨간색 + 1688 링크 disabled)

**2. Placeholder scan** ✅
- TBD/TODO 0건. 마이그레이션 timestamp만 실행 시점 결정 (Task 2 Step 1에 명시)

**3. Type consistency** ✅
- `PrecheckStatus`(`'safe' | 'warning' | 'blocked'`) — precheck.ts, route.ts, Form, ResultCard 전부 동일
- `TrademarkPrecheckResult` — precheck.ts에서 정의, API와 Form은 동일 형태로 받음
- `PrecheckResult`(UI 측) — Form에서 정의, ResultCard로 import

**4. 회귀 위험**
- Task 5 Step 2에서 `build1688SearchUrl` 또는 `buildSourcingUrl` export 미존재 시 추가 — 기존 `sourcing-links.ts`에 영향 0
- 신규 API 라우트는 기존 cron `/api/sourcing/legal-trademark`와 별개 경로 — 충돌 없음

**5. 의존성**
- KIPRIS_API_KEY 환경변수 필수 — 이미 `.env.local`에 존재 (확인됨)
- supabase 마이그레이션 필요 — Task 2 Step 3
