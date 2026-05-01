# 네이버 스마트스토어 등록 패널 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠팡 등록 패널(`CoupangAutoRegisterPanel`)과 동일한 방식으로, 네이버 스마트스토어 전용 임시저장+제출 패널(`NaverAutoRegisterPanel`)을 추가한다.

**Architecture:** 쿠팡 Draft 시스템(Supabase `coupang_drafts` 테이블 + `/api/listing/coupang/drafts/*` 라우트 + `CoupangAutoRegisterPanel`)을 정확히 미러링한다. `naver_drafts` 테이블, `/api/listing/naver/drafts/*` 라우트, `NaverAutoRegisterPanel` 컴포넌트를 추가한다. 이미지는 임시저장 시 Supabase URL로 저장하고, 제출 시점에 네이버 CDN에 업로드한다. `Step3ReviewRegister.tsx`를 수정해 `selectedPlatform`에 따라 올바른 패널을 렌더링한다.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL + RLS), `NaverCommerceClient` (기존), `buildNaverPayload` (기존), Vitest

---

## 파일 구조

**새로 생성:**
- `supabase/migrations/040_naver_drafts.sql` — naver_drafts 테이블
- `src/app/api/listing/naver/drafts/route.ts` — GET(목록), POST(생성)
- `src/app/api/listing/naver/drafts/[id]/route.ts` — PUT(수정), DELETE(삭제)
- `src/app/api/listing/naver/drafts/[id]/submit/route.ts` — POST(제출)
- `src/components/listing/workflow/NaverAutoRegisterPanel.tsx` — 네이버 등록 패널 UI
- `src/__tests__/api/naver-drafts.test.ts` — 드래프트 API 테스트
- `src/__tests__/api/naver-drafts-submit.test.ts` — 제출 API 테스트

**수정:**
- `src/store/useListingStore.ts` — `SharedDraft`에 `naverDraftId` 추가
- `src/components/listing/workflow/Step3ReviewRegister.tsx` — 플랫폼별 패널 조건부 렌더링

---

## Task 1: Supabase 마이그레이션 — naver_drafts 테이블

**Files:**
- Create: `supabase/migrations/040_naver_drafts.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 040_naver_drafts.sql
-- 네이버 스마트스토어 임시저장 테이블
-- coupang_drafts(037)와 동일한 구조

CREATE TABLE naver_drafts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name            text NOT NULL DEFAULT '',
  source_url              text,
  source_type             text DEFAULT 'manual',
  draft_data              jsonb NOT NULL DEFAULT '{}',
  status                  text DEFAULT 'draft',          -- 'draft' | 'submitted'
  naver_origin_product_no bigint,
  naver_channel_product_no bigint,
  smartstore_url          text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

CREATE INDEX ON naver_drafts(user_id, created_at DESC);
ALTER TABLE naver_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "본인 데이터만" ON naver_drafts FOR ALL USING (auth.uid() = user_id);
```

- [ ] **Step 2: Supabase에 마이그레이션 적용**

```bash
# 로컬 Supabase가 실행 중이면:
npx supabase db push
# 또는 Supabase 대시보드 SQL 에디터에 직접 실행
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/040_naver_drafts.sql
git commit -m "feat(db): add naver_drafts table"
```

---

## Task 2: Store 업데이트 — naverDraftId 추가

**Files:**
- Modify: `src/store/useListingStore.ts`

현재 `SharedDraft` 인터페이스(약 line 1~70)와 초기값(약 line 60~120)에 `naverDraftId` 필드가 없다.
`coupangDraftId?: string` 패턴을 그대로 따른다.

- [ ] **Step 1: 인터페이스에 필드 추가**

`coupangDraftId?: string;` 라인 바로 아래에 추가한다 (약 line 68):

```typescript
  coupangDraftId?: string;
  naverDraftId?: string;     // ← 추가
```

- [ ] **Step 2: 초기값에 추가**

초기 상태 객체에서 `coupangDraftId` 바로 아래에 추가:

```typescript
  coupangDraftId: undefined,
  naverDraftId: undefined,   // ← 추가
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep -i naver
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/store/useListingStore.ts
git commit -m "feat(store): add naverDraftId to SharedDraft"
```

---

## Task 3: Naver Draft API — GET/POST

**Files:**
- Create: `src/app/api/listing/naver/drafts/route.ts`

쿠팡 버전인 `src/app/api/listing/coupang/drafts/route.ts`와 동일한 구조.
테이블명만 `coupang_drafts` → `naver_drafts`로 바꾼다.

- [ ] **Step 1: 테스트 파일 작성 (실패 확인용)**

`src/__tests__/api/naver-drafts.test.ts` 생성:

