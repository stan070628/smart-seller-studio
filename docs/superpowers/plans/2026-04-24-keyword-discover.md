# Keyword Discover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트렌드 기반 키워드 발굴 — 매일 Gemini가 SNS/유튜브 트렌드 씨드를 수집하고, 사용자가 "키워드 발굴" 버튼을 누르면 Naver 검색광고 API 확장 → 검색량/경쟁상품수 필터 → AI 평가 순서로 소싱 가능한 키워드를 추천한다.

**Architecture:** Gemini google_search grounding으로 트렌드 씨드를 수집해 Render PostgreSQL에 저장. 사용자 요청 시 naver-ad.ts의 새 expandKeywords 함수로 씨드를 100+개 관련 키워드로 확장하고, 기존 evaluateKeyword로 AI 평가.

**Tech Stack:** @google/genai (google_search tool), Naver 검색광고 API (hintKeywords), Claude Haiku (evaluateKeyword), Render PostgreSQL (getSourcingPool), Next.js App Router

---

### Task 1: Render PostgreSQL — `trend_seeds` 테이블 생성

**Files:**
- Create: `src/db/migrations/001_trend_seeds.sql`

- [ ] **Step 1: migration SQL 파일 작성**

```sql
-- src/db/migrations/001_trend_seeds.sql
CREATE TABLE IF NOT EXISTS trend_seeds (
  id SERIAL PRIMARY KEY,
  seed_date DATE NOT NULL,
  keyword TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(seed_date, keyword)
);

CREATE INDEX IF NOT EXISTS idx_trend_seeds_date ON trend_seeds(seed_date DESC);
```

- [ ] **Step 2: Render PostgreSQL에 직접 실행**

Render 대시보드 또는 psql로 실행:
```bash
psql $SOURCING_DATABASE_URL -f src/db/migrations/001_trend_seeds.sql
```

예상 출력: `CREATE TABLE` / `CREATE INDEX`

- [ ] **Step 3: 테이블 확인**

```bash
psql $SOURCING_DATABASE_URL -c "\d trend_seeds"
```

예상 출력: id, seed_date, keyword, source, reason, created_at 컬럼 확인

- [ ] **Step 4: 커밋**

```bash
git add src/db/migrations/001_trend_seeds.sql
git commit -m "feat: add trend_seeds migration for keyword discovery"
```

---

### Task 2: Gemini 트렌드 씨드 수집 함수

**Files:**
- Create: `src/lib/sourcing/trend-discovery.ts`
- Test: `src/__tests__/lib/trend-discovery.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/lib/trend-discovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn().mockReturnValue({
    models: {
      generateContent: vi.fn(),
    },
  }),
}));

import { discoverTrendSeeds, parseSeedResponse } from '@/lib/sourcing/trend-discovery';
import { getGeminiGenAI } from '@/lib/ai/gemini';

describe('parseSeedResponse', () => {
  it('유효한 JSON에서 씨드 배열을 파싱한다', () => {
    const raw = '{"seeds":[{"keyword":"캠핑의자","source":"youtube","reason":"트렌드"}]}';
    const result = parseSeedResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('캠핑의자');
    expect(result[0].source).toBe('youtube');
  });

  it('마크다운 코드블록을 제거하고 파싱한다', () => {
    const raw = '```json\n{"seeds":[{"keyword":"에어프라이어","source":"instagram","reason":"인기"}]}\n```';
    const result = parseSeedResponse(raw);
    expect(result).toHaveLength(1);
  });

  it('잘못된 JSON이면 빈 배열 반환', () => {
    expect(parseSeedResponse('not json')).toEqual([]);
  });

  it('seeds 필드 없으면 빈 배열 반환', () => {
    expect(parseSeedResponse('{"keywords":[]}')).toEqual([]);
  });
});

describe('discoverTrendSeeds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Gemini 응답에서 씨드를 파싱해 반환한다', async () => {
    const mockAI = getGeminiGenAI();
    (mockAI.models.generateContent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{ text: '{"seeds":[{"keyword":"텀블러","source":"threads","reason":"환경"}]}' }],
        },
      }],
    });

    const result = await discoverTrendSeeds();
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('텀블러');
  });

  it('Gemini 오류 시 빈 배열 반환', async () => {
    const mockAI = getGeminiGenAI();
    (mockAI.models.generateContent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API error'));

    const result = await discoverTrendSeeds();
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/lib/trend-discovery.test.ts 2>&1 | tail -20
```

예상: `Cannot find module '@/lib/sourcing/trend-discovery'`

