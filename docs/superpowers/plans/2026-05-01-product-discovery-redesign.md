# 상품 발굴 (Product Discovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시드 발굴 탭을 "상품 발굴" 탭으로 재구성한다 — 사용자가 텍스트 또는 도매꾹 URL로 상품을 입력 → AI가 키워드 후보를 제안 → 검색량/CTR 자동 검증 + 쿠팡 리뷰 수동 입력 → 통과 키워드와 상품 정보를 상품등록 탭으로 자동 전달.

**Architecture:** 3단계 워크플로우(입력 → 검증 → 결과·등록)로 압축. 기존 `seed_sessions` DB 테이블, `seed-scoring.ts` 산식, 검증 UI(`StepReviewInput`)를 재활용. 신규 작성: AI 키워드 추출(Gemini), 도매꾹 URL 파서, 4개 API 라우트, Step 1 컴포넌트, 상품등록 탭의 `?draftId=` 핸들러.

**Tech Stack:** Next.js 14 App Router · TypeScript · Zustand · Vitest + React Testing Library · Naver Ad/Shopping API · Gemini 2.0 Flash · PostgreSQL (Render).

**Spec:** `docs/superpowers/specs/2026-05-01-product-discovery-redesign-design.md`

---

## File Structure

### 신규 작성
```
src/lib/sourcing/
├─ ai-keyword-extract.ts            상품명 → 5~10 키워드 (Gemini)
├─ domeggook-url-parser.ts          도매꾹 URL → ProductInfo
└─ product-discovery-pipeline.ts    검증 파이프라인 (자동완성+검색량+경쟁수)

src/app/api/sourcing/product-discover/
├─ extract-keywords/route.ts        POST  AI 키워드 추출
├─ parse-url/route.ts                POST  도매꾹 URL 파싱
├─ validate/route.ts                 POST  키워드 → 검증 결과
└─ confirm/route.ts                  POST  통과 키워드 + 상품 → DB 저장 → draftId

src/components/sourcing/steps/
├─ StepProductInput.tsx              Step 1: 입력 + AI 추출 + 키워드 칩
├─ StepValidation.tsx                Step 2: 검색량 표시 + 쿠팡 리뷰 입력
└─ StepResult.tsx                    Step 3: 결과 + 상품등록 보내기

src/components/sourcing/ProductDiscoveryTab.tsx     ← (SeedDiscoveryTab.tsx 후 삭제)
src/store/useProductDiscoveryStore.ts                ← (useSeedDiscoveryStore.ts 후 삭제)

src/__tests__/
├─ lib/ai-keyword-extract.test.ts
├─ lib/domeggook-url-parser.test.ts
├─ api/product-discover-extract.test.ts
├─ api/product-discover-validate.test.ts
└─ api/product-discover-confirm.test.ts
```

### 수정
```
src/types/sourcing.ts                          ProductInfo, ProductCandidate 타입 추가
src/components/sourcing/SourcingDashboard.tsx  SeedDiscoveryTab → ProductDiscoveryTab
src/components/listing/ListingDashboard.tsx    ?draftId= 파라미터 핸들링
src/store/useListingStore.ts                   loadSharedDraftFromDiscovery 액션
```

### 삭제 (마지막 task)
```
src/components/sourcing/SeedDiscoveryTab.tsx
src/store/useSeedDiscoveryStore.ts
src/app/api/sourcing/seed-discover/route.ts
src/app/api/sourcing/seed-discover/confirm/route.ts
src/app/api/sourcing/seed-discover/sessions/route.ts
```

---

## Task 1: 타입 정의 추가

**Files:**
- Modify: `src/types/sourcing.ts` (마지막에 추가)

- [ ] **Step 1: 타입 추가**

`src/types/sourcing.ts` 마지막에 다음 추가:

```typescript
// ─────────────────────────────────────────────────────────────
// 상품 발굴 (Product Discovery) — 2026-05-01
// ─────────────────────────────────────────────────────────────

export interface ProductInfo {
  source: 'manual' | 'domeggook';
  title: string;
  image?: string | null;
  price?: number | null;        // 도매가
  supplyPrice?: number | null;  // 공급가
  marketPrice?: number | null;  // 시장가 (네이버 최저가)
  itemNo?: number | null;       // 도매꾹 상품번호 (있는 경우만)
  url?: string | null;          // 원본 URL
}

export interface ValidatedKeyword {
  keyword: string;
  searchVolume: number | null;
  competitorCount: number | null;
  compIdx: '낮음' | '중간' | '높음' | null;
  avgCtr: number | null;
  topReviewCount: number | null;   // 사용자 입력 (쿠팡)
  seedScore: number | null;
  seedGrade: 'S' | 'A' | 'B' | 'C' | 'D' | null;
  isSelected: boolean;             // 결과 화면 체크박스
  isBlocked: boolean;              // 리뷰 50개 이상 자동 탈락
  blockedReason: string | null;
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep -E "sourcing\.ts" | head
```

