# AI 키워드 추천 + 네이버 실데이터 자동 조회 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 추천 키워드에 네이버 검색광고 API(월 검색량)와 네이버 쇼핑 API(경쟁 상품수)를 자동으로 조회하여 모달에 통과/탈락 판정과 함께 표시한다.

**Architecture:** 신규 `src/lib/naver-ad.ts`에 검색광고 API 클라이언트를 만들고, `keyword-suggest` 라우트가 Claude 응답 후 이 클라이언트를 직접 호출해 enriched 응답을 반환한다. 프론트엔드 `KeywordTrackerTab.tsx`는 새 타입을 받아 모달에 수치+배지를 렌더링한다.

**Tech Stack:** Next.js App Router API Routes, Node.js crypto(HMAC-SHA256), Naver Search Ad API, Naver Shopping Open API, React

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/lib/naver-ad.ts` | 신규 — 검색광고 API 인증 + `getKeywordStats()` |
| `src/app/api/naver/keyword-stats/route.ts` | 신규 — HTTP POST 엔드포인트 (테스트/재사용용) |
| `src/app/api/ai/keyword-suggest/route.ts` | 수정 — enriched 응답 + 프롬프트 수정 |
| `src/components/sourcing/KeywordTrackerTab.tsx` | 수정 — 모달 UI (수치 + 배지 + 정렬) |

---

### Task 1: 네이버 검색광고 API 클라이언트 구현

**Files:**
- Create: `src/lib/naver-ad.ts`
- Test: `src/__tests__/lib/naver-ad.test.ts`

- [ ] **Step 1: 테스트 파일 작성 (실패 확인)**

`src/__tests__/lib/naver-ad.test.ts` 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSignature, parseKeywordStats } from '@/lib/naver-ad';

describe('buildSignature', () => {
  it('timestamp + method + path를 HMAC-SHA256으로 서명한다', () => {
    const sig = buildSignature('1234567890', 'GET', '/keywordstool', 'secret-key');
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(20);
  });

  it('같은 입력에 대해 항상 동일한 서명을 반환한다', () => {
    const sig1 = buildSignature('1234567890', 'GET', '/keywordstool', 'secret');
    const sig2 = buildSignature('1234567890', 'GET', '/keywordstool', 'secret');
    expect(sig1).toBe(sig2);
  });

  it('다른 secret key는 다른 서명을 만든다', () => {
    const sig1 = buildSignature('1234567890', 'GET', '/keywordstool', 'secret1');
    const sig2 = buildSignature('1234567890', 'GET', '/keywordstool', 'secret2');
    expect(sig1).not.toBe(sig2);
  });
});

describe('parseKeywordStats', () => {
  it('keywordList 배열에서 searchVolume을 PC + Mobile 합산으로 추출한다', () => {
    const raw = {
      keywordList: [
        { relKeyword: '방수 백팩', monthlyPcQcCnt: 3200, monthlyMobileQcCnt: 8500 },
        { relKeyword: '미니 선풍기', monthlyPcQcCnt: 1000, monthlyMobileQcCnt: 2000 },
      ],
    };
    const result = parseKeywordStats(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ keyword: '방수 백팩', searchVolume: 11700 });
    expect(result[1]).toEqual({ keyword: '미니 선풍기', searchVolume: 3000 });
  });

  it('빈 keywordList는 빈 배열을 반환한다', () => {
    expect(parseKeywordStats({ keywordList: [] })).toEqual([]);
  });

  it('잘못된 응답 형식은 빈 배열을 반환한다', () => {
    expect(parseKeywordStats(null)).toEqual([]);
    expect(parseKeywordStats({})).toEqual([]);
    expect(parseKeywordStats({ keywordList: 'bad' })).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx vitest run src/__tests__/lib/naver-ad.test.ts
```

Expected: FAIL (모듈 없음)

- [ ] **Step 3: `src/lib/naver-ad.ts` 구현**