- [ ] **Step 3: 구현**

```typescript
// src/lib/sourcing/trend-discovery.ts
import { getGeminiGenAI } from '@/lib/ai/gemini';

export interface TrendSeed {
  keyword: string;
  source: string;
  reason: string;
}

const DISCOVER_PROMPT = `오늘 한국에서 유행하는 생활용품·주방·청소·건강·반려동물 관련 소비재 트렌드를 YouTube, 인스타그램, 쓰레드, 네이버 급상승 검색어에서 찾아줘.

이미 포화된 대형 카테고리(스마트폰, 노트북 등)는 제외.
2~3단어로 된 구체적 상품 키워드 10개를 아래 JSON 형식으로만 응답:
{"seeds": [{"keyword": "키워드", "source": "youtube|instagram|threads|naver", "reason": "트렌드 근거 1문장"}]}`;

export function parseSeedResponse(raw: string): TrendSeed[] {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.seeds || !Array.isArray(parsed.seeds)) return [];
    return parsed.seeds.filter(
      (s: unknown): s is TrendSeed =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as Record<string, unknown>).keyword === 'string' &&
        typeof (s as Record<string, unknown>).source === 'string' &&
        typeof (s as Record<string, unknown>).reason === 'string',
    );
  } catch {
    return [];
  }
}

export async function discoverTrendSeeds(): Promise<TrendSeed[]> {
  try {
    const ai = getGeminiGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      tools: [{ googleSearch: {} }],
      contents: [{ role: 'user', parts: [{ text: DISCOVER_PROMPT }] }],
    });

    const candidates = response.candidates;
    if (!candidates?.length) return [];
    const parts = candidates[0]?.content?.parts;
    const text = parts?.find((p: { text?: string }) => typeof p.text === 'string')?.text ?? '';
    return parseSeedResponse(text);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/lib/trend-discovery.test.ts 2>&1 | tail -10
```

예상: `6 tests | 6 passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/trend-discovery.ts src/__tests__/lib/trend-discovery.test.ts
git commit -m "feat: add discoverTrendSeeds with Gemini web grounding"
```

---

### Task 3: Naver 키워드 확장 함수 — `expandKeywords()`

**Files:**
- Modify: `src/lib/naver-ad.ts`
- Test: `src/__tests__/lib/naver-ad-expand.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/lib/naver-ad-expand.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { expandKeywords } from '@/lib/naver-ad';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  vi.stubEnv('NAVER_AD_API_KEY', 'test-key');
  vi.stubEnv('NAVER_AD_SECRET_KEY', 'test-secret');
  vi.stubEnv('NAVER_AD_CUSTOMER_ID', '123');
  vi.stubEnv('NAVER_CLIENT_ID', 'client-id');
  vi.stubEnv('NAVER_CLIENT_SECRET', 'client-secret');
});

afterEach(() => vi.clearAllMocks());

describe('expandKeywords', () => {
  it('씨드에서 관련 키워드를 확장해 KeywordStat[]을 반환한다', async () => {
    // 검색광고 API mock (관련 키워드 반환)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        keywordList: [
          { relKeyword: '캠핑의자', monthlyPcQcCnt: 3000, monthlyMobileQcCnt: 5000 },
          { relKeyword: '접이식의자', monthlyPcQcCnt: 1000, monthlyMobileQcCnt: 2000 },
        ],
      }),
    } as Response);

    // 네이버 쇼핑 mock (경쟁상품수)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ total: 300 }) } as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ total: 600 }) } as Response);

    const result = await expandKeywords(['캠핑']);
    expect(result).toHaveLength(2);
    expect(result[0].keyword).toBe('캠핑의자');
    expect(result[0].searchVolume).toBe(8000);
    expect(result[0].competitorCount).toBe(300);
    expect(result[1].competitorCount).toBe(600);
  });

  it('API 키 없으면 빈 배열 반환', async () => {
    vi.stubEnv('NAVER_AD_API_KEY', '');
    const result = await expandKeywords(['캠핑']);
    expect(result).toEqual([]);
  });

  it('5개 초과 씨드는 배치로 나눠 요청한다', async () => {
    // 검색광고 API: 2번 호출 (5개 + 1개)
    const mockAdResponse = { ok: true, json: async () => ({ keywordList: [] }) };
    fetchMock.mockResolvedValue(mockAdResponse as Response);

    await expandKeywords(['a', 'b', 'c', 'd', 'e', 'f']);
    const adCalls = fetchMock.mock.calls.filter((c: [string]) =>
      c[0].includes('keywordstool'),
    );
    expect(adCalls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/lib/naver-ad-expand.test.ts 2>&1 | tail -10
```