```typescript
/**
 * naver-drafts.test.ts
 * GET /api/listing/naver/drafts  — 목록 조회
 * POST /api/listing/naver/drafts — 새 draft 저장
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Supabase mock
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
    })),
  })),
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-123' }),
}));

describe('GET /api/listing/naver/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        eq: mockEq.mockReturnValue({
          order: mockOrder.mockReturnValue({
            limit: mockLimit.mockResolvedValue({
              data: [
                {
                  id: 'draft-1',
                  product_name: '테스트 상품',
                  source_url: null,
                  source_type: 'costco',
                  status: 'draft',
                  draft_data: { name: '테스트 상품', salePrice: 15000 },
                  created_at: '2026-04-26T00:00:00Z',
                  updated_at: '2026-04-26T00:00:00Z',
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
  });

  it('인증된 사용자의 draft 목록을 반환한다', async () => {
    const { GET } = await import('@/app/api/listing/naver/drafts/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.drafts).toHaveLength(1);
    expect(json.drafts[0].id).toBe('draft-1');
    expect(json.drafts[0].productName).toBe('테스트 상품');
  });
});

describe('POST /api/listing/naver/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      select: mockSelect.mockReturnValue({
        single: mockSingle.mockResolvedValue({
          data: { id: 'new-draft-id' },
          error: null,
        }),
      }),
    });
  });

  it('새 draft를 생성하고 id를 반환한다', async () => {
    const { POST } = await import('@/app/api/listing/naver/drafts/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts', {
      method: 'POST',
      body: JSON.stringify({
        productName: '테스트 상품',
        sourceType: 'costco',
        draftData: { name: '테스트 상품', leafCategoryId: '50000795', salePrice: 15000 },
      }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.id).toBe('new-draft-id');
  });

  it('draftData 없으면 400을 반환한다', async () => {
    const { POST } = await import('@/app/api/listing/naver/drafts/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts', {
      method: 'POST',
      body: JSON.stringify({ productName: '이름만' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/naver-drafts.test.ts 2>&1 | tail -10
```

Expected: `FAIL` (파일 없음 에러)

- [ ] **Step 3: 라우트 구현**

`src/app/api/listing/naver/drafts/route.ts` 생성:

```typescript
/**
 * /api/listing/naver/drafts
 * GET  — 내 임시저장 목록 (status='draft', 최신 30개)
 * POST — 새 draft 저장
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('naver_drafts')
      .select('id, product_name, source_url, source_type, status, draft_data, created_at, updated_at')
      .eq('user_id', userId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    const drafts = (data ?? []).map((row) => ({
      id: row.id as string,
      productName: row.product_name as string,
      sourceUrl: row.source_url as string | null,
      sourceType: row.source_type as string,
      status: row.status as string,
      draftData: row.draft_data as Record<string, unknown>,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));

    return Response.json({ drafts });
  } catch (err) {
    console.error('[GET /api/listing/naver/drafts]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

const CreateDraftSchema = z.object({
  productName: z.string().default(''),
  sourceUrl: z.string().nullish(),
  sourceType: z.string().default('manual'),
  draftData: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  const parseResult = CreateDraftSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      { success: false, error: '입력값 검증 실패', details: parseResult.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { productName, sourceUrl, sourceType, draftData } = parseResult.data;

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('naver_drafts')
      .insert({
        user_id: userId,
        product_name: productName,
        source_url: sourceUrl ?? null,
        source_type: sourceType,
        draft_data: draftData,
        status: 'draft',
      })
      .select('id')
      .single();

    if (error) throw error;

    return Response.json({ id: (data as { id: string }).id }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/listing/naver/drafts]', err);
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/naver-drafts.test.ts 2>&1 | tail -10
```