```typescript
import crypto from 'crypto';

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface KeywordStat {
  keyword: string;
  searchVolume: number | null;
  competitorCount: number | null;
}

interface NaverAdKeywordItem {
  relKeyword: string;
  monthlyPcQcCnt: number;
  monthlyMobileQcCnt: number;
}

// ─── HMAC-SHA256 서명 ────────────────────────────────────────────────────────

export function buildSignature(
  timestamp: string,
  method: string,
  path: string,
  secretKey: string,
): string {
  const message = `${timestamp}.${method.toUpperCase()}.${path}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

// ─── 응답 파서 ───────────────────────────────────────────────────────────────

export function parseKeywordStats(
  raw: unknown,
): { keyword: string; searchVolume: number }[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.keywordList)) return [];
  return (data.keywordList as NaverAdKeywordItem[])
    .filter(
      (k) =>
        typeof k?.relKeyword === 'string' &&
        typeof k?.monthlyPcQcCnt === 'number' &&
        typeof k?.monthlyMobileQcCnt === 'number',
    )
    .map((k) => ({
      keyword: k.relKeyword,
      searchVolume: k.monthlyPcQcCnt + k.monthlyMobileQcCnt,
    }));
}

// ─── 검색광고 API 호출 ───────────────────────────────────────────────────────

export async function fetchSearchVolumes(
  keywords: string[],
): Promise<Map<string, number>> {
  const apiKey = process.env.NAVER_AD_API_KEY;
  const secretKey = process.env.NAVER_AD_SECRET_KEY;
  const customerId = process.env.NAVER_AD_CUSTOMER_ID;

  if (!apiKey || !secretKey || !customerId) {
    return new Map();
  }

  const timestamp = Date.now().toString();
  const path = '/keywordstool';
  const signature = buildSignature(timestamp, 'GET', path, secretKey);
  const query = keywords.map(encodeURIComponent).join(',');

  const res = await fetch(
    `https://api.searchad.naver.com${path}?hintKeywords=${query}&showDetail=1`,
    {
      headers: {
        'X-Timestamp': timestamp,
        'X-API-KEY': apiKey,
        'X-Customer': customerId,
        'X-Signature': signature,
      },
    },
  );

  if (!res.ok) return new Map();

  const json = await res.json();
  const stats = parseKeywordStats(json);
  return new Map(stats.map((s) => [s.keyword, s.searchVolume]));
}

// ─── 네이버 쇼핑 경쟁 상품수 조회 ───────────────────────────────────────────

export async function fetchCompetitorCounts(
  keywords: string[],
): Promise<Map<string, number>> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) return new Map();

  const results = await Promise.allSettled(
    keywords.map(async (kw) => {
      const res = await fetch(
        `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(kw)}&display=1`,
        {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
          },
        },
      );
      if (!res.ok) return [kw, null] as const;
      const json = await res.json();
      return [kw, typeof json.total === 'number' ? json.total : null] as const;
    }),
  );

  const map = new Map<string, number>();
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value[1] !== null) {
      map.set(r.value[0], r.value[1]);
    }
  }
  return map;
}

// ─── 통합 조회 ───────────────────────────────────────────────────────────────