Expected: 에러 없음 (출력 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/types/sourcing.ts
git commit -m "feat(types): ProductInfo · ValidatedKeyword 타입 추가"
```

---

## Task 2: AI 키워드 추출 라이브러리

**Files:**
- Create: `src/lib/sourcing/ai-keyword-extract.ts`
- Test: `src/__tests__/lib/ai-keyword-extract.test.ts`

**Tech 결정:** Gemini 2.0 Flash 사용 — 저비용·한국어 OK·기존 `src/lib/ai/gemini.ts` 재활용

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/ai-keyword-extract.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gemini 모킹 (전역)
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn(),
}));

import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';
import { getGeminiGenAI } from '@/lib/ai/gemini';

describe('extractKeywordsFromProduct', () => {
  beforeEach(() => vi.clearAllMocks());

  it('정상 응답 → 키워드 배열 반환', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: '{"keywords":["펜트리수납함","슬라이드수납함","16cm수납함","주방펜트리","슬라이드정리함"]}',
    });
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: mockGenerate },
    });

    const result = await extractKeywordsFromProduct('16cm 펜트리수납함 슬라이드형');
    expect(result).toEqual(['펜트리수납함', '슬라이드수납함', '16cm수납함', '주방펜트리', '슬라이드정리함']);
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it('JSON 파싱 실패 → null 반환', async () => {
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: vi.fn().mockResolvedValue({ text: '잘못된 응답' }) },
    });

    const result = await extractKeywordsFromProduct('아무 상품');
    expect(result).toBeNull();
  });

  it('API 호출 에러 → null 반환', async () => {
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error('rate limit')) },
    });

    const result = await extractKeywordsFromProduct('아무 상품');
    expect(result).toBeNull();
  });

  it('keywords 필드가 배열이 아니면 → null', async () => {
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: vi.fn().mockResolvedValue({ text: '{"keywords": "not-array"}' }) },
    });

    const result = await extractKeywordsFromProduct('아무 상품');
    expect(result).toBeNull();
  });

  it('빈 상품명 → null (API 호출 안 함)', async () => {
    const mockGenerate = vi.fn();
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: mockGenerate },
    });

    const result = await extractKeywordsFromProduct('   ');
    expect(result).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('JSON에 markdown 코드 펜스 → 제거 후 파싱', async () => {
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: vi.fn().mockResolvedValue({
        text: '```json\n{"keywords":["가","나"]}\n```',
      }) },
    });

    const result = await extractKeywordsFromProduct('아무 상품');
    expect(result).toEqual(['가', '나']);
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npx vitest run src/__tests__/lib/ai-keyword-extract.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '@/lib/sourcing/ai-keyword-extract'`

- [ ] **Step 3: 라이브러리 작성**

`src/lib/sourcing/ai-keyword-extract.ts`:

```typescript
import { getGeminiGenAI } from '@/lib/ai/gemini';

const PROMPT_TEMPLATE = `당신은 한국 e-commerce 키워드 발굴 전문가입니다.

다음 상품을 보고, 한국 소비자가 쿠팡/네이버 쇼핑에서 검색할 만한
키워드 후보를 5~10개 제안해 주세요.

상품명: {{TITLE}}

원칙:
1. 단순한 카테고리어("수납함", "방향제")는 피하고, 2단어 이상 조합 위주
2. 사용 상황/속성/타겟을 포함한 long-tail 키워드 위주
3. 너무 좁지도 너무 넓지도 않은 검색량 3k~15k 범위가 가능한 키워드
4. 각 키워드는 한국어, 띄어쓰기 없는 형태 또는 자연스러운 형태

JSON으로만 답하세요. 다른 설명 금지.

{
  "keywords": ["키워드1", "키워드2", ...]
}`;

/**
 * 상품 제목으로부터 5~10개의 키워드 후보를 Gemini로 추출.
 * 실패 시 null 반환 — 호출자는 사용자 직접 입력 fallback.
 */
export async function extractKeywordsFromProduct(
  productTitle: string,
): Promise<string[] | null> {
  const trimmed = productTitle.trim();
  if (!trimmed) return null;

  try {
    const ai = getGeminiGenAI();
    const prompt = PROMPT_TEMPLATE.replace('{{TITLE}}', trimmed);
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    const raw = (response as { text?: string }).text ?? '';
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '');

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }

    const obj = parsed as { keywords?: unknown };
    if (!Array.isArray(obj.keywords)) return null;
    const keywords = obj.keywords.filter((k): k is string => typeof k === 'string' && k.length > 0);
    return keywords.length > 0 ? keywords : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/ai-keyword-extract.test.ts 2>&1 | tail -10
```

Expected: PASS — 6 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/ai-keyword-extract.ts src/__tests__/lib/ai-keyword-extract.test.ts
git commit -m "feat(sourcing): AI 키워드 추출 라이브러리 (Gemini 2.0 Flash)"
```

---

## Task 3: 도매꾹 URL 파서

**Files:**
- Create: `src/lib/sourcing/domeggook-url-parser.ts`
- Test: `src/__tests__/lib/domeggook-url-parser.test.ts`

기존 `getDomeggookClient().getItemView(itemNo)`를 재활용해 itemNo만 추출하면 됨.

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/domeggook-url-parser.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sourcing/domeggook-client', () => ({
  getDomeggookClient: vi.fn(),
}));

import { extractItemNoFromUrl, parseDomeggookUrl } from '@/lib/sourcing/domeggook-url-parser';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';

describe('extractItemNoFromUrl', () => {
  it('정상 도매꾹 URL → itemNo 추출', () => {
    const cases = [
      ['https://domeggook.com/main/item.php?id=12345678', 12345678],
      ['https://www.domeggook.com/main/item.php?id=99999', 99999],
      ['https://domeggook.com/main/item.php?id=12345&abc=def', 12345],
      ['http://domeggook.com/main/item.php?id=1', 1],
    ];
    for (const [url, expected] of cases) {
      expect(extractItemNoFromUrl(url as string)).toBe(expected);
    }
  });

  it('지원 안 되는 URL → null', () => {
    const cases = [
      'https://1688.com/item/123',
      'https://aliexpress.com/i/123',
      'https://coupang.com/np/products/123',
      '',
      'not a url',
      'https://domeggook.com/main/index.php',
      'https://domeggook.com/main/item.php', // id 없음
    ];
    for (const url of cases) expect(extractItemNoFromUrl(url)).toBeNull();
  });
});

describe('parseDomeggookUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('URL 파싱 + getItemView 호출 → ProductInfo', async () => {
    const mockGetItemView = vi.fn().mockResolvedValue({
      basis: { no: 12345, title: '테스트 상품' },
      thumb: { original: 'https://example.com/img.jpg' },
      price: { dome: 5000, supply: 8000 },
    });
    (getDomeggookClient as ReturnType<typeof vi.fn>).mockReturnValue({
      getItemView: mockGetItemView,
    });

    const result = await parseDomeggookUrl('https://domeggook.com/main/item.php?id=12345');
    expect(result).toEqual({
      source: 'domeggook',
      title: '테스트 상품',
      image: 'https://example.com/img.jpg',
      price: 5000,
      supplyPrice: 8000,
      marketPrice: null,
      itemNo: 12345,
      url: 'https://domeggook.com/main/item.php?id=12345',
    });
  });

  it('비-도매꾹 URL → null', async () => {
    const result = await parseDomeggookUrl('https://1688.com/item/123');
    expect(result).toBeNull();
  });

  it('getItemView 실패 → null', async () => {
    (getDomeggookClient as ReturnType<typeof vi.fn>).mockReturnValue({
      getItemView: vi.fn().mockRejectedValue(new Error('차단')),
    });

    const result = await parseDomeggookUrl('https://domeggook.com/main/item.php?id=12345');
    expect(result).toBeNull();
  });

  it('가격이 string으로 와도 number 변환', async () => {
    (getDomeggookClient as ReturnType<typeof vi.fn>).mockReturnValue({
      getItemView: vi.fn().mockResolvedValue({
        basis: { no: 1, title: 'a' },
        price: { dome: '5000', supply: '8000' },
      }),
    });
    const result = await parseDomeggookUrl('https://domeggook.com/main/item.php?id=1');
    expect(result?.price).toBe(5000);
    expect(result?.supplyPrice).toBe(8000);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/domeggook-url-parser.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '@/lib/sourcing/domeggook-url-parser'`

- [ ] **Step 3: 파서 작성**

`src/lib/sourcing/domeggook-url-parser.ts`:

```typescript
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import type { ProductInfo } from '@/types/sourcing';

const DOMEGGOOK_ITEM_REGEX = /^https?:\/\/(?:www\.)?domeggook\.com\/main\/item\.php\?(?:[^&#]*&)*id=(\d+)/i;

/**
 * 도매꾹 상품 페이지 URL에서 상품번호(itemNo)를 추출.
 * 도매꾹 URL이 아니거나 id 파라미터가 없으면 null.
 */
export function extractItemNoFromUrl(url: string): number | null {
  const m = url.match(DOMEGGOOK_ITEM_REGEX);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * 도매꾹 URL → 상품 정보 추출.
 * 지원 안 되는 URL이거나 API 실패 시 null.
 */
export async function parseDomeggookUrl(url: string): Promise<ProductInfo | null> {
  const itemNo = extractItemNoFromUrl(url);
  if (itemNo === null) return null;

  try {
    const client = getDomeggookClient();
    const detail = await client.getItemView(itemNo);
    return {
      source: 'domeggook',
      title: detail.basis?.title ?? `상품 #${itemNo}`,
      image: detail.thumb?.original ?? detail.image?.url ?? null,
      price: toNum(detail.price?.dome),
      supplyPrice: toNum(detail.price?.supply),
      marketPrice: null,
      itemNo,
      url,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: getDomeggookClient 함수 확인**

`src/lib/sourcing/domeggook-client.ts`에 `getDomeggookClient()` export가 있는지 확인:

```bash
grep -n "export function getDomeggookClient\|export const getDomeggookClient" src/lib/sourcing/domeggook-client.ts
```

Expected: 1줄 출력. 없으면 다음 추가 (파일 끝에):

```typescript
let _client: DomeggookClient | null = null;
export function getDomeggookClient(): DomeggookClient {
  if (!_client) _client = new DomeggookClient();
  return _client;
}
```

이미 있다면 Step 5로.

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/domeggook-url-parser.test.ts 2>&1 | tail -10
```

Expected: PASS — 5+ tests passed

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sourcing/domeggook-url-parser.ts src/__tests__/lib/domeggook-url-parser.test.ts
git commit -m "feat(sourcing): 도매꾹 URL → ProductInfo 파서"
```

---

## Task 4: API — `/parse-url` 라우트

**Files:**
- Create: `src/app/api/sourcing/product-discover/parse-url/route.ts`

- [ ] **Step 1: 라우트 작성**

`src/app/api/sourcing/product-discover/parse-url/route.ts`:

```typescript
/**
 * POST /api/sourcing/product-discover/parse-url
 * 도매꾹 URL → ProductInfo (이름, 이미지, 가격)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { parseDomeggookUrl } from '@/lib/sourcing/domeggook-url-parser';

const requestSchema = z.object({
  url: z.string().url(),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'URL이 올바르지 않습니다' }, { status: 400 });
  }

  const productInfo = await parseDomeggookUrl(parsed.data.url);
  if (!productInfo) {
    return NextResponse.json(
      { success: false, error: '지원하지 않는 URL이거나 도매꾹에서 상품 정보를 가져올 수 없습니다' },
      { status: 422 },
    );
  }

  return NextResponse.json({ success: true, data: productInfo });
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep -E "parse-url" | head
```

Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/sourcing/product-discover/parse-url/route.ts
git commit -m "feat(api): /api/sourcing/product-discover/parse-url 라우트"
```

---

## Task 5: API — `/extract-keywords` 라우트

**Files:**
- Create: `src/app/api/sourcing/product-discover/extract-keywords/route.ts`
- Test: `src/__tests__/api/product-discover-extract.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/api/product-discover-extract.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));
vi.mock('@/lib/sourcing/ai-keyword-extract', () => ({
  extractKeywordsFromProduct: vi.fn(),
}));

import { POST } from '@/app/api/sourcing/product-discover/extract-keywords/route';
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';