Expected: `PASS  src/__tests__/api/naver-drafts.test.ts`

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/listing/naver/drafts/route.ts src/__tests__/api/naver-drafts.test.ts
git commit -m "feat(api): add GET/POST /api/listing/naver/drafts"
```

---

## Task 4: Naver Draft API — PUT/DELETE

**Files:**
- Create: `src/app/api/listing/naver/drafts/[id]/route.ts`

`src/app/api/listing/coupang/drafts/[id]/route.ts`와 동일한 구조.

- [ ] **Step 1: 라우트 구현**

`src/app/api/listing/naver/drafts/[id]/route.ts` 생성:

```typescript
/**
 * /api/listing/naver/drafts/[id]
 * PUT    — draft 내용 업데이트
 * DELETE — draft 삭제
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function verifyOwnership(
  draftId: string,
  userId: string,
): Promise<{ error: Response } | { ok: true }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('naver_drafts')
    .select('id')
    .eq('id', draftId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return {
      error: Response.json(
        { success: false, error: '해당 draft를 찾을 수 없거나 접근 권한이 없습니다.' },
        { status: 404 },
      ),
    };
  }
  return { ok: true };
}

const UpdateDraftSchema = z.object({
  productName: z.string().optional(),
  draftData: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  const ownerCheck = await verifyOwnership(draftId, userId);
  if ('error' in ownerCheck) return ownerCheck.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  const parseResult = UpdateDraftSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      { success: false, error: '입력값 검증 실패', details: parseResult.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { productName, draftData } = parseResult.data;

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (productName !== undefined) updateFields.product_name = productName;
  if (draftData !== undefined) updateFields.draft_data = draftData;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from('naver_drafts')
      .update(updateFields)
      .eq('id', draftId)
      .eq('user_id', userId);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('[PUT /api/listing/naver/drafts/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  const ownerCheck = await verifyOwnership(draftId, userId);
  if ('error' in ownerCheck) return ownerCheck.error;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from('naver_drafts')
      .delete()
      .eq('id', draftId)
      .eq('user_id', userId);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/listing/naver/drafts/[id]]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep -i "naver/drafts"
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/listing/naver/drafts/[id]/route.ts
git commit -m "feat(api): add PUT/DELETE /api/listing/naver/drafts/[id]"
```

---

## Task 5: Naver Draft Submit API

**Files:**
- Create: `src/app/api/listing/naver/drafts/[id]/submit/route.ts`
- Create: `src/__tests__/api/naver-drafts-submit.test.ts`

제출 순서:
1. 인증 + 소유권 확인
2. naver_drafts에서 draft_data 조회
3. 필수 필드(name, leafCategoryId, salePrice) 검증
4. thumbnailImages → 네이버 CDN 업로드 (`uploadImagesFromUrls`)
5. `buildNaverPayload` 호출
6. `client.registerProduct(payload)` 호출
7. draft 상태 'submitted'로 업데이트

- [ ] **Step 1: 테스트 작성**

`src/__tests__/api/naver-drafts-submit.test.ts` 생성:

```typescript
/**
 * naver-drafts-submit.test.ts
 * POST /api/listing/naver/drafts/[id]/submit
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// 네이버 클라이언트 Mock
const mockRegisterProduct = vi.fn();
const mockUploadImagesFromUrls = vi.fn();

vi.mock('@/lib/listing/naver-commerce-client', () => ({
  getNaverCommerceClient: vi.fn(() => ({
    registerProduct: mockRegisterProduct,
    uploadImagesFromUrls: mockUploadImagesFromUrls,
  })),
}));

// Supabase Mock
const mockSingle = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
    })),
  })),
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-123' }),
}));

const VALID_DRAFT_DATA = {
  name: '테스트 선풍기',
  leafCategoryId: '50000795',
  salePrice: 29900,
  stock: 100,
  thumbnailImages: ['https://supabase.co/storage/v1/img1.jpg'],
  detailHtml: '<div>상세 설명</div>',
  tags: ['선풍기', '여름가전'],
  deliveryCharge: 0,
  returnCharge: 4000,
};

describe('POST /api/listing/naver/drafts/[id]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // draft 조회 성공
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        eq: mockEq.mockReturnValue({
          single: mockSingle.mockResolvedValue({
            data: {
              id: 'draft-1',
              user_id: 'user-123',
              product_name: '테스트 선풍기',
              draft_data: VALID_DRAFT_DATA,
              status: 'draft',
            },
            error: null,
          }),
        }),
      }),
    });

    // 이미지 업로드 성공
    mockUploadImagesFromUrls.mockResolvedValue(['https://shop-phinf.naver.com/img1.jpg']);

    // 상품 등록 성공
    mockRegisterProduct.mockResolvedValue({
      originProductNo: 987654321,
      smartstoreChannelProductNo: 111222333,
    });

    // draft 업데이트 성공
    mockUpdate.mockReturnValue({
      eq: mockEq.mockReturnValue({
        eq: mockEq.mockResolvedValue({ error: null }),
      }),
    });
  });

  it('성공 시 originProductNo를 반환한다', async () => {
    const { POST } = await import('@/app/api/listing/naver/drafts/[id]/submit/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts/draft-1/submit', {
      method: 'POST',
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'draft-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.originProductNo).toBe(987654321);
  });

  it('이미 제출된 draft는 409를 반환한다', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'draft-1', user_id: 'user-123', draft_data: VALID_DRAFT_DATA, status: 'submitted' },
      error: null,
    });

    const { POST } = await import('@/app/api/listing/naver/drafts/[id]/submit/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts/draft-1/submit', {
      method: 'POST',
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'draft-1' }) });

    expect(res.status).toBe(409);
  });

  it('이미지 업로드가 모두 실패하면 422를 반환한다', async () => {
    mockUploadImagesFromUrls.mockResolvedValueOnce([]);

    const { POST } = await import('@/app/api/listing/naver/drafts/[id]/submit/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts/draft-1/submit', {
      method: 'POST',
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'draft-1' }) });

    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/naver-drafts-submit.test.ts 2>&1 | tail -10
```

Expected: `FAIL` (파일 없음 에러)

- [ ] **Step 3: submit 라우트 구현**

`src/app/api/listing/naver/drafts/[id]/submit/route.ts` 생성:

```typescript
/**
 * /api/listing/naver/drafts/[id]/submit
 * POST — 임시저장된 draft를 네이버 스마트스토어 OPEN API에 실제 제출
 *
 * 처리 순서:
 * 1. 인증 + 소유권 확인
 * 2. Supabase에서 draft_data 조회
 * 3. 필수 필드 검증
 * 4. thumbnailImages → 네이버 CDN 업로드
 * 5. buildNaverPayload → registerProduct 호출
 * 6. 성공 시 draft.status='submitted', 등록 번호 저장
 */