예상: `expandKeywords is not a function`

- [ ] **Step 3: `expandKeywords` 추가 (src/lib/naver-ad.ts 끝에 추가)**

```typescript
// ─── 씨드 기반 키워드 확장 ──────────────────────────────────────────────────

const AD_BATCH_SIZE = 5;

/**
 * 씨드 키워드를 hintKeywords로 전달해 Naver 검색광고 API가 반환하는
 * 관련 키워드 전체(씨드 포함)를 검색량 + 경쟁상품수와 함께 반환한다.
 */
export async function expandKeywords(seeds: string[]): Promise<KeywordStat[]> {
  const apiKey = process.env.NAVER_AD_API_KEY;
  const secretKey = process.env.NAVER_AD_SECRET_KEY;
  const customerId = process.env.NAVER_AD_CUSTOMER_ID;

  if (!apiKey || !secretKey || !customerId) return [];

  // 5개씩 배치로 나눠 검색광고 API 호출 → 모든 관련 키워드 수집
  const batches: string[][] = [];
  for (let i = 0; i < seeds.length; i += AD_BATCH_SIZE) {
    batches.push(seeds.slice(i, i + AD_BATCH_SIZE));
  }

  const volumeMap = new Map<string, number>();
  for (const batch of batches) {
    const timestamp = Date.now().toString();
    const path = '/keywordstool';
    const signature = buildSignature(timestamp, 'GET', path, secretKey);
    const query = batch.map(encodeURIComponent).join(',');

    try {
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
      if (!res.ok) continue;
      const json = await res.json();
      const stats = parseKeywordStats(json);
      for (const s of stats) {
        if (!volumeMap.has(s.keyword)) {
          volumeMap.set(s.keyword, s.searchVolume);
        }
      }
    } catch {
      // 배치 실패는 건너뜀
    }
  }

  if (volumeMap.size === 0) return [];

  const relatedKeywords = Array.from(volumeMap.keys());
  const competitorMap = await fetchCompetitorCounts(relatedKeywords);

  return relatedKeywords.map((kw) => ({
    keyword: kw,
    searchVolume: volumeMap.get(kw) ?? null,
    competitorCount: competitorMap.get(kw) ?? null,
  }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/lib/naver-ad-expand.test.ts 2>&1 | tail -10
```

예상: `3 tests | 3 passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/naver-ad.ts src/__tests__/lib/naver-ad-expand.test.ts
git commit -m "feat: add expandKeywords for seed-based keyword expansion"
```

---

### Task 4: 일일 크론 — `/api/sourcing/cron/trend-seeds`

**Files:**
- Create: `src/app/api/sourcing/cron/trend-seeds/route.ts`
- Test: `src/__tests__/api/cron-trend-seeds.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/api/cron-trend-seeds.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/sourcing/trend-discovery', () => ({
  discoverTrendSeeds: vi.fn(),
}));

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({ rowCount: 1 }),
  }),
}));

import { GET } from '@/app/api/sourcing/cron/trend-seeds/route';
import { discoverTrendSeeds } from '@/lib/sourcing/trend-discovery';
import { getSourcingPool } from '@/lib/sourcing/db';

function makeRequest(token: string) {
  return new NextRequest('http://localhost/api/sourcing/cron/trend-seeds', {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /api/sourcing/cron/trend-seeds', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.clearAllMocks();
  });

  it('올바른 토큰으로 씨드를 저장하고 200 반환', async () => {
    (discoverTrendSeeds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { keyword: '캠핑의자', source: 'youtube', reason: '트렌드' },
    ]);

    const res = await GET(makeRequest('test-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.saved).toBe(1);
  });

  it('잘못된 토큰이면 401 반환', async () => {
    const res = await GET(makeRequest('wrong-token'));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRET 없으면 500 반환', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(makeRequest('any'));
    expect(res.status).toBe(500);
  });

  it('씨드 없으면 saved=0', async () => {
    (discoverTrendSeeds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();
    expect(body.data.saved).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/api/cron-trend-seeds.test.ts 2>&1 | tail -10
```

예상: `Cannot find module '@/app/api/sourcing/cron/trend-seeds/route'`

- [ ] **Step 3: 구현**