export async function getKeywordStats(keywords: string[]): Promise<KeywordStat[]> {
  const [volumeMap, competitorMap] = await Promise.allSettled([
    fetchSearchVolumes(keywords),
    fetchCompetitorCounts(keywords),
  ]);

  const vMap = volumeMap.status === 'fulfilled' ? volumeMap.value : new Map<string, number>();
  const cMap = competitorMap.status === 'fulfilled' ? competitorMap.value : new Map<string, number>();

  return keywords.map((kw) => ({
    keyword: kw,
    searchVolume: vMap.get(kw) ?? null,
    competitorCount: cMap.get(kw) ?? null,
  }));
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/naver-ad.test.ts
```

Expected: PASS (4/4)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/naver-ad.ts src/__tests__/lib/naver-ad.test.ts
git commit -m "feat(naver-ad): 검색광고 API 클라이언트 + 쇼핑 경쟁 상품수 조회 구현"
```

---

### Task 2: keyword-stats API 라우트 신규 생성

**Files:**
- Create: `src/app/api/naver/keyword-stats/route.ts`
- Test: `src/__tests__/api/naver-keyword-stats.test.ts`

- [ ] **Step 1: 테스트 파일 작성 (실패 확인)**

`src/__tests__/api/naver-keyword-stats.test.ts` 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/naver/keyword-stats/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/naver-ad', () => ({
  getKeywordStats: vi.fn().mockResolvedValue([
    { keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 },
    { keyword: '미니 선풍기', searchVolume: 3000, competitorCount: 980 },
  ]),
}));

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/naver/keyword-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/naver/keyword-stats', () => {
  it('keywords 배열을 받아 stats를 반환한다', async () => {
    const req = makeRequest({ keywords: ['방수 백팩', '미니 선풍기'] });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.stats).toHaveLength(2);
    expect(json.data.stats[0].keyword).toBe('방수 백팩');
    expect(json.data.stats[0].searchVolume).toBe(11700);
    expect(json.data.stats[0].competitorCount).toBe(312);
  });

  it('keywords가 없으면 400을 반환한다', async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('keywords가 빈 배열이면 400을 반환한다', async () => {
    const req = makeRequest({ keywords: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('keywords가 50개를 초과하면 400을 반환한다', async () => {
    const req = makeRequest({ keywords: Array(51).fill('test') });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/naver-keyword-stats.test.ts
```

Expected: FAIL (라우트 없음)

- [ ] **Step 3: 라우트 구현**

`src/app/api/naver/keyword-stats/route.ts` 생성:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getKeywordStats } from '@/lib/naver-ad';

interface ApiSuccessResponse {
  success: true;
  data: { stats: Awaited<ReturnType<typeof getKeywordStats>> };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult as never;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const keywords = (body as Record<string, unknown>).keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ success: false, error: 'keywords 배열이 필요합니다.' }, { status: 400 });
  }
  if (keywords.length > 50) {
    return NextResponse.json({ success: false, error: 'keywords는 50개 이하여야 합니다.' }, { status: 400 });
  }

  const validKeywords = keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);

  try {
    const stats = await getKeywordStats(validKeywords);
    return NextResponse.json({ success: true, data: { stats } });
  } catch (error) {
    console.error('[keyword-stats]', error);
    return NextResponse.json({ success: false, error: '키워드 통계 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/naver-keyword-stats.test.ts
```

Expected: PASS (4/4)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/naver/keyword-stats/route.ts src/__tests__/api/naver-keyword-stats.test.ts
git commit -m "feat(api): /api/naver/keyword-stats 라우트 신규 생성"
```

---

### Task 3: keyword-suggest 라우트 수정 — enriched 응답 반환

**Files:**
- Modify: `src/app/api/ai/keyword-suggest/route.ts`
- Test: `src/__tests__/api/keyword-suggest-enriched.test.ts`

- [ ] **Step 1: 테스트 파일 작성 (실패 확인)**

`src/__tests__/api/keyword-suggest-enriched.test.ts` 생성:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { POST } from '@/app/api/ai/keyword-suggest/route';
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

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/ai/keyword-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/keyword-suggest (enriched)', () => {
  it('키워드에 searchVolume과 competitorCount가 포함된다', async () => {
    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    const kw = json.data.keywords[0];
    expect(kw).toHaveProperty('searchVolume');
    expect(kw).toHaveProperty('competitorCount');
    expect(kw.keyword).toBe('방수 백팩');
    expect(kw.searchVolume).toBe(11700);
    expect(kw.competitorCount).toBe(312);
  });

  it('Naver API 실패 시 searchVolume/competitorCount가 null이어도 키워드를 반환한다', async () => {
    const { getKeywordStats } = await import('@/lib/naver-ad');
    vi.mocked(getKeywordStats).mockRejectedValueOnce(new Error('Naver API down'));

    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.keywords).toHaveLength(2);
    expect(json.data.keywords[0].searchVolume).toBeNull();
    expect(json.data.keywords[0].competitorCount).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/keyword-suggest-enriched.test.ts
```

Expected: FAIL

- [ ] **Step 3: keyword-suggest 라우트 수정**

`src/app/api/ai/keyword-suggest/route.ts` 전체 교체:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/supabase/auth';
import { getKeywordStats } from '@/lib/naver-ad';
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
}

interface ApiSuccessResponse {
  success: true;
  data: { keywords: SuggestedKeyword[] };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─── 응답 파서 ───────────────────────────────────────────────────────────────

export function parseKeywordSuggestResponse(raw: string): { keyword: string; reason: string }[] {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.keywords || !Array.isArray(parsed.keywords)) return [];
    return parsed.keywords.filter(
      (k: unknown): k is { keyword: string; reason: string } =>
        typeof k === 'object' &&
        k !== null &&
        typeof (k as Record<string, unknown>).keyword === 'string' &&
        typeof (k as Record<string, unknown>).reason === 'string',
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
- 2~3단어 조합 키워드 (예: "방수 백팩", "캠핑 의자 경량")
- 4단어 이상의 지나치게 구체적인 조합은 검색량이 너무 낮으므로 지양
- 대형 브랜드 의존도 낮은 카테고리
- 실제 네이버/쿠팡 검색창에 입력할 법한 표현

반드시 JSON만 응답하세요. 다른 텍스트 없이:
{"keywords": [{"keyword": "키워드", "reason": "추천 이유 1~2문장"}]}`;

function buildUserPrompt(hint?: string): string {
  const hintLine = hint ? `카테고리/시즌 힌트: ${hint}\n\n` : '';
  return `${hintLine}위 전략 기준에 맞는 한국 온라인 쇼핑몰 상품 키워드 15개를 추천해주세요.`;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse> | Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
  const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'keyword-suggest'), RATE_LIMITS.AI_API);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() } },
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

  // 1단계: Claude 키워드 생성
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(hint) }],
  });

  const rawText = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const baseKeywords = parseKeywordSuggestResponse(rawText);
  if (baseKeywords.length === 0) {
    return NextResponse.json(
      { success: false, error: 'AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.' },
      { status: 502 },
    );
  }

  // 2단계: 네이버 API로 실데이터 조회 (실패해도 graceful degradation)
  let statsMap = new Map<string, { searchVolume: number | null; competitorCount: number | null }>();
  try {
    const stats = await getKeywordStats(baseKeywords.map((k) => k.keyword));
    for (const s of stats) {
      statsMap.set(s.keyword, { searchVolume: s.searchVolume, competitorCount: s.competitorCount });
    }
  } catch {
    // graceful degradation: 수치 없이 키워드만 반환
  }

  const keywords: SuggestedKeyword[] = baseKeywords.map((k) => {
    const stats = statsMap.get(k.keyword);
    return {
      keyword: k.keyword,
      reason: k.reason,
      searchVolume: stats?.searchVolume ?? null,
      competitorCount: stats?.competitorCount ?? null,
    };
  });

  return NextResponse.json({ success: true, data: { keywords } });
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/keyword-suggest-enriched.test.ts
```

Expected: PASS (2/2)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/keyword-suggest/route.ts src/__tests__/api/keyword-suggest-enriched.test.ts
git commit -m "feat(api): keyword-suggest enriched 응답 + 프롬프트 2~3단어 지향으로 수정"
```

---

### Task 4: KeywordTrackerTab 모달 UI 업데이트

**Files:**
- Modify: `src/components/sourcing/KeywordTrackerTab.tsx`
- Test: `src/__tests__/components/keyword-tracker-modal.test.ts`

- [ ] **Step 1: 테스트 파일 작성 (실패 확인)**

`src/__tests__/components/keyword-tracker-modal.test.ts` 생성:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.resolve(__dirname, '../../components/sourcing/KeywordTrackerTab.tsx'),
  'utf-8',
);

describe('KeywordTrackerTab — enriched 모달', () => {
  it('SuggestedKeyword 타입에 searchVolume 필드가 있다', () => {
    expect(src).toContain('searchVolume');
  });

  it('SuggestedKeyword 타입에 competitorCount 필드가 있다', () => {
    expect(src).toContain('competitorCount');
  });

  it('통과/탈락 배지 렌더링 로직이 있다', () => {
    expect(src).toContain('통과');
    expect(src).toContain('탈락');
  });

  it('searchVolume이 null일 때를 처리한다', () => {
    expect(src).toMatch(/searchVolume.*null|null.*searchVolume/s);
  });

  it('통과 키워드 상단 정렬 로직이 있다', () => {
    expect(src).toMatch(/sort|통과.*상단|pass.*sort/i);
  });

  it('"검색량 조회 중" 로딩 메시지가 있다', () => {
    expect(src).toContain('검색량 조회');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/keyword-tracker-modal.test.ts
```

Expected: FAIL

- [ ] **Step 3: KeywordTrackerTab.tsx 수정**

`src/components/sourcing/KeywordTrackerTab.tsx` 의 `SuggestedKeyword` 인터페이스를 다음으로 교체:

```typescript
interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
}
```

`handleSuggest` 함수의 `setSuggestResults(all)` 호출 직후 로딩 단계 상태를 추가하기 위해 `suggestPhase` state 추가:

```typescript
// 기존 state 선언 아래에 추가
const [suggestPhase, setSuggestPhase] = useState<'idle' | 'claude' | 'naver' | 'done'>('idle');
```

`handleSuggest` 함수를 다음으로 교체:

```typescript
async function handleSuggest() {
  setSuggestLoading(true);
  setSuggestPhase('claude');
  setSuggestResults([]);
  setSuggestError(null);
  try {
    setSuggestPhase('naver');
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
    // 통과 키워드 상단 정렬
    const sorted = [...all].sort((a, b) => {
      const aPass = isSuggestedPass(a);
      const bPass = isSuggestedPass(b);
      if (aPass && !bPass) return -1;
      if (!aPass && bPass) return 1;
      return 0;
    });
    setSuggestResults(sorted);
    setSelectedIds(new Set(sorted.map((_, i) => i)));
    setSuggestPhase('done');
  } catch (err) {
    setSuggestError(err instanceof Error ? err.message : '키워드 추천 중 오류가 발생했습니다');
    setSuggestPhase('idle');
  } finally {
    setSuggestLoading(false);
  }
}
```

통과 판별 헬퍼 함수를 컴포넌트 밖에 추가:

```typescript
function isSuggestedPass(s: SuggestedKeyword): boolean {
  if (s.searchVolume === null || s.competitorCount === null) return false;
  return s.searchVolume >= 3000 && s.searchVolume <= 30000 && s.competitorCount < 500;
}
```

로딩 메시지 부분을 다음으로 교체:

```typescript
{suggestLoading && (
  <div style={{ textAlign: 'center', padding: '32px 0', color: C.textSub, fontSize: 13 }}>
    {suggestPhase === 'claude' ? 'Claude가 키워드를 분석하는 중...' : '네이버에서 검색량 조회 중...'}
  </div>
)}
```

결과 목록 각 행(`label` 태그 안)에 수치와 배지를 추가:

```typescript
<label key={i} style={{ ... }}>
  <input type="checkbox" ... />
  <div style={{ flex: 1 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.keyword}</span>
      {s.searchVolume !== null && s.competitorCount !== null && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
          background: isSuggestedPass(s) ? C.greenBg : C.redBg,
          color: isSuggestedPass(s) ? C.green : C.red,
        }}>
          {isSuggestedPass(s) ? '✅ 통과' : '❌ 탈락'}
        </span>
      )}
    </div>
    {s.searchVolume !== null && s.competitorCount !== null && (
      <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
        검색량 {s.searchVolume.toLocaleString()} · 경쟁 {s.competitorCount.toLocaleString()}개
      </div>
    )}
    <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{s.reason}</div>
  </div>
</label>
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/keyword-tracker-modal.test.ts
```

Expected: PASS (6/6)

- [ ] **Step 5: 전체 테스트 실행**

```bash
npx vitest run src/__tests__/lib/naver-ad.test.ts src/__tests__/api/naver-keyword-stats.test.ts src/__tests__/api/keyword-suggest-enriched.test.ts src/__tests__/components/keyword-tracker-modal.test.ts
```

Expected: PASS (all)

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/KeywordTrackerTab.tsx src/__tests__/components/keyword-tracker-modal.test.ts
git commit -m "feat(ui): AI 추천 모달에 통과/탈락 배지 + 검색량·경쟁수 표시 추가"
```