import { NextRequest } from 'next/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { buildNaverPayload } from '@/lib/listing/payload-mappers';
import type { CommonProductInput, NaverSpecificInput } from '@/lib/listing/payload-mappers';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface NaverDraftData {
  name?: string;
  leafCategoryId?: string;
  leafCategoryPath?: string;
  salePrice?: number;
  stock?: number;
  thumbnailImages?: string[];
  detailHtml?: string;
  tags?: string[];
  deliveryCharge?: number;
  returnCharge?: number;
  exchangeFee?: number;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  const supabase = getSupabaseServerClient();

  const { data: draft, error: fetchError } = await supabase
    .from('naver_drafts')
    .select('id, user_id, product_name, draft_data, status')
    .eq('id', draftId)
    .eq('user_id', userId)
    .single();

  if (fetchError || !draft) {
    return Response.json(
      { success: false, error: '해당 draft를 찾을 수 없거나 접근 권한이 없습니다.' },
      { status: 404 },
    );
  }

  if ((draft.status as string) === 'submitted') {
    return Response.json(
      { success: false, error: '이미 제출된 draft입니다.' },
      { status: 409 },
    );
  }

  const d = (draft.draft_data ?? {}) as NaverDraftData;

  const name = d.name ?? (draft.product_name as string) ?? '';
  const leafCategoryId = d.leafCategoryId ?? '';
  const salePrice = Number(d.salePrice) || 0;
  const stock = Number(d.stock) || 999;
  const thumbnailImages = Array.isArray(d.thumbnailImages) ? d.thumbnailImages.filter(Boolean) : [];
  const detailHtml = d.detailHtml ?? name;
  const tags = Array.isArray(d.tags) ? d.tags : [];
  const deliveryCharge = Number(d.deliveryCharge) ?? 0;
  const returnCharge = Number(d.returnCharge) || 4000;
  const exchangeFee = Number(d.exchangeFee) || returnCharge * 2;

  if (!name || !leafCategoryId || !salePrice) {
    return Response.json(
      { success: false, error: '필수 필드(상품명, 카테고리, 판매가)가 누락되었습니다.' },
      { status: 400 },
    );
  }

  if (thumbnailImages.length === 0) {
    return Response.json(
      { success: false, error: '대표이미지가 없습니다.' },
      { status: 400 },
    );
  }

  try {
    const client = getNaverCommerceClient();

    // 네이버는 외부 URL 직접 사용 불가 — 네이버 CDN에 업로드 필요
    console.log('[submit] 네이버 이미지 업로드 시작:', thumbnailImages.length, '장');
    const naverThumbnails = await client.uploadImagesFromUrls(thumbnailImages);

    if (naverThumbnails.length === 0) {
      return Response.json(
        { success: false, error: '네이버 이미지 업로드에 모두 실패했습니다.' },
        { status: 422 },
      );
    }

    const common: CommonProductInput = {
      name,
      salePrice,
      stock,
      thumbnailImages: naverThumbnails,
      detailImages: [],
      description: detailHtml,
      deliveryCharge,
      deliveryChargeType: deliveryCharge === 0 ? 'FREE' : 'NOT_FREE',
      returnCharge,
    };

    const specific: NaverSpecificInput = {
      leafCategoryId,
      tags,
      exchangeFee,
      returnFee: returnCharge,
    };

    const payload = buildNaverPayload(common, specific);
    console.log('[submit] 네이버 상품 등록 요청...');
    const result = await client.registerProduct(payload);

    const originProductNo = result.originProductNo;
    const channelProductNo = result.smartstoreChannelProductNo;
    const smartstoreUrl = `https://smartstore.naver.com/home/product/${channelProductNo}`;

    await supabase
      .from('naver_drafts')
      .update({
        status: 'submitted',
        naver_origin_product_no: originProductNo,
        naver_channel_product_no: channelProductNo,
        smartstore_url: smartstoreUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draftId)
      .eq('user_id', userId);

    return Response.json({ success: true, originProductNo, channelProductNo, smartstoreUrl });
  } catch (err) {
    console.error('[POST /api/listing/naver/drafts/[id]/submit]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/naver-drafts-submit.test.ts 2>&1 | tail -15
```

Expected: `PASS  src/__tests__/api/naver-drafts-submit.test.ts` (3 tests passed)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/listing/naver/drafts/[id]/submit/route.ts src/__tests__/api/naver-drafts-submit.test.ts
git commit -m "feat(api): add POST /api/listing/naver/drafts/[id]/submit"
```

---

## Task 6: NaverAutoRegisterPanel 컴포넌트

**Files:**
- Create: `src/components/listing/workflow/NaverAutoRegisterPanel.tsx`

`CoupangAutoRegisterPanel.tsx`의 구조를 따르되 네이버 전용 필드로 구성한다.

**핵심 차이점:**
- 카테고리: `/api/listing/naver/categories?keyword=...` 사용, 응답 형태 `{ id, name, path }`
- 가격: `sharedDraft.naverPrice` 우선, 없으면 `sharedDraft.salePrice`
- 상세설명: `sharedDraft.detailPageSnippetNaver` 우선, 없으면 `detailPageSnippet`
- 고시정보(notices) 섹션 없음 (네이버는 `productInfoProvidedNotice`가 payload에서 자동 처리됨)
- KC 인증: 쿠팡 제출 라우트에서 처리됨, 네이버는 `productCertificationInfos` 오류 시 자동 폴백 처리됨
- 임시저장: `POST /api/listing/naver/drafts`
- 업데이트: `PUT /api/listing/naver/drafts/[id]`
- 제출: `POST /api/listing/naver/drafts/[id]/submit` + `window.confirm()`

- [ ] **Step 1: 컴포넌트 구현**

`src/components/listing/workflow/NaverAutoRegisterPanel.tsx` 생성:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

interface NaverAutoRegisterPanelProps {
  onSuccess?: (originProductNo: number) => void;
}

const section: React.CSSProperties = {
  backgroundColor: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: '12px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: C.text,
  margin: '0 0 4px',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: C.textSub,
  marginBottom: '4px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '13px',
  color: C.text,
  backgroundColor: '#fff',
  border: `1px solid ${C.border}`,
  borderRadius: '8px',
  boxSizing: 'border-box',
};

interface NaverCategoryResult {
  id: string;
  name: string;
  path: string;
}

export default function NaverAutoRegisterPanel({ onSuccess }: NaverAutoRegisterPanelProps) {
  const { sharedDraft, updateSharedDraft } = useListingStore();

  // ── 기본 상태 ─────────────────────────────────────────────
  const [name, setName] = useState(sharedDraft.name ?? '');
  const [leafCategoryId, setLeafCategoryId] = useState(sharedDraft.naverCategoryId ?? '');
  const [leafCategoryPath, setLeafCategoryPath] = useState(sharedDraft.naverCategoryPath ?? '');
  const [salePrice, setSalePrice] = useState(
    Number(sharedDraft.naverPrice || sharedDraft.salePrice) || 0,
  );
  const [stock, setStock] = useState(Number(sharedDraft.stock) || 999);
  const [deliveryCharge, setDeliveryCharge] = useState(Number(sharedDraft.deliveryCharge) || 0);
  const [returnCharge, setReturnCharge] = useState(Number(sharedDraft.returnCharge) || 4000);
  const [tags, setTags] = useState<string[]>(sharedDraft.tags ?? []);
  const [tagInput, setTagInput] = useState('');

  // ── 카테고리 검색 ─────────────────────────────────────────
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryResults, setCategoryResults] = useState<NaverCategoryResult[]>([]);
  const [isCategorySearching, setIsCategorySearching] = useState(false);

  // ── 드래프트 상태 ─────────────────────────────────────────
  const [draftId, setDraftId] = useState<string | null>(sharedDraft.naverDraftId ?? null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftFeedback, setDraftFeedback] = useState<'saved' | 'error' | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);

  // ── 제출 상태 ─────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 상세설명: 네이버 전용 → 공통 순서로 폴백
  const hasDetailHtml = !!(sharedDraft.detailPageSnippetNaver || sharedDraft.detailPageSnippet);

  // sharedDraft 변경 시 동기화
  useEffect(() => {
    if (sharedDraft.name && !name) setName(sharedDraft.name);
  }, [sharedDraft.name]);

  // ── 카테고리 검색 ─────────────────────────────────────────
  async function handleCategorySearch() {
    const kw = categorySearch.trim();
    if (!kw) return;
    setIsCategorySearching(true);
    try {
      const res = await fetch(`/api/listing/naver/categories?keyword=${encodeURIComponent(kw)}`);
      const json = await res.json();
      setCategoryResults(json.data ?? []);
    } catch {
      setCategoryResults([]);
    } finally {
      setIsCategorySearching(false);
    }
  }

  // ── draft_data 조립 ───────────────────────────────────────
  function buildDraftData() {
    return {
      name,
      leafCategoryId,
      leafCategoryPath,
      salePrice,
      stock,
      thumbnailImages: sharedDraft.thumbnailImages ?? [],
      detailHtml: sharedDraft.detailPageSnippetNaver || sharedDraft.detailPageSnippet || '',
      tags,
      deliveryCharge,
      returnCharge,
      exchangeFee: returnCharge * 2,
    };
  }

  // ── 임시저장 ──────────────────────────────────────────────
  async function handleSaveDraft() {
    if (!name) return;
    setIsSavingDraft(true);
    setDraftFeedback(null);
    setDraftSaveError(null);

    const draftData = buildDraftData();

    try {
      if (draftId) {
        // 업데이트
        const res = await fetch(`/api/listing/naver/drafts/${draftId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productName: name, draftData }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? '업데이트 실패');
      } else {
        // 새 draft 생성
        const res = await fetch('/api/listing/naver/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productName: name,
            sourceUrl: sharedDraft.sourceUrl ?? null,
            sourceType: 'costco',
            draftData,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? '저장 실패');
        const json = await res.json();
        setDraftId(json.id);
        updateSharedDraft({ naverDraftId: json.id });
      }
      setDraftFeedback('saved');
      setTimeout(() => setDraftFeedback(null), 3000);
    } catch (err) {
      setDraftSaveError(err instanceof Error ? err.message : '저장 실패');
      setDraftFeedback('error');
    } finally {
      setIsSavingDraft(false);
    }
  }

  // ── 제출 ──────────────────────────────────────────────────
  async function handleSubmit() {
    if (!draftId) return;
    const confirmed = window.confirm(
      `"${name}" 상품을 네이버 스마트스토어에 제출하시겠습니까?\n이미지 업로드 후 실제 등록됩니다.`,
    );
    if (!confirmed) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/listing/naver/drafts/${draftId}/submit`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '제출 실패');
      onSuccess?.(json.originProductNo);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '제출 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px' }}>
        <span style={{ fontSize: '18px' }}>🟢</span>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 700, color: '#166534', margin: 0 }}>네이버 스마트스토어 등록</p>
          <p style={{ fontSize: '11px', color: '#15803d', margin: 0 }}>임시저장 후 네이버에 제출합니다</p>
        </div>
      </div>

      {/* ── 섹션 1: 상품명 + 카테고리 ─────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>상품명 · 카테고리</p>
        <div>
          <label style={label}>상품명</label>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="네이버 스마트스토어 상품명"
          />
        </div>
        <div>
          <label style={label}>카테고리 검색</label>
          {leafCategoryId && (
            <div style={{ marginBottom: '6px', padding: '6px 10px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '11px', color: '#1d4ed8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><strong>{leafCategoryId}</strong> — {leafCategoryPath}</span>
              <button type="button" onClick={() => { setLeafCategoryId(''); setLeafCategoryPath(''); }} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '14px' }}>×</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCategorySearch(); } }}
              placeholder="예: 선풍기, 텀블러, 헤어드라이어"
            />
            <button
              type="button"
              onClick={handleCategorySearch}
              disabled={isCategorySearching}
              style={{ padding: '9px 14px', fontSize: '12px', fontWeight: 600, backgroundColor: '#15803d', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {isCategorySearching ? '검색 중...' : '검색'}
            </button>
          </div>
          {categoryResults.length > 0 && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden', marginTop: '4px' }}>
              {categoryResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setLeafCategoryId(c.id);
                    setLeafCategoryPath(c.path);
                    setCategoryResults([]);
                    setCategorySearch('');
                  }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: '12px', backgroundColor: '#fff', border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', color: C.text }}
                >
                  <strong>{c.id}</strong>
                  <span style={{ marginLeft: '8px', color: C.textSub }}>{c.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 섹션 2: 가격·재고 ────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>가격 · 재고</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div>
            <label style={label}>판매가 (원)</label>
            <input style={inputStyle} type="number" value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value))} min={0} />
          </div>
          <div>
            <label style={label}>재고</label>
            <input style={inputStyle} type="number" value={stock} onChange={(e) => setStock(Number(e.target.value))} min={0} />
          </div>
          <div>
            <label style={label}>배송비 (원)</label>
            <input style={inputStyle} type="number" value={deliveryCharge} onChange={(e) => setDeliveryCharge(Number(e.target.value))} min={0} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={label}>반품 배송비 (원)</label>
            <input style={inputStyle} type="number" value={returnCharge} onChange={(e) => setReturnCharge(Number(e.target.value))} min={0} />
          </div>
          <div>
            <label style={label}>교환 배송비 (원)</label>
            <input style={inputStyle} type="number" value={returnCharge * 2} readOnly style={{ ...inputStyle, backgroundColor: '#f3f4f6', color: C.textSub }} />
          </div>
        </div>
      </div>

      {/* ── 섹션 3: 검색 태그 ────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>검색 태그 (최대 10개)</p>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const t = tagInput.trim();
                if (t && !tags.includes(t) && tags.length < 10) {
                  setTags([...tags, t]);
                  setTagInput('');
                }
              }
            }}
            placeholder="태그 입력 후 Enter"
          />
          <button
            type="button"
            onClick={() => {
              const t = tagInput.trim();
              if (t && !tags.includes(t) && tags.length < 10) {
                setTags([...tags, t]);
                setTagInput('');
              }
            }}
            style={{ padding: '9px 14px', fontSize: '12px', fontWeight: 600, backgroundColor: C.header, color: C.text, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer' }}
          >
            추가
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {tags.map((tag) => (
            <span
              key={tag}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #86efac', borderRadius: '100px', fontSize: '12px' }}
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', padding: 0, fontSize: '14px', lineHeight: 1 }}
              >×</button>
            </span>
          ))}
        </div>
      </div>

      {/* ── 상세설명 없음 경고 ──────────────────────────────── */}
      {!hasDetailHtml && (
        <div style={{ padding: '10px 14px', backgroundColor: '#fef9c3', border: '1px solid #fde047', borderRadius: '8px', fontSize: '12px', color: '#854d0e' }}>
          ⚠ 상세설명이 없습니다. Step 3에서 AI 상세페이지를 먼저 생성해주세요.
        </div>
      )}

      {/* ── 액션 바 ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
        {submitError && (
          <div style={{ padding: '10px 14px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c' }}>
            {submitError}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* 임시저장 */}
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSavingDraft || !name}
            style={{
              width: '100%', padding: '12px', fontSize: '13px', fontWeight: 600,
              backgroundColor: '#fff', color: C.text,
              border: `2px solid ${C.border}`, borderRadius: '10px',
              cursor: isSavingDraft || !name ? 'not-allowed' : 'pointer',
              opacity: !name ? 0.5 : 1,
            }}
          >
            {isSavingDraft ? '저장 중...' : draftId ? '임시저장 업데이트' : '임시저장'}
          </button>
          {/* 구분선 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
            <span style={{ fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap' }}>저장 후 제출</span>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
          </div>
          {/* 제출 */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !name || !draftId || !hasDetailHtml || !leafCategoryId}
            title={!draftId ? '먼저 임시저장하세요' : !leafCategoryId ? '카테고리를 선택하세요' : !hasDetailHtml ? '상세설명을 먼저 생성하세요' : ''}
            style={{
              width: '100%', padding: '12px', fontSize: '13px', fontWeight: 700,
              backgroundColor: isSubmitting || !draftId || !hasDetailHtml || !leafCategoryId
                ? '#e5e7eb'
                : '#15803d',
              color: isSubmitting || !draftId || !hasDetailHtml || !leafCategoryId ? C.textSub : '#fff',
              border: 'none', borderRadius: '10px',
              cursor: isSubmitting || !draftId || !hasDetailHtml || !leafCategoryId ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? '제출 중... (이미지 업로드 포함)' : '네이버에 제출'}
          </button>
        </div>
        {draftFeedback === 'saved' && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: '#15803d', fontWeight: 600 }}>저장됐습니다</p>
        )}
        {draftFeedback === 'error' && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: '#b91c1c' }}>{draftSaveError || '저장에 실패했습니다'}</p>
        )}
        {!draftFeedback && !draftId && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: C.textSub }}>임시저장 후 네이버에 제출할 수 있습니다</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep NaverAutoRegisterPanel
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/workflow/NaverAutoRegisterPanel.tsx
git commit -m "feat(ui): add NaverAutoRegisterPanel component"
```

---

## Task 7: Step3ReviewRegister 업데이트 — 플랫폼별 패널

**Files:**
- Modify: `src/components/listing/workflow/Step3ReviewRegister.tsx`

현재 `Step3ReviewRegister.tsx`는 `selectedPlatform` 관계없이 항상 `CoupangAutoRegisterPanel`만 렌더링한다.
`selectedPlatform`이 `'naver'`이면 `NaverAutoRegisterPanel`, `'both'`이면 둘 다 표시한다.

- [ ] **Step 1: import 추가**

`Step3ReviewRegister.tsx` 상단(line 15 근처)의 import 영역에 추가:

기존:
```typescript
import CoupangAutoRegisterPanel from '@/components/listing/workflow/CoupangAutoRegisterPanel';
```

변경 후:
```typescript
import CoupangAutoRegisterPanel from '@/components/listing/workflow/CoupangAutoRegisterPanel';
import NaverAutoRegisterPanel from '@/components/listing/workflow/NaverAutoRegisterPanel';
```

- [ ] **Step 2: selectedPlatform 구조분해 추가**

`Step3ReviewRegister.tsx`의 `sharedDraft` 구조분해(약 line 38~53)에 `selectedPlatform` 추가:

기존:
```typescript
  const {
    detailPageFullHtml,
    detailPageSnippet,
    detailPageSnippetNaver,
    description,
    name,
    detailPageStatus,
    detailPageError,
    detailPageEditStatus,
    detailPageEditError,
    pickedDetailImages,
    thumbnailImages,
    detailImages,
    sourceUrl,
  } = sharedDraft;