```typescript
// src/app/api/sourcing/cron/trend-seeds/route.ts
import { NextRequest } from 'next/server';
import { discoverTrendSeeds } from '@/lib/sourcing/trend-discovery';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ success: false, error: '서버 설정 오류' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (token !== cronSecret) {
    return Response.json({ success: false, error: '인증 실패' }, { status: 401 });
  }

  const seeds = await discoverTrendSeeds();
  if (seeds.length === 0) {
    return Response.json({ success: true, data: { saved: 0 } });
  }

  const pool = getSourcingPool();
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const seedDate = kstNow.toISOString().slice(0, 10);

  let saved = 0;
  for (const seed of seeds) {
    try {
      const result = await pool.query(
        `INSERT INTO trend_seeds (seed_date, keyword, source, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (seed_date, keyword) DO NOTHING`,
        [seedDate, seed.keyword, seed.source, seed.reason],
      );
      if ((result.rowCount ?? 0) > 0) saved++;
    } catch (err) {
      console.error('[cron/trend-seeds] 저장 실패:', seed.keyword, err);
    }
  }

  console.info(`[cron/trend-seeds] ${seedDate}: ${saved}/${seeds.length}개 저장`);
  return Response.json({ success: true, data: { saved, total: seeds.length, seedDate } });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/api/cron-trend-seeds.test.ts 2>&1 | tail -10
```

예상: `4 tests | 4 passed`

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/cron/trend-seeds/route.ts src/__tests__/api/cron-trend-seeds.test.ts
git commit -m "feat: add daily cron to collect trend seeds via Gemini grounding"
```

---

### Task 5: 키워드 발굴 API — `/api/ai/keyword-discover`

**Files:**
- Create: `src/app/api/ai/keyword-discover/route.ts`
- Test: `src/__tests__/api/keyword-discover.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/api/keyword-discover.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
  RATE_LIMITS: { AI_API: {} },
}));

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: vi.fn().mockReturnValue({
    query: vi.fn(),
  }),
}));

vi.mock('@/lib/naver-ad', () => ({
  expandKeywords: vi.fn(),
}));

vi.mock('@/app/api/ai/keyword-evaluate/route', () => ({
  evaluateKeyword: vi.fn(),
}));

import { POST } from '@/app/api/ai/keyword-discover/route';
import { getSourcingPool } from '@/lib/sourcing/db';
import { expandKeywords } from '@/lib/naver-ad';
import { evaluateKeyword } from '@/app/api/ai/keyword-evaluate/route';

function makeRequest() {
  return new NextRequest('http://localhost/api/ai/keyword-discover', { method: 'POST' });
}

describe('POST /api/ai/keyword-discover', () => {
  beforeEach(() => vi.clearAllMocks());

  it('씨드 → 확장 → 필터 → AI 평가 후 200 반환', async () => {
    const pool = getSourcingPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ keyword: '캠핑의자', source: 'youtube', reason: '트렌드' }],
    });

    (expandKeywords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { keyword: '캠핑의자', searchVolume: 5000, competitorCount: 200 },
      { keyword: '초저인기', searchVolume: 500, competitorCount: 100 }, // 검색량 부족 → 필터 제외
      { keyword: '포화시장', searchVolume: 10000, competitorCount: 9000 }, // 경쟁 과다 → 필터 제외
    ]);

    (evaluateKeyword as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      pass: true,
      reasoning: '진입 가능',
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.keywords).toHaveLength(1);
    expect(body.data.keywords[0].keyword).toBe('캠핑의자');
    expect(body.data.keywords[0].pass).toBe(true);
  });

  it('씨드 없으면 폴백 씨드 사용', async () => {
    const pool = getSourcingPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    (expandKeywords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const res = await POST(makeRequest());
    expect(expandKeywords).toHaveBeenCalledWith(
      expect.arrayContaining(['주방용품']),
    );
  });

  it('필터 조건 — 검색량 2000 미만은 제외', async () => {
    const pool = getSourcingPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [{ keyword: 'test', source: 'naver', reason: '' }] });
    (expandKeywords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { keyword: '저검색', searchVolume: 1999, competitorCount: 100 },
    ]);

    const res = await POST(makeRequest());
    const body = await res.json();
    expect(body.data.keywords).toHaveLength(0);
    expect(evaluateKeyword).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/api/keyword-discover.test.ts 2>&1 | tail -10
```

예상: `Cannot find module '@/app/api/ai/keyword-discover/route'`

- [ ] **Step 3: 구현**

```typescript
// src/app/api/ai/keyword-discover/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';
import { getSourcingPool } from '@/lib/sourcing/db';
import { expandKeywords } from '@/lib/naver-ad';
import { evaluateKeyword } from '@/app/api/ai/keyword-evaluate/route';