const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/sourcing/product-discover/extract-keywords', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/sourcing/product-discover/extract-keywords', () => {
  beforeEach(() => vi.clearAllMocks());

  it('정상 → 키워드 배열 반환', async () => {
    (extractKeywordsFromProduct as ReturnType<typeof vi.fn>).mockResolvedValue(['a', 'b', 'c']);
    const res = await POST(makeReq({ productTitle: '16cm 펜트리수납함' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.keywords).toEqual(['a', 'b', 'c']);
  });

  it('AI 실패 → 200 + 빈 배열 (사용자 직접 입력 fallback)', async () => {
    (extractKeywordsFromProduct as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeReq({ productTitle: '아무 상품' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.keywords).toEqual([]);
    expect(json.data.aiFailed).toBe(true);
  });

  it('빈 상품명 → 400', async () => {
    const res = await POST(makeReq({ productTitle: '   ' }));
    expect(res.status).toBe(400);
  });

  it('잘못된 body → 400', async () => {
    const res = await POST(makeReq({ wrong: 'field' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/product-discover-extract.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: 라우트 작성**

`src/app/api/sourcing/product-discover/extract-keywords/route.ts`:

```typescript
/**
 * POST /api/sourcing/product-discover/extract-keywords
 * 상품명 → AI 키워드 5~10개 후보
 * AI 실패 시 빈 배열 + aiFailed=true 반환 (UI에서 사용자 직접 입력 fallback)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';

const requestSchema = z.object({
  productTitle: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '상품명이 필요합니다' }, { status: 400 });
  }

  const trimmed = parsed.data.productTitle.trim();
  if (!trimmed) {
    return NextResponse.json({ success: false, error: '상품명이 비어 있습니다' }, { status: 400 });
  }

  const keywords = await extractKeywordsFromProduct(trimmed);
  if (keywords === null) {
    return NextResponse.json({
      success: true,
      data: { keywords: [], aiFailed: true },
    });
  }

  return NextResponse.json({
    success: true,
    data: { keywords, aiFailed: false },
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/product-discover-extract.test.ts 2>&1 | tail -10
```

Expected: PASS — 4 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/product-discover/extract-keywords/route.ts src/__tests__/api/product-discover-extract.test.ts
git commit -m "feat(api): /extract-keywords 라우트 + 테스트"
```

---

## Task 6: API — `/validate` 라우트 (검증 파이프라인)

**Files:**
- Create: `src/lib/sourcing/product-discovery-pipeline.ts`
- Create: `src/app/api/sourcing/product-discover/validate/route.ts`
- Test: `src/__tests__/api/product-discover-validate.test.ts`

기존 `seed-discover/route.ts`의 검증 파이프라인 (자동완성 → Naver Ad → Naver Shopping)을 재활용 가능한 함수로 추출.

- [ ] **Step 1: 파이프라인 함수 작성**

`src/lib/sourcing/product-discovery-pipeline.ts`:

```typescript
import { fetchKeywordDetails } from '@/lib/naver-ad';
import { NaverShoppingClient } from '@/lib/niche/naver-shopping';

export interface ValidationInput {
  /** 사용자가 확정한 키워드 셋 (5~7개) */
  keywords: string[];
}

export interface ValidationResult {
  keyword: string;
  searchVolume: number | null;
  competitorCount: number | null;
  compIdx: '낮음' | '중간' | '높음' | null;
  avgCtr: number | null;
}

/**
 * 키워드 셋 → 검색량 + 경쟁강도 + CTR + 경쟁상품수 일괄 검증
 *
 * Naver Ad keywordstool 5개 배치 호출 + Naver Shopping search 병렬 호출.
 * 데이터 없는 키워드는 null로 표시 (탈락 아님).
 */
export async function validateKeywords(
  input: ValidationInput,
): Promise<ValidationResult[]> {
  const trimmed = Array.from(new Set(
    input.keywords.map((k) => k.trim()).filter(Boolean),
  ));
  if (trimmed.length === 0) return [];

  // 1) Naver Ad: 검색량 + compIdx + CTR (5개씩 배치)
  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const detailMap = new Map<string, { vol: number; compIdx: '낮음'|'중간'|'높음'|null; avgCtr: number | null }>();

  const hints = trimmed.map((s) => s.replace(/\s+/g, ''));
  for (let i = 0; i < hints.length; i += 5) {
    const batch = hints.slice(i, i + 5);
    const list = await fetchKeywordDetails(batch).catch(() => []);
    for (const d of list) {
      const n = normalize(d.keyword);
      if (!detailMap.has(n)) {
        detailMap.set(n, { vol: d.searchVolume, compIdx: d.compIdx, avgCtr: d.avgCtr });
      }
    }
    if (i + 5 < hints.length) await new Promise((r) => setTimeout(r, 300));
  }

  // 2) Naver Shopping: 경쟁상품수 (병렬)
  const naver = new NaverShoppingClient();
  const compResults = await Promise.all(
    trimmed.map((kw) =>
      naver.searchShopping(kw, 1).then((r) => r.total).catch(() => null),
    ),
  );

  // 3) 결합
  return trimmed.map((kw, i) => {
    const ad = detailMap.get(normalize(kw));
    return {
      keyword: kw,
      searchVolume: ad?.vol ?? null,
      competitorCount: compResults[i],
      compIdx: ad?.compIdx ?? null,
      avgCtr: ad?.avgCtr ?? null,
    };
  });
}
```

- [ ] **Step 2: 라우트 테스트 작성**

`src/__tests__/api/product-discover-validate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));
vi.mock('@/lib/sourcing/product-discovery-pipeline', () => ({
  validateKeywords: vi.fn(),
}));

import { POST } from '@/app/api/sourcing/product-discover/validate/route';
import { validateKeywords } from '@/lib/sourcing/product-discovery-pipeline';

const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/sourcing/product-discover/validate', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/sourcing/product-discover/validate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('정상 → 검증 결과 반환', async () => {
    (validateKeywords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { keyword: '펜트리수납함', searchVolume: 6650, competitorCount: 102404, compIdx: '중간', avgCtr: 1.24 },
    ]);
    const res = await POST(makeReq({ keywords: ['펜트리수납함'] }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.results).toHaveLength(1);
    expect(json.data.results[0].keyword).toBe('펜트리수납함');
  });

  it('빈 키워드 배열 → 400', async () => {
    const res = await POST(makeReq({ keywords: [] }));
    expect(res.status).toBe(400);
  });

  it('keywords 필드 없음 → 400', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: 라우트 작성**

`src/app/api/sourcing/product-discover/validate/route.ts`:

```typescript
/**
 * POST /api/sourcing/product-discover/validate
 * 키워드 셋 → 검색량/CTR/경쟁상품수 검증
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { validateKeywords } from '@/lib/sourcing/product-discovery-pipeline';

const requestSchema = z.object({
  keywords: z.array(z.string().min(1).max(40)).min(1).max(15),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '키워드 1~15개가 필요합니다' }, { status: 400 });
  }

  const hasNaverAdKeys = !!(
    process.env.NAVER_AD_API_KEY &&
    process.env.NAVER_AD_SECRET_KEY &&
    process.env.NAVER_AD_CUSTOMER_ID
  );
  if (!hasNaverAdKeys) {
    return NextResponse.json(
      { success: false, error: 'Naver Ad API 키가 서버에 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  try {
    const results = await validateKeywords({ keywords: parsed.data.keywords });
    return NextResponse.json({ success: true, data: { results } });
  } catch (err) {
    console.error('[POST /validate]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '검증 실패' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/product-discover-validate.test.ts 2>&1 | tail -10
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/product-discovery-pipeline.ts src/app/api/sourcing/product-discover/validate/route.ts src/__tests__/api/product-discover-validate.test.ts
git commit -m "feat(api): /validate 라우트 + 검증 파이프라인 추출"
```

---

## Task 7: API — `/confirm` 라우트 (DB 저장 + draftId 발급)

**Files:**
- Create: `src/app/api/sourcing/product-discover/confirm/route.ts`
- Test: `src/__tests__/api/product-discover-confirm.test.ts`

기존 seed-discover/confirm 로직 재활용하되 ProductInfo 추가 저장.

- [ ] **Step 1: 테스트 작성**

`src/__tests__/api/product-discover-confirm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

import { POST } from '@/app/api/sourcing/product-discover/confirm/route';

const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/sourcing/product-discover/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const validBody = {
  productInfo: { source: 'manual', title: '테스트 상품' },
  keywords: [
    { keyword: '키워드1', searchVolume: 5000, competitorCount: 100000, compIdx: '낮음', avgCtr: 1.5, topReviewCount: 20, seedScore: 75, seedGrade: 'A' },
  ],
};

describe('POST /api/sourcing/product-discover/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it('새 세션 → INSERT + draftId 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'session-uuid' }] });

    const res = await POST(makeReq(validBody));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.draftId).toBe('session-uuid');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO seed_sessions/);
  });

  it('도매꾹 상품 → sourcing_items UPSERT 추가', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'session-uuid' }] })
      .mockResolvedValueOnce({ rows: [] }); // sourcing_items UPSERT

    const res = await POST(makeReq({
      ...validBody,
      productInfo: { source: 'domeggook', title: '도매꾹 상품', itemNo: 12345 },
    }));
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO sourcing_items/);
  });

  it('빈 키워드 → 400', async () => {
    const res = await POST(makeReq({ ...validBody, keywords: [] }));
    expect(res.status).toBe(400);
  });

  it('productInfo 없음 → 400', async () => {
    const res = await POST(makeReq({ keywords: validBody.keywords }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/product-discover-confirm.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: 라우트 작성**

`src/app/api/sourcing/product-discover/confirm/route.ts`:

```typescript
/**
 * POST /api/sourcing/product-discover/confirm
 * 통과 키워드 + 상품 정보 → seed_sessions 저장 → draftId 반환
 *
 * 도매꾹 상품(itemNo 있음)은 sourcing_items에도 UPSERT — 도매꾹 탭에서 시드 태그로 표시
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const productInfoSchema = z.object({
  source: z.enum(['manual', 'domeggook']),
  title: z.string().min(1).max(200),
  image: z.string().nullish(),
  price: z.number().nullish(),
  supplyPrice: z.number().nullish(),
  marketPrice: z.number().nullish(),
  itemNo: z.number().int().positive().nullish(),
  url: z.string().nullish(),
});

const keywordSchema = z.object({
  keyword: z.string().min(1),
  searchVolume: z.number().nullish(),
  competitorCount: z.number().nullish(),
  compIdx: z.enum(['낮음', '중간', '높음']).nullish(),
  avgCtr: z.number().nullish(),
  topReviewCount: z.number().nullish(),
  seedScore: z.number().nullish(),
  seedGrade: z.enum(['S', 'A', 'B', 'C', 'D']).nullish(),
});

const requestSchema = z.object({
  sessionId: z.string().uuid().nullish(),
  productInfo: productInfoSchema,
  keywords: z.array(keywordSchema).min(1).max(30),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 });
  }

  const { sessionId, productInfo, keywords } = parsed.data;
  const pool = getSourcingPool();

  try {
    // 1. seed_sessions INSERT or UPDATE
    const stateJson = JSON.stringify({ productInfo, keywords });
    let draftId: string;

    if (sessionId) {
      await pool.query(
        `UPDATE seed_sessions SET state_json = $1, status = 'confirmed',
                                  confirmed_at = now(), step = 7
         WHERE id = $2 AND user_id = $3`,
        [stateJson, sessionId, userId],
      );
      draftId = sessionId;
    } else {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO seed_sessions
           (user_id, categories, state_json, status, confirmed_at, step, winner_count)
         VALUES ($1, $2::text[], $3, 'confirmed', now(), 7, $4)
         RETURNING id`,
        [userId, [], stateJson, keywords.length],
      );
      draftId = row.rows[0].id;
    }

    // 2. 도매꾹 상품인 경우 sourcing_items UPSERT
    if (productInfo.source === 'domeggook' && productInfo.itemNo) {
      const topKeyword = keywords[0];
      await pool.query(
        `INSERT INTO sourcing_items
           (item_no, title, seed_keyword, seed_score, seed_session_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (item_no) DO UPDATE SET
           seed_keyword    = EXCLUDED.seed_keyword,
           seed_score      = EXCLUDED.seed_score,
           seed_session_id = EXCLUDED.seed_session_id`,
        [
          productInfo.itemNo,
          productInfo.title,
          topKeyword.keyword,
          topKeyword.seedScore ?? 0,
          draftId,
        ],
      );
    }

    return NextResponse.json({ success: true, data: { draftId } });
  } catch (err) {
    console.error('[POST /confirm]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '저장 실패' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/product-discover-confirm.test.ts 2>&1 | tail -10
```

Expected: PASS — 4 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/product-discover/confirm/route.ts src/__tests__/api/product-discover-confirm.test.ts
git commit -m "feat(api): /confirm 라우트 — DB 저장 + draftId 발급"
```

---

## Task 8: 새 Zustand 스토어 (`useProductDiscoveryStore`)

**Files:**
- Create: `src/store/useProductDiscoveryStore.ts`

기존 `useSeedDiscoveryStore`보다 단순화 — 카테고리/세션 이력 등 제거.

- [ ] **Step 1: 스토어 작성**

`src/store/useProductDiscoveryStore.ts`:

```typescript
/**
 * useProductDiscoveryStore.ts
 * 상품 발굴 탭 전역 상태 (3단계: 입력 → 검증 → 결과)
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ProductInfo, ValidatedKeyword } from '@/types/sourcing';
import { calcSeedScore, getSeedGrade } from '@/lib/sourcing/seed-scoring';

type Step = 1 | 2 | 3;

interface ProductDiscoveryStore {
  currentStep: Step;
  productInfo: ProductInfo | null;
  aiSuggestedKeywords: string[];
  selectedKeywords: string[];        // 사용자 확정 키워드 셋 (Step 1 끝에 결정)
  validated: ValidatedKeyword[];     // Step 2 검증 결과
  isExtractingAI: boolean;
  isValidating: boolean;
  isParsingUrl: boolean;
  isConfirming: boolean;
  error: string | null;

  setProductInfo: (info: ProductInfo | null) => void;
  parseUrl: (url: string) => Promise<void>;
  extractAIKeywords: () => Promise<void>;
  toggleKeyword: (kw: string) => void;
  addKeyword: (kw: string) => void;
  removeKeyword: (kw: string) => void;
  setSelectedKeywords: (kws: string[]) => void;

  startValidation: () => Promise<void>;
  setReviewCount: (kw: string, count: number) => void;
  goToResult: () => void;          // Step 2 → 3 이동 (DB 저장은 Step 3 버튼에서)
  toggleResultSelect: (kw: string) => void;

  confirmAndGetDraftId: () => Promise<string | null>;
  reset: () => void;
}

const initialState = {
  currentStep: 1 as Step,
  productInfo: null,
  aiSuggestedKeywords: [],
  selectedKeywords: [],
  validated: [],
  isExtractingAI: false,
  isValidating: false,
  isParsingUrl: false,
  isConfirming: false,
  error: null,
};

export const useProductDiscoveryStore = create<ProductDiscoveryStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setProductInfo: (info) => set({ productInfo: info }),

      parseUrl: async (url) => {
        set({ isParsingUrl: true, error: null });
        try {
          const res = await fetch('/api/sourcing/product-discover/parse-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });
          const json = await res.json();
          if (!json.success) {
            set({ error: json.error ?? 'URL 파싱 실패', isParsingUrl: false });
            return;
          }
          set({ productInfo: json.data, isParsingUrl: false });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'URL 파싱 실패', isParsingUrl: false });
        }
      },

      extractAIKeywords: async () => {
        const { productInfo } = get();
        if (!productInfo?.title) return;
        set({ isExtractingAI: true, error: null });
        try {
          const res = await fetch('/api/sourcing/product-discover/extract-keywords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productTitle: productInfo.title }),
          });
          const json = await res.json();
          if (!json.success) {
            set({ error: json.error ?? 'AI 추출 실패', isExtractingAI: false });
            return;
          }
          set({
            aiSuggestedKeywords: json.data.keywords,
            selectedKeywords: json.data.keywords, // default: 모두 선택
            isExtractingAI: false,
          });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'AI 추출 실패', isExtractingAI: false });
        }
      },

      toggleKeyword: (kw) => set((s) => ({
        selectedKeywords: s.selectedKeywords.includes(kw)
          ? s.selectedKeywords.filter((k) => k !== kw)
          : [...s.selectedKeywords, kw],
      })),

      addKeyword: (kw) => {
        const t = kw.trim();
        if (!t) return;
        set((s) => s.selectedKeywords.includes(t) ? s : { selectedKeywords: [...s.selectedKeywords, t] });
      },

      removeKeyword: (kw) => set((s) => ({
        selectedKeywords: s.selectedKeywords.filter((k) => k !== kw),
      })),

      setSelectedKeywords: (kws) => set({ selectedKeywords: kws }),

      startValidation: async () => {
        const { selectedKeywords } = get();
        if (selectedKeywords.length === 0) return;
        set({ isValidating: true, error: null, currentStep: 2 });
        try {
          const res = await fetch('/api/sourcing/product-discover/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: selectedKeywords }),
          });
          const json = await res.json();
          if (!json.success) {
            set({ error: json.error ?? '검증 실패', isValidating: false, currentStep: 1 });
            return;
          }
          const validated: ValidatedKeyword[] = json.data.results.map((r: {
            keyword: string;
            searchVolume: number | null;
            competitorCount: number | null;
            compIdx: '낮음' | '중간' | '높음' | null;
            avgCtr: number | null;
          }) => ({
            keyword: r.keyword,
            searchVolume: r.searchVolume,
            competitorCount: r.competitorCount,
            compIdx: r.compIdx,
            avgCtr: r.avgCtr,
            topReviewCount: null,
            seedScore: null,
            seedGrade: null,
            isSelected: true,
            isBlocked: false,
            blockedReason: null,
          }));
          set({ validated, isValidating: false });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : '검증 실패', isValidating: false, currentStep: 1 });
        }
      },

      setReviewCount: (kw, count) => set((s) => ({
        validated: s.validated.map((v) => {
          if (v.keyword !== kw) return v;
          const blocked = count >= 50;
          let scored: { score: number | null; grade: ValidatedKeyword['seedGrade'] } = { score: null, grade: null };
          if (!blocked && v.searchVolume !== null && v.competitorCount !== null) {
            const r = calcSeedScore({
              searchVolume: v.searchVolume,
              competitorCount: v.competitorCount,
              topReviewCount: count,
              marginRate: 30, // 마진은 별도 탭이라 default 30(=경계값)
              compIdx: v.compIdx,
              avgCtr: v.avgCtr,
            });
            scored = { score: r.total, grade: getSeedGrade(r.total) };
          }
          return {
            ...v,
            topReviewCount: count,
            isBlocked: blocked,
            blockedReason: blocked ? '쿠팡 상위 리뷰 50개 이상' : null,
            seedScore: scored.score,
            seedGrade: scored.grade,
            isSelected: !blocked && v.isSelected,
          };
        }),
      })),

      goToResult: () => set({ currentStep: 3 }),

      toggleResultSelect: (kw) => set((s) => ({
        validated: s.validated.map((v) =>
          v.keyword === kw && !v.isBlocked ? { ...v, isSelected: !v.isSelected } : v,
        ),
      })),

      confirmAndGetDraftId: async () => {
        const { productInfo, validated } = get();
        if (!productInfo) return null;

        const passed = validated.filter((v) => !v.isBlocked && v.isSelected);
        if (passed.length === 0) {
          set({ error: '선택된 통과 키워드가 없습니다' });
          return null;
        }

        set({ isConfirming: true, error: null });
        try {
          const res = await fetch('/api/sourcing/product-discover/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productInfo, keywords: passed }),
          });
          const json = await res.json();
          if (!json.success) {
            set({ error: json.error ?? '저장 실패', isConfirming: false });
            return null;
          }
          set({ isConfirming: false });
          return json.data.draftId as string;
        } catch (e) {
          set({ error: e instanceof Error ? e.message : '저장 실패', isConfirming: false });
          return null;
        }
      },

      reset: () => set(initialState),
    }),
    { name: 'ProductDiscovery' },
  ),
);
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep -E "useProductDiscoveryStore|ProductInfo|ValidatedKeyword" | head
```

Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/store/useProductDiscoveryStore.ts
git commit -m "feat(store): useProductDiscoveryStore — 3단계 상태"
```

---

## Task 9: Step 1 컴포넌트 (`StepProductInput`)

**Files:**
- Create: `src/components/sourcing/steps/StepProductInput.tsx`

UI: 텍스트 입력 / URL 입력 토글 → AI 키워드 칩 표시 → 검증 시작 버튼.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/sourcing/steps/StepProductInput.tsx`:

```typescript
'use client';

import React, { useState } from 'react';
import { useProductDiscoveryStore } from '@/store/useProductDiscoveryStore';
import { C as BASE_C } from '@/lib/design-tokens';

const C = { ...BASE_C, accent: '#7c3aed' };

export default function StepProductInput() {
  const {
    productInfo, aiSuggestedKeywords, selectedKeywords,
    isExtractingAI, isValidating, isParsingUrl, error,
    setProductInfo, parseUrl, extractAIKeywords,
    toggleKeyword, addKeyword, removeKeyword,
    startValidation,
  } = useProductDiscoveryStore();

  const [mode, setMode] = useState<'text' | 'url'>('text');
  const [titleDraft, setTitleDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');

  const handleTextSubmit = () => {
    const t = titleDraft.trim();
    if (!t) return;
    setProductInfo({ source: 'manual', title: t });
  };

  const handleUrlSubmit = async () => {
    const u = urlDraft.trim();
    if (!u) return;
    await parseUrl(u);
  };

  const canExtract = productInfo !== null && !isExtractingAI;
  const canStart = selectedKeywords.length > 0 && !isValidating;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>
        Step 1 — 상품 입력 + AI 키워드 후보 추출
      </div>

      {/* 모드 토글 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['text', 'url'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: '6px 14px', borderRadius: 5,
              border: `1px solid ${mode === m ? C.accent : '#e5e7eb'}`,
              background: mode === m ? '#f5f0ff' : '#fff',
              color: mode === m ? C.accent : '#374151',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {m === 'text' ? '✏️ 상품명 직접 입력' : '🔗 도매꾹 URL 붙여넣기'}
          </button>
        ))}
      </div>

      {mode === 'text' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text" value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="예: 16cm 펜트리수납함 슬라이드형"
            style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, outline: 'none' }}
          />
          <button
            onClick={handleTextSubmit}
            disabled={!titleDraft.trim()}
            style={{
              padding: '7px 14px', borderRadius: 5, border: 'none',
              background: titleDraft.trim() ? '#1d4ed8' : '#e5e7eb',
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: titleDraft.trim() ? 'pointer' : 'not-allowed',
            }}
          >확정</button>
        </div>
      )}

      {mode === 'url' && (
        <div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text" value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://domeggook.com/main/item.php?id=..."
              style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, outline: 'none' }}
            />
            <button
              onClick={handleUrlSubmit}
              disabled={!urlDraft.trim() || isParsingUrl}
              style={{
                padding: '7px 14px', borderRadius: 5, border: 'none',
                background: urlDraft.trim() && !isParsingUrl ? '#1d4ed8' : '#e5e7eb',
                color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: urlDraft.trim() && !isParsingUrl ? 'pointer' : 'not-allowed',
              }}
            >{isParsingUrl ? '파싱 중...' : '파싱'}</button>
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
            현재 도매꾹 URL만 자동 파싱. 다른 사이트는 상품명을 텍스트로 입력하세요.
          </div>
        </div>
      )}

      {/* 상품 정보 표시 */}
      {productInfo && (
        <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb', display: 'flex', gap: 10, alignItems: 'center' }}>
          {productInfo.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={productInfo.image} alt="" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4 }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{productInfo.title}</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>
              {productInfo.source === 'domeggook' ? '도매꾹' : '직접 입력'}
              {productInfo.price ? ` · ${productInfo.price.toLocaleString()}원` : ''}
            </div>
          </div>
          <button
            onClick={extractAIKeywords}
            disabled={!canExtract}
            style={{
              padding: '6px 12px', borderRadius: 5, border: 'none',
              background: canExtract ? C.accent : '#e5e7eb',
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: canExtract ? 'pointer' : 'not-allowed',
            }}
          >{isExtractingAI ? '추출 중...' : '🤖 AI 키워드 추출'}</button>
        </div>
      )}

      {/* AI 추천 + 사용자 편집 */}
      {(aiSuggestedKeywords.length > 0 || selectedKeywords.length > 0) && (
        <div style={{ padding: 12, background: '#fdfcff', borderRadius: 6, border: '1px solid #e0d4ff' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>
            키워드 후보 — 채택할 것을 선택 + 직접 추가
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {Array.from(new Set([...aiSuggestedKeywords, ...selectedKeywords])).map((kw) => {
              const isSel = selectedKeywords.includes(kw);
              const isAi = aiSuggestedKeywords.includes(kw);
              return (
                <button
                  key={kw}
                  onClick={() => toggleKeyword(kw)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 100, fontSize: 11,
                    border: `1px solid ${isSel ? C.accent : '#e5e7eb'}`,
                    background: isSel ? '#f5f0ff' : '#fff',
                    color: isSel ? C.accent : '#9ca3af',
                    fontWeight: isSel ? 700 : 400, cursor: 'pointer',
                  }}
                >
                  {isAi && <span>🤖</span>}{kw}
                  {!isAi && (
                    <span
                      onClick={(e) => { e.stopPropagation(); removeKeyword(kw); }}
                      style={{ marginLeft: 2, opacity: 0.6 }}
                    >×</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 직접 추가 */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text" value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && keywordDraft.trim()) {
                  e.preventDefault();
                  addKeyword(keywordDraft.trim());
                  setKeywordDraft('');
                }
              }}
              placeholder="키워드 직접 추가 (Enter)"
              style={{ flex: 1, padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 11, outline: 'none' }}
            />
            <button
              onClick={() => { addKeyword(keywordDraft.trim()); setKeywordDraft(''); }}
              disabled={!keywordDraft.trim()}
              style={{
                padding: '5px 12px', borderRadius: 5, border: 'none',
                background: keywordDraft.trim() ? '#7c3aed' : '#e5e7eb',
                color: '#fff', fontSize: 10, fontWeight: 700,
                cursor: keywordDraft.trim() ? 'pointer' : 'not-allowed',
              }}
            >+ 추가</button>
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>
            🤖 = AI 추천. 채택할 것 클릭. {selectedKeywords.length}개 선택됨.
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: 8, background: '#fee2e2', color: '#dc2626', fontSize: 11, borderRadius: 5 }}>
          ⚠️ {error}
        </div>
      )}

      <button
        onClick={() => startValidation()}
        disabled={!canStart}
        style={{
          padding: '8px 18px', borderRadius: 6, border: 'none',
          background: canStart ? C.accent : '#e5e7eb',
          color: '#fff', fontSize: 12, fontWeight: 700,
          cursor: canStart ? 'pointer' : 'not-allowed',
          alignSelf: 'flex-start',
        }}
      >
        {isValidating ? '검증 중...' : `▶ ${selectedKeywords.length}개 키워드 검증 시작`}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "StepProductInput" | head
```

Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/sourcing/steps/StepProductInput.tsx
git commit -m "feat(ui): Step 1 — 상품 입력 + AI 키워드 후보"
```

---

## Task 10: Step 2 컴포넌트 (`StepValidation`)

**Files:**
- Create: `src/components/sourcing/steps/StepValidation.tsx`

기존 `SeedDiscoveryTab.tsx`의 `StepReviewInput`을 참고하되 새 store 기준으로 작성.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/sourcing/steps/StepValidation.tsx`:

```typescript
'use client';

import React from 'react';
import { useProductDiscoveryStore } from '@/store/useProductDiscoveryStore';

export default function StepValidation() {
  const { validated, setReviewCount, goToResult, isValidating } = useProductDiscoveryStore();

  const pendingCount = validated.filter((v) => !v.isBlocked && v.topReviewCount === null).length;

  if (isValidating) {
    return (
      <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 20, height: 20,
          border: '2px solid #7c3aed',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: 12, color: '#6b7280' }}>검색량 + 경쟁상품수 분석 중...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ padding: '8px 14px', background: '#fffbeb', borderBottom: '2px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>
          ✏️ Step 2 — 쿠팡에서 상위 3개 리뷰수 직접 확인 후 입력 (50개 이상 자동 탈락)
        </span>
        {pendingCount > 0 && (
          <span style={{ background: '#fde68a', color: '#92400e', borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
            {pendingCount}개 미입력
          </span>
        )}
        <button
          onClick={() => {
            validated.filter((v) => v.topReviewCount === null && !v.isBlocked)
              .forEach((v) => window.open(`https://www.coupang.com/np/search?q=${encodeURIComponent(v.keyword)}`, '_blank'));
          }}
          style={{ marginLeft: 'auto', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 5, padding: '3px 8px', fontSize: 10, color: '#92400e', cursor: 'pointer' }}
        >
          미입력 {pendingCount}개 쿠팡 일괄 열기↗
        </button>
      </div>

      <div style={{ overflowX: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b', fontSize: 10 }}>키워드</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', color: '#1d4ed8', fontSize: 10 }}>월검색량</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', color: '#1d4ed8', fontSize: 10 }}>경쟁상품</th>
              <th style={{ padding: '6px 6px', textAlign: 'center', color: '#1d4ed8', fontSize: 10 }}>compIdx</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', color: '#1d4ed8', fontSize: 10 }}>CTR</th>
              <th style={{ padding: '6px 6px', textAlign: 'center', color: '#92400e', fontSize: 10, background: '#fffbeb', borderLeft: '2px solid #f59e0b' }}>
                쿠팡 상위리뷰<br /><span style={{ fontWeight: 400, fontSize: 9 }}>✏️ 직접 입력</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {validated.map((v) => (
              <tr key={v.keyword} style={{ borderBottom: '1px solid #f1f5f9', background: v.isBlocked ? '#fef2f2' : '#fff', opacity: v.isBlocked ? 0.6 : 1 }}>
                <td style={{ padding: '5px 8px', fontWeight: 600 }}>
                  {v.keyword}
                  {v.isBlocked && <div style={{ fontSize: 9, color: '#dc2626' }}>{v.blockedReason}</div>}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                  {v.searchVolume?.toLocaleString() ?? '—'}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: '#9ca3af' }}>
                  {v.competitorCount?.toLocaleString() ?? '—'}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                  {v.compIdx && (
                    <span style={{
                      padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                      background: v.compIdx === '낮음' ? '#dcfce7' : v.compIdx === '높음' ? '#fee2e2' : '#fef3c7',
                      color: v.compIdx === '낮음' ? '#15803d' : v.compIdx === '높음' ? '#b91c1c' : '#92400e',
                    }}>{v.compIdx}</span>
                  )}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: v.avgCtr !== null && v.avgCtr < 1 ? '#dc2626' : '#059669' }}>
                  {v.avgCtr !== null ? `${v.avgCtr.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'center', background: v.isBlocked ? '#fee2e2' : '#fffdf0', borderLeft: '2px solid #f59e0b' }}>
                  {v.isBlocked ? (
                    <span style={{ color: '#dc2626', fontWeight: 700 }}>{v.topReviewCount} ❌</span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                      <input
                        type="number" min={0}
                        value={v.topReviewCount ?? ''}
                        onChange={(e) => setReviewCount(v.keyword, Number(e.target.value))}
                        placeholder="—"
                        style={{
                          width: 50, padding: '2px 4px', textAlign: 'center',
                          border: `1px solid ${v.topReviewCount === null ? '#f59e0b' : '#d1d5db'}`,
                          borderRadius: 4, fontSize: 11,
                          background: v.topReviewCount === null ? '#fffbeb' : '#fff',
                        }}
                      />
                      <a
                        href={`https://www.coupang.com/np/search?q=${encodeURIComponent(v.keyword)}`}
                        target="_blank" rel="noreferrer"
                        style={{ color: '#1d4ed8', fontSize: 10 }}
                      >쿠팡↗</a>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '10px 14px', background: '#f9fafb', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => goToResult()}
          disabled={pendingCount > 0 || !validated.some((v) => !v.isBlocked)}
          style={{
            padding: '7px 16px', borderRadius: 6, border: 'none',
            background: pendingCount === 0 && validated.some((v) => !v.isBlocked) ? '#7c3aed' : '#e5e7eb',
            color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: pendingCount === 0 ? 'pointer' : 'not-allowed',
          }}
        >
          {pendingCount === 0 ? '🎯 결과 확인 →' : `🔒 ${pendingCount}개 미입력`}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep "StepValidation" | head
git add src/components/sourcing/steps/StepValidation.tsx
git commit -m "feat(ui): Step 2 — 검증 (검색량 표시 + 쿠팡 리뷰 입력)"
```

Expected: 타입 에러 없음

---

## Task 11: Step 3 컴포넌트 (`StepResult`)

**Files:**
- Create: `src/components/sourcing/steps/StepResult.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/sourcing/steps/StepResult.tsx`:

```typescript
'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useProductDiscoveryStore } from '@/store/useProductDiscoveryStore';

const GRADE_COLOR: Record<string, string> = {
  S: '#7c3aed', A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626',
};

export default function StepResult() {
  const router = useRouter();
  const { validated, toggleResultSelect, confirmAndGetDraftId, isConfirming, error, productInfo } =
    useProductDiscoveryStore();

  // 통과(미차단)만 점수순 정렬
  const passed = [...validated]
    .filter((v) => !v.isBlocked && v.seedScore !== null)
    .sort((a, b) => (b.seedScore ?? 0) - (a.seedScore ?? 0));
  const selectedCount = passed.filter((v) => v.isSelected).length;

  const onSendToListing = async () => {
    const draftId = await confirmAndGetDraftId();
    if (draftId) router.push(`/listing?draftId=${draftId}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ padding: '8px 14px', background: '#faf5ff', borderBottom: '1px solid #e9d5ff', fontSize: 11, fontWeight: 700, color: '#7c3aed' }}>
        🎯 Step 3 — 통과 키워드 {passed.length}개 / 선택 {selectedCount}개 → 상품등록 보내기
      </div>

      <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
        {passed.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
            통과한 키워드가 없습니다. Step 2로 돌아가 다시 검토하세요.
          </div>
        ) : passed.map((v, i) => {
          const ratio = v.competitorCount && v.competitorCount > 0
            ? ((v.searchVolume ?? 0) / v.competitorCount) * 1000
            : 0;
          return (
            <div
              key={v.keyword}
              onClick={() => toggleResultSelect(v.keyword)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                background: v.isSelected ? '#f5f0ff' : '#f9fafb',
                border: `1px solid ${v.isSelected ? '#a78bfa' : '#e2e8f0'}`,
              }}
            >
              <input type="checkbox" checked={v.isSelected} onChange={() => {}} style={{ accentColor: '#7c3aed' }} />
              <span style={{ fontSize: 10, color: '#94a3b8', width: 18 }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 11 }}>{v.keyword}</span>
              <span style={{ fontSize: 10, color: '#6b7280', width: 70, textAlign: 'right' }}>
                {v.searchVolume?.toLocaleString() ?? '—'}
              </span>
              <span style={{ fontSize: 10, color: '#9ca3af', width: 90, textAlign: 'right' }}>
                경쟁 {v.competitorCount?.toLocaleString() ?? '—'}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#0891b2', width: 60, textAlign: 'right' }}>
                노출 {ratio.toFixed(1)}
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: GRADE_COLOR[v.seedGrade ?? 'D'], width: 32, textAlign: 'right' }}>
                {v.seedScore}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 5px',
                background: `${GRADE_COLOR[v.seedGrade ?? 'D']}18`,
                color: GRADE_COLOR[v.seedGrade ?? 'D'],
              }}>{v.seedGrade}</span>
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: 8, margin: '0 12px 8px', background: '#fee2e2', color: '#dc2626', fontSize: 11, borderRadius: 5 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ padding: '10px 14px', background: '#f9fafb', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#64748b' }}>
          상품: {productInfo?.title ?? '—'} · 통과 {passed.length}개 · 선택 {selectedCount}개
        </span>
        <button
          onClick={onSendToListing}
          disabled={selectedCount === 0 || isConfirming}
          style={{
            padding: '7px 16px', borderRadius: 6, border: 'none',
            background: selectedCount > 0 && !isConfirming ? '#be0014' : '#e5e7eb',
            color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: selectedCount > 0 && !isConfirming ? 'pointer' : 'not-allowed',
          }}
        >
          {isConfirming ? '저장 중...' : `📦 ${selectedCount}개 키워드로 상품등록 →`}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep "StepResult" | head
git add src/components/sourcing/steps/StepResult.tsx
git commit -m "feat(ui): Step 3 — 결과 + 상품등록 보내기"
```

Expected: 타입 에러 없음

---

## Task 12: 통합 — `ProductDiscoveryTab.tsx`

**Files:**
- Create: `src/components/sourcing/ProductDiscoveryTab.tsx`

3개 Step 컴포넌트 + 헤더 + 진행 상태 패널을 조립.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/sourcing/ProductDiscoveryTab.tsx`:

```typescript
'use client';

import React from 'react';
import { useProductDiscoveryStore } from '@/store/useProductDiscoveryStore';
import { C as BASE_C } from '@/lib/design-tokens';
import StepProductInput from './steps/StepProductInput';
import StepValidation from './steps/StepValidation';
import StepResult from './steps/StepResult';

const C = {
  ...BASE_C,
  seedAccent: '#7c3aed',
  seedLight: '#ede9fe',
  seedBorder: '#a78bfa',
} as const;

const STEPS = [
  { num: 1, label: '상품 입력 + AI 키워드' },
  { num: 2, label: '검증 (검색량 + 쿠팡 리뷰)' },
  { num: 3, label: '결과 + 상품등록 연결' },
] as const;

export default function ProductDiscoveryTab() {
  const { currentStep, error, reset } = useProductDiscoveryStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg }}>
      {/* 헤더 */}
      <div style={{ padding: '12px 20px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>🌱 상품 발굴</div>
          <div style={{ fontSize: 11, color: C.textSub }}>
            상품 입력 → AI 키워드 추출 → 검증 → 상품등록 보내기
          </div>
        </div>
        <button
          onClick={reset}
          style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: 'none', background: C.seedAccent, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >+ 새 발굴 시작</button>
      </div>

      {error && (
        <div style={{ padding: '8px 20px', background: '#fee2e2', color: '#dc2626', fontSize: 11, borderBottom: '1px solid #fca5a5' }}>
          ⚠️ {error}
        </div>
      )}

      {/* 메인 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* 좌측: 진행 상태 */}
        <div style={{ padding: 14, borderRight: `1px solid ${C.border}`, background: C.card, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, marginBottom: 4 }}>진행 상태</div>
          {STEPS.map((s) => {
            const isDone = currentStep > s.num;
            const isActive = currentStep === s.num;
            const isLocked = currentStep < s.num;
            return (
              <div key={s.num} style={{
                borderRadius: 6, padding: '8px 10px',
                background: isDone ? '#f0fdf4' : isActive ? '#fffbeb' : '#f8fafc',
                border: `${isActive ? 2 : 1}px solid ${isDone ? '#bbf7d0' : isActive ? '#f59e0b' : C.border}`,
                opacity: isLocked ? 0.45 : 1,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{isDone ? '✅' : isActive ? '▶' : '🔒'}</span>
                  <span style={{ color: isDone ? '#16a34a' : isActive ? '#92400e' : C.textSub }}>
                    Step {s.num} — {s.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 우측: 현재 Step */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {currentStep === 1 && <StepProductInput />}
          {currentStep === 2 && <StepValidation />}
          {currentStep === 3 && <StepResult />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep "ProductDiscoveryTab" | head
git add src/components/sourcing/ProductDiscoveryTab.tsx
git commit -m "feat(ui): ProductDiscoveryTab — 3단계 통합 + 진행 상태"
```

Expected: 타입 에러 없음

---

## Task 13: SourcingDashboard 적용 (시드 발굴 → 상품 발굴 교체)

**Files:**
- Modify: `src/components/sourcing/SourcingDashboard.tsx`

- [ ] **Step 1: import 변경**

`src/components/sourcing/SourcingDashboard.tsx` line 28~29 부근 찾아 변경:

```typescript
// 시드 발굴 탭
import SeedDiscoveryTab from '@/components/sourcing/SeedDiscoveryTab';
```

→

```typescript
// 상품 발굴 탭
import ProductDiscoveryTab from '@/components/sourcing/ProductDiscoveryTab';
```

- [ ] **Step 2: 탭 정의 변경**

같은 파일에서 탭 배열 찾아:

```typescript
{ id: 'seed' as const, label: '🌱 시드 발굴', icon: null },
```

→

```typescript
{ id: 'seed' as const, label: '🌱 상품 발굴', icon: null },
```

- [ ] **Step 3: 사용 컴포넌트 변경**

같은 파일 line ~201 근처:

```typescript
{sourcingSubTab === 'seed' && <SeedDiscoveryTab />}
```

→

```typescript
{sourcingSubTab === 'seed' && <ProductDiscoveryTab />}
```

- [ ] **Step 4: 타입 체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep "SourcingDashboard" | head
git add src/components/sourcing/SourcingDashboard.tsx
git commit -m "feat(ui): 시드 발굴 → 상품 발굴 탭 교체"
```

Expected: 타입 에러 없음

---

## Task 14: 상품등록 탭의 `?draftId=` 핸들러

**Files:**
- Modify: `src/store/useListingStore.ts` (액션 추가)
- Modify: `src/components/listing/ListingDashboard.tsx` (URL 파라미터 처리)

`/listing?draftId=...` 가 들어오면 `seed_sessions`에서 데이터 로드하여 폼에 채움.

- [ ] **Step 1: API 라우트 — 세션 로드 (GET)**

기존 `/api/sourcing/product-discover/confirm/route.ts`와 같은 폴더에 GET 추가하지 말고, **새 파일**로 분리:

`src/app/api/sourcing/product-discover/draft/[id]/route.ts`:

```typescript
/**
 * GET /api/sourcing/product-discover/draft/[id]
 * draftId로 ProductInfo + keywords 로드 (상품등록 탭 자동 채움용)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const idSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: 'invalid id' }, { status: 400 });
  }

  const pool = getSourcingPool();
  const row = await pool.query<{ state_json: unknown; status: string }>(
    `SELECT state_json, status FROM seed_sessions WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (row.rows.length === 0) {
    return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: row.rows[0].state_json });
}
```

- [ ] **Step 2: useListingStore에 액션 추가**

`src/store/useListingStore.ts`의 store interface에 추가:

```typescript
loadFromDiscoveryDraft: (draftId: string) => Promise<void>;
```

같은 파일 store 구현부에 추가 (다른 액션들 사이):

```typescript
loadFromDiscoveryDraft: async (draftId: string) => {
  try {
    const res = await fetch(`/api/sourcing/product-discover/draft/${draftId}`);
    const json = await res.json();
    if (!json.success) {
      console.warn('[loadFromDiscoveryDraft] 실패:', json.error);
      return;
    }
    const { productInfo, keywords } = json.data as {
      productInfo: { title: string; image?: string | null; price?: number | null };
      keywords: Array<{ keyword: string }>;
    };

    set((s) => ({
      sharedDraft: {
        ...s.sharedDraft,
        productName: productInfo.title,
        ...(productInfo.image ? { mainImageUrl: productInfo.image } : {}),
        ...(productInfo.price ? { salePrice: productInfo.price } : {}),
        searchTags: keywords.map((k) => k.keyword).slice(0, 10).join(','),
      },
    }));
  } catch (e) {
    console.warn('[loadFromDiscoveryDraft] 에러:', e);
  }
},
```

(사용하는 `sharedDraft` 필드 이름은 기존 store 구조에 맞춰서. 실제 필드명은 `useListingStore.ts`를 보고 매핑)

- [ ] **Step 3: ListingDashboard에서 URL 파라미터 처리**

`src/components/listing/ListingDashboard.tsx` 적당한 위치(useSearchParams 사용하는 다른 useEffect 근처)에 추가:

```typescript
const draftId = searchParams.get('draftId');
const loadFromDiscoveryDraft = useListingStore((s) => s.loadFromDiscoveryDraft);

useEffect(() => {
  if (draftId) {
    loadFromDiscoveryDraft(draftId);
  }
}, [draftId, loadFromDiscoveryDraft]);
```

- [ ] **Step 4: 타입 체크 + 커밋**

```bash
npx tsc --noEmit 2>&1 | grep -E "useListingStore|ListingDashboard|draft" | head
git add src/app/api/sourcing/product-discover/draft src/store/useListingStore.ts src/components/listing/ListingDashboard.tsx
git commit -m "feat(listing): /listing?draftId= 핸들러 — 상품 발굴 데이터 자동 채움"
```

Expected: 타입 에러 없음

---

## Task 15: 기존 시드 발굴 자산 폐기

**Files:**
- Delete: `src/components/sourcing/SeedDiscoveryTab.tsx`
- Delete: `src/store/useSeedDiscoveryStore.ts`
- Delete: `src/app/api/sourcing/seed-discover/route.ts`
- Delete: `src/app/api/sourcing/seed-discover/confirm/route.ts`
- Delete: `src/app/api/sourcing/seed-discover/sessions/route.ts`

- [ ] **Step 1: 잔여 import 확인**

```bash
grep -rn "SeedDiscoveryTab\|useSeedDiscoveryStore\|seed-discover" src/ 2>&1 | grep -v "src/types\|seed_keyword\|seed_score\|seed_session" | head
```

Expected: 출력 없음 (or 코멘트/spec 참조만 — 그것도 그대로 둠)

- [ ] **Step 2: 파일 삭제**

```bash
rm src/components/sourcing/SeedDiscoveryTab.tsx
rm src/store/useSeedDiscoveryStore.ts
rm -rf src/app/api/sourcing/seed-discover
```

- [ ] **Step 3: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "SeedDiscovery" | head
```

Expected: 출력 없음 (잔여 import 없음)

- [ ] **Step 4: 전체 테스트 실행 확인 (회귀 점검)**

```bash
npx vitest run src/__tests__/lib/seed-scoring.test.ts 2>&1 | tail -5
npx vitest run src/__tests__/lib/ai-keyword-extract.test.ts 2>&1 | tail -5
npx vitest run src/__tests__/lib/domeggook-url-parser.test.ts 2>&1 | tail -5
npx vitest run src/__tests__/api/product-discover-extract.test.ts 2>&1 | tail -5
npx vitest run src/__tests__/api/product-discover-validate.test.ts 2>&1 | tail -5
npx vitest run src/__tests__/api/product-discover-confirm.test.ts 2>&1 | tail -5
```

Expected: 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "chore(sourcing): 시드 발굴 탭 폐기 — 상품 발굴로 대체

- SeedDiscoveryTab.tsx · useSeedDiscoveryStore.ts 삭제
- /api/sourcing/seed-discover/* 라우트 폐기
- 데이터 자산(seed_sessions DB, seed-scoring.ts)은 그대로 유지"
```

---

## Task 16: 골든 패스 수동 스모크 테스트

**Files:** (테스트 코드 없음 — 사용자가 직접 브라우저에서 실행)

- [ ] **Step 1: 개발 서버 실행**

```bash
npm run dev
```

브라우저에서 `http://localhost:3000/sourcing` 열기

- [ ] **Step 2: 텍스트 모드 골든 패스**

1. 🌱 상품 발굴 탭 클릭
2. "✏️ 상품명 직접 입력" 모드 (기본)에 `16cm 펜트리수납함 슬라이드형` 입력 → 확정
3. 상품 정보 카드 확인 → "🤖 AI 키워드 추출" 클릭
4. 5~10개 키워드 칩 확인 → 일부 선택 해제 + 직접 추가 1개 (`수납함정리` 등)
5. "▶ N개 키워드 검증 시작" 클릭
6. Step 2: 검증 결과 확인 → 키워드 1~2개 쿠팡 새 탭 열기 → 임의 리뷰수 입력 (5, 100, 30 등)
7. 50 이상 입력한 키워드는 자동 X 표시 확인
8. "🎯 결과 확인 →" 클릭
9. Step 3: 통과 키워드 점수순 정렬 확인 → 일부 체크 → "📦 N개 키워드로 상품등록 →" 클릭
10. `/listing?draftId=...` 페이지 이동 확인 → 폼에 상품명/태그 자동 채움 확인

- [ ] **Step 3: URL 모드 (도매꾹)**

1. + 새 발굴 시작 → "🔗 도매꾹 URL 붙여넣기" 모드
2. 실제 도매꾹 상품 URL 붙여넣기 → 파싱
3. 상품 정보(이미지 + 가격) 채워지는지 확인
4. 이후 동일하게 AI 추출 → 검증 → 등록까지 진행

- [ ] **Step 4: 에러 케이스 (의도적)**

1. 빈 상품명 → "확정" 버튼 비활성 확인
2. 비-도매꾹 URL (`https://example.com`) 붙여넣기 → 422 에러 메시지 확인
3. AI 추출 실패 시뮬레이션 (Gemini API 키 임시 변경) → 빈 추천 + 사용자 직접 입력 가능 확인

- [ ] **Step 5: 결과 보고**

스모크 테스트 통과 시 — 다음 단계 (배포, ultrareview, etc.) 진행.
실패한 케이스가 있으면 → 그 task로 돌아가 수정.

---

## 완료 체크리스트

- [ ] Task 1: 타입 정의 (ProductInfo, ValidatedKeyword)
- [ ] Task 2: ai-keyword-extract.ts + 6 테스트
- [ ] Task 3: domeggook-url-parser.ts + 5 테스트
- [ ] Task 4: /parse-url 라우트
- [ ] Task 5: /extract-keywords 라우트 + 4 테스트
- [ ] Task 6: /validate 라우트 + product-discovery-pipeline.ts + 3 테스트
- [ ] Task 7: /confirm 라우트 + 4 테스트
- [ ] Task 8: useProductDiscoveryStore (3단계 상태 + 액션)
- [ ] Task 9: StepProductInput 컴포넌트
- [ ] Task 10: StepValidation 컴포넌트
- [ ] Task 11: StepResult 컴포넌트
- [ ] Task 12: ProductDiscoveryTab 통합
- [ ] Task 13: SourcingDashboard 교체
- [ ] Task 14: /listing?draftId= 핸들러
- [ ] Task 15: 기존 시드 발굴 자산 폐기
- [ ] Task 16: 수동 스모크 테스트