```

변경 후:
```typescript
  const {
    detailPageFullHtml,
    detailPageSnippet,
    detailPageSnippetNaver,
    description,
    name,
    detailPageStatus,
    detailPageError,
    detailPageEditStatus,
    detailPageEditError,
    pickedDetailImages,
    thumbnailImages,
    detailImages,
    sourceUrl,
    selectedPlatform,
  } = sharedDraft;
```

- [ ] **Step 3: `handleRegistered` 콜백을 플랫폼별로 처리**

파일에서 `handleRegistered` 함수를 찾는다(약 line 155~165). 현재는:
```typescript
  function handleRegistered() {
    setRegistered(true);
  }
```

그대로 유지하면 된다. 다음 Step에서 `onSuccess` 시그니처가 달라지므로 각 패널이 고유 콜백을 받도록 래퍼 함수를 추가한다:

```typescript
  function handleCoupangRegistered() {
    setRegistered(true);
  }

  function handleNaverRegistered(_originProductNo: number) {
    setRegistered(true);
  }
```

- [ ] **Step 4: 패널 렌더링 로직 교체**

약 line 580~583의 패널 렌더링 부분:

기존:
```tsx
          {showRegisterForm && !registered && (
            <CoupangAutoRegisterPanel onSuccess={handleRegistered} />
          )}