const FALLBACK_SEEDS = ['주방용품', '생활용품', '청소용품', '반려동물', '캠핑용품'];
const MIN_SEARCH_VOLUME = 2_000;
const MAX_SEARCH_VOLUME = 50_000;
const MAX_COMPETITOR_COUNT = 500;
const MAX_EVALUATE = 30;

export interface DiscoveredKeyword {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  pass: boolean | null;
  reasoning: string | null;
}

interface ApiSuccessResponse {
  success: true;
  data: { keywords: DiscoveredKeyword[]; seedCount: number };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse> | Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
  const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'keyword-discover'), RATE_LIMITS.AI_API);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() } },
    );
  }

  // 1. 오늘 씨드 조회
  const pool = getSourcingPool();
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = kstNow.toISOString().slice(0, 10);

  let seeds: string[];
  try {
    const result = await pool.query<{ keyword: string }>(
      `SELECT keyword FROM trend_seeds WHERE seed_date = $1 ORDER BY id`,
      [today],
    );
    seeds = result.rows.map((r) => r.keyword);
  } catch {
    seeds = [];
  }

  if (seeds.length === 0) {
    seeds = FALLBACK_SEEDS;
  }

  // 2. 키워드 확장
  let expanded: Awaited<ReturnType<typeof expandKeywords>>;
  try {
    expanded = await expandKeywords(seeds);
  } catch {
    expanded = [];
  }

  // 3. 필터
  const filtered = expanded.filter(
    (k) =>
      k.searchVolume !== null &&
      k.competitorCount !== null &&
      k.searchVolume >= MIN_SEARCH_VOLUME &&
      k.searchVolume <= MAX_SEARCH_VOLUME &&
      k.competitorCount < MAX_COMPETITOR_COUNT,
  );

  // 검색량 내림차순, 상위 MAX_EVALUATE개
  filtered.sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0));
  const toEvaluate = filtered.slice(0, MAX_EVALUATE);

  // 4. AI 평가
  const evaluated = await Promise.all(
    toEvaluate.map(async (k): Promise<DiscoveredKeyword> => {
      try {
        const result = await evaluateKeyword({
          keyword: k.keyword,
          searchVolume: k.searchVolume!,
          competitorCount: k.competitorCount!,
        });
        return {
          keyword: k.keyword,
          searchVolume: k.searchVolume!,
          competitorCount: k.competitorCount!,
          pass: result.pass,
          reasoning: result.reasoning,
        };
      } catch {
        return {
          keyword: k.keyword,
          searchVolume: k.searchVolume!,
          competitorCount: k.competitorCount!,
          pass: null,
          reasoning: null,
        };
      }
    }),
  );

  return NextResponse.json({
    success: true,
    data: { keywords: evaluated, seedCount: seeds.length },
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/api/keyword-discover.test.ts 2>&1 | tail -10
```

예상: `3 tests | 3 passed`

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/keyword-discover/route.ts src/__tests__/api/keyword-discover.test.ts
git commit -m "feat: add keyword-discover API with seed expansion and AI evaluation"
```

---

### Task 6: UI — KeywordTrackerTab에 "키워드 발굴" 버튼 추가

**Files:**
- Modify: `src/components/sourcing/KeywordTrackerTab.tsx`
- Test: `src/__tests__/components/keyword-discover-ui.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/components/keyword-discover-ui.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.resolve(__dirname, '../../components/sourcing/KeywordTrackerTab.tsx'),
  'utf-8',
);

describe('KeywordTrackerTab — 키워드 발굴 UI', () => {
  it('"키워드 발굴" 버튼 텍스트가 있다', () => {
    expect(src).toContain('키워드 발굴');
  });

  it('/api/ai/keyword-discover 엔드포인트를 호출한다', () => {
    expect(src).toContain('keyword-discover');
  });

  it('DiscoveredKeyword 타입이 있다', () => {
    expect(src).toMatch(/DiscoveredKeyword|discoverKeywords|discoverResult/);
  });

  it('isDiscovering 로딩 상태가 있다', () => {
    expect(src).toContain('isDiscovering');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/components/keyword-discover-ui.test.ts 2>&1 | tail -10
```

예상: 일부 또는 전체 실패

- [ ] **Step 3: KeywordTrackerTab.tsx 수정**

먼저 현재 파일을 읽고, 아래 변경 사항을 적용한다:

**3a. 타입 추가** (SuggestedKeyword 근처에):
```typescript
interface DiscoveredKeyword {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  pass: boolean | null;
  reasoning: string | null;
}
```

**3b. state 추가** (기존 isSuggesting state 근처에):
```typescript
const [isDiscovering, setIsDiscovering] = useState(false);
const [discoverResults, setDiscoverResults] = useState<DiscoveredKeyword[]>([]);
const [showDiscoverModal, setShowDiscoverModal] = useState(false);
```

**3c. 핸들러 추가** (handleSuggest 함수 다음에):
```typescript
const handleDiscover = async () => {
  setIsDiscovering(true);
  setDiscoverResults([]);
  try {
    const res = await fetch('/api/ai/keyword-discover', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      setDiscoverResults(json.data.keywords);
      setShowDiscoverModal(true);
    }
  } catch {
    // silently fail
  } finally {
    setIsDiscovering(false);
  }
};
```

**3d. 버튼 추가** (기존 "AI 추천" 버튼 바로 다음에):
```tsx
<button
  onClick={handleDiscover}
  disabled={isDiscovering}
  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
>
  {isDiscovering ? '발굴 중...' : '키워드 발굴'}
</button>
```

**3e. 발굴 결과 모달 추가** (기존 제안 모달 바로 아래에 동일 패턴으로):
```tsx
{showDiscoverModal && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">키워드 발굴 결과</h3>
        <button onClick={() => setShowDiscoverModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
      </div>
      {discoverResults.length === 0 ? (
        <p className="text-gray-500 text-center py-8">발굴된 키워드가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {discoverResults.map((kw) => (
            <div key={kw.keyword} className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <span className="font-medium">{kw.keyword}</span>
                <span className="text-xs text-gray-500">검색량 {kw.searchVolume.toLocaleString()}</span>
                <span className="text-xs text-gray-500">경쟁 {kw.competitorCount.toLocaleString()}</span>
                {kw.pass === true && (
                  <span title={kw.reasoning ?? undefined} className="text-green-600 cursor-help">✅</span>
                )}
                {kw.pass === false && (
                  <span title={kw.reasoning ?? undefined} className="text-red-500 cursor-help">❌</span>
                )}
              </div>
              <button
                onClick={() => {
                  setShowDiscoverModal(false);
                  setKeyword(kw.keyword);
                  setSearchVolume(String(kw.searchVolume));
                  setCompetitorCount(String(kw.competitorCount));
                }}
                className="text-sm text-blue-600 hover:underline"
              >
                사용
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/components/keyword-discover-ui.test.ts 2>&1 | tail -10
```

예상: `4 tests | 4 passed`

- [ ] **Step 5: 커밋**

```bash
git add src/components/sourcing/KeywordTrackerTab.tsx src/__tests__/components/keyword-discover-ui.test.ts
git commit -m "feat: add 키워드 발굴 button and result modal to KeywordTrackerTab"
```

---

### Task 7: vercel.json — 크론 스케줄 추가

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: vercel.json에 크론 추가**

기존 crons 배열에 추가:
```json
{
  "path": "/api/sourcing/cron/trend-seeds",
  "schedule": "0 2 * * *"
}
```
(UTC 02:00 = KST 11:00)

- [ ] **Step 2: 확인**

```bash
cat vercel.json | grep -A 3 "trend-seeds"
```

예상: `"path": "/api/sourcing/cron/trend-seeds"` 출력

- [ ] **Step 3: TypeScript 빌드 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | head -20
```

예상: 에러 없음

- [ ] **Step 4: 전체 테스트 통과 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run 2>&1 | tail -20
```

예상: 모든 테스트 통과

- [ ] **Step 5: 커밋**

```bash
git add vercel.json
git commit -m "feat: schedule daily trend-seeds cron at KST 11:00"
```

---

## 완료 조건

- [ ] `trend_seeds` 테이블이 Render PostgreSQL에 생성됨
- [ ] `discoverTrendSeeds()` Gemini google_search 정상 호출
- [ ] `expandKeywords()` hintKeywords 기반 관련 키워드 확장
- [ ] 크론이 vercel.json에 등록됨
- [ ] `/api/ai/keyword-discover` POST: 씨드→확장→필터→평가 전체 파이프라인 동작
- [ ] KeywordTrackerTab에 "키워드 발굴" 버튼 표시 및 결과 모달 동작
- [ ] 전체 테스트 통과 (`npx vitest run`)
- [ ] TypeScript 빌드 에러 없음 (`npx tsc --noEmit`)