```

변경 후:
```tsx
          {showRegisterForm && !registered && (
            <>
              {(selectedPlatform === 'coupang' || selectedPlatform === 'both') && (
                <CoupangAutoRegisterPanel onSuccess={handleCoupangRegistered} />
              )}
              {(selectedPlatform === 'naver' || selectedPlatform === 'both') && (
                <div style={{ marginTop: selectedPlatform === 'both' ? '16px' : '0' }}>
                  <NaverAutoRegisterPanel onSuccess={handleNaverRegistered} />
                </div>
              )}
            </>
          )}
```

- [ ] **Step 5: TypeScript + 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | grep -i "Step3\|NaverAuto\|CoupangAuto"
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/workflow/Step3ReviewRegister.tsx
git commit -m "feat(ui): show NaverAutoRegisterPanel in Step3 based on selectedPlatform"
```

---

## Task 8: 전체 테스트 실행

- [ ] **Step 1: 전체 테스트 통과 확인**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: 새 테스트 포함 모두 `PASS`, 기존 테스트 regression 없음

- [ ] **Step 2: dev 서버 기동 후 UI 확인**

```bash
npm run dev
```

브라우저에서 확인:
1. 상품 소싱 → Step 1에서 플랫폼 "네이버" 선택 → Step 3 진입 → 우측에 `NaverAutoRegisterPanel` 표시
2. 상품명 입력 → 카테고리 검색 → "선풍기" 검색 → 결과 선택
3. 임시저장 클릭 → "저장됐습니다" 피드백
4. "네이버에 제출" 버튼 비활성화 조건 확인 (카테고리 없으면 비활성, 상세설명 없으면 비활성)
5. 플랫폼 "both" 선택 시 두 패널이 모두 표시되는지 확인

- [ ] **Step 3: 최종 커밋**

```bash
git add -A
git commit -m "feat: naver smartstore draft+submit panel complete"
```
