# Assets Draft 임시저장·불러오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "썸네일·상세만 만들기" 탭에 이름을 붙여 여러 개 저장하고 불러올 수 있는 임시저장 기능을 추가한다.

**Architecture:** Supabase에 `assets_drafts` 테이블을 추가하고 `/api/listing/assets/drafts` API Route를 통해 CRUD를 처리한다. 클라이언트 라이브러리 함수 3개와 `AssetsSaveLoad` 컴포넌트를 만들어 `AssetsInputPanel` 상단에 마운트한다.

**Tech Stack:** Next.js App Router API Routes, Supabase (PostgreSQL + @supabase/ssr), Vitest + MSW, React (인라인 스타일)

---

## File Map

| 파일 | 역할 |
|------|------|
| Supabase SQL (직접 실행) | `assets_drafts` 테이블 DDL |
| `src/app/api/listing/assets/drafts/route.ts` | GET 목록 / POST 저장 |
| `src/app/api/listing/assets/drafts/[id]/route.ts` | DELETE 삭제 |
| `src/lib/listing/assets-drafts.ts` | 클라이언트 fetch 라이브러리 |
| `src/components/listing/assets/AssetsSaveLoad.tsx` | 저장/불러오기 UI 컴포넌트 |
| `src/components/listing/assets/AssetsInputPanel.tsx` | AssetsSaveLoad 통합 (수정) |
| `src/__tests__/api/assets-drafts.test.ts` | API Route 단위 테스트 |
| `src/__tests__/lib/assets-drafts.test.ts` | 라이브러리 함수 단위 테스트 |

---

## Task 1: Supabase 테이블 생성

**Files:**
- 없음 (Supabase SQL Editor에서 직접 실행)

- [ ] **Step 1: Supabase SQL Editor에서 아래 DDL을 실행한다**

  Supabase 대시보드 → SQL Editor → New Query → 붙여넣기 후 Run:

  ```sql
  create table if not exists assets_drafts (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    name        text not null,
    draft_data  jsonb not null default '{}',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
  );

  create index if not exists assets_drafts_user_created
    on assets_drafts (user_id, created_at desc);
  ```

- [ ] **Step 2: 테이블 생성 확인**

  SQL Editor에서 실행:
  ```sql
  select column_name, data_type from information_schema.columns
  where table_name = 'assets_drafts';
  ```
  Expected: `id`, `user_id`, `name`, `draft_data`, `created_at`, `updated_at` 6개 컬럼이 나타남.

---

## Task 2: GET/POST API Route + 테스트

**Files:**
- Create: `src/app/api/listing/assets/drafts/route.ts`
- Create: `src/__tests__/api/assets-drafts.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

  `src/__tests__/api/assets-drafts.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { NextRequest } from 'next/server';

  vi.mock('@/lib/supabase/auth', () => ({
    requireAuth: vi.fn(),
  }));
  vi.mock('@/lib/supabase/server', () => ({
    getSupabaseServerClient: vi.fn(),
  }));

  import { requireAuth } from '@/lib/supabase/auth';
  import { getSupabaseServerClient } from '@/lib/supabase/server';

  const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
  const mockGetSupabase = getSupabaseServerClient as ReturnType<typeof vi.fn>;

  const { GET, POST } = await import('@/app/api/listing/assets/drafts/route');

  function makeGet(): NextRequest {
    return new NextRequest('http://localhost/api/listing/assets/drafts', { method: 'GET' });
  }
  function makePost(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/listing/assets/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // SELECT: from → select → eq → order → limit
  function buildSelectMock(result: { data: unknown; error: null | { message: string } }) {
    return {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(result),
            }),
          }),
        }),
      }),
    };
  }

  // INSERT: from → insert → select → single
  function buildInsertMock(result: { data: unknown; error: null | { message: string } }) {
    return {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'test-user-id' });
  });

  describe('GET /api/listing/assets/drafts', () => {
    it('인증 없으면 requireAuth가 반환한 401 Response를 그대로 반환한다', async () => {
      mockAuth.mockResolvedValue(
        new Response(JSON.stringify({ error: '인증 필요' }), { status: 401 }),
      );
      const res = await GET(makeGet());
      expect(res.status).toBe(401);
    });

    it('임시저장 목록을 200으로 반환한다', async () => {
      const rows = [
        { id: 'uuid-1', name: '작업1', draft_data: { mode: 'url' }, created_at: '2026-05-10T00:00:00Z' },
      ];
      mockGetSupabase.mockReturnValue(buildSelectMock({ data: rows, error: null }));

      const res = await GET(makeGet());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.drafts).toHaveLength(1);
      expect(body.drafts[0].id).toBe('uuid-1');
      expect(body.drafts[0].name).toBe('작업1');
      expect(body.drafts[0].draftData).toEqual({ mode: 'url' });
    });
  });

  describe('POST /api/listing/assets/drafts', () => {
    it('name 없으면 400을 반환한다', async () => {
      const res = await POST(makePost({ draftData: {} }));
      expect(res.status).toBe(400);
      expect(mockGetSupabase).not.toHaveBeenCalled();
    });

    it('draftData 없으면 400을 반환한다', async () => {
      const res = await POST(makePost({ name: '작업1' }));
      expect(res.status).toBe(400);
    });

    it('정상 저장 시 201과 id를 반환한다', async () => {
      mockGetSupabase.mockReturnValue(
        buildInsertMock({ data: { id: 'new-uuid' }, error: null }),
      );
      const res = await POST(makePost({ name: '작업1', draftData: { mode: 'url', url: 'https://example.com' } }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('new-uuid');
    });
  });
  ```

- [ ] **Step 2: 테스트가 실패하는지 확인**

  ```bash
  npx vitest run src/__tests__/api/assets-drafts.test.ts
  ```
  Expected: `Cannot find module '@/app/api/listing/assets/drafts/route'` 에러로 실패.

- [ ] **Step 3: API Route 구현**

  `src/app/api/listing/assets/drafts/route.ts`:

  ```ts
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
        .from('assets_drafts')
        .select('id, name, draft_data, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      const drafts = (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        draftData: row.draft_data as Record<string, unknown>,
        createdAt: row.created_at as string,
      }));

      return Response.json({ drafts });
    } catch (err) {
      console.error('[GET /api/listing/assets/drafts]', err);
      return Response.json(
        { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
        { status: 500 },
      );
    }
  }

  const CreateDraftSchema = z.object({
    name: z.string().min(1),
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

    const { name, draftData } = parseResult.data;

    try {
      const supabase = getSupabaseServerClient();
      const { data, error } = await supabase
        .from('assets_drafts')
        .insert({ user_id: userId, name, draft_data: draftData })
        .select('id')
        .single();

      if (error) throw error;

      return Response.json({ id: (data as { id: string }).id }, { status: 201 });
    } catch (err) {
      console.error('[POST /api/listing/assets/drafts]', err);
      return Response.json(
        { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
        { status: 500 },
      );
    }
  }
  ```

- [ ] **Step 4: 테스트 통과 확인**

  ```bash
  npx vitest run src/__tests__/api/assets-drafts.test.ts
  ```
  Expected: 5개 테스트 모두 PASS.

- [ ] **Step 5: 커밋**

  ```bash
  git add src/app/api/listing/assets/drafts/route.ts src/__tests__/api/assets-drafts.test.ts
  git commit -m "feat(assets): GET/POST /api/listing/assets/drafts API Route 추가"
  ```

---

## Task 3: DELETE API Route + 테스트

**Files:**
- Create: `src/app/api/listing/assets/drafts/[id]/route.ts`
- Modify: `src/__tests__/api/assets-drafts.test.ts` (DELETE 테스트 추가)

- [ ] **Step 1: DELETE 테스트 추가**

  `src/__tests__/api/assets-drafts.test.ts` 파일 맨 아래에 추가:

  ```ts
  // DELETE 체인: from → delete → eq → eq
  function buildDeleteMock(result: { error: null | { message: string } }) {
    return {
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    };
  }

  const { DELETE } = await import('@/app/api/listing/assets/drafts/[id]/route');

  function makeDelete(id: string): NextRequest {
    return new NextRequest(`http://localhost/api/listing/assets/drafts/${id}`, { method: 'DELETE' });
  }
  function makeDeleteContext(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  describe('DELETE /api/listing/assets/drafts/[id]', () => {
    it('인증 없으면 401을 반환한다', async () => {
      mockAuth.mockResolvedValue(
        new Response(JSON.stringify({ error: '인증 필요' }), { status: 401 }),
      );
      const res = await DELETE(makeDelete('uuid-1'), makeDeleteContext('uuid-1'));
      expect(res.status).toBe(401);
    });

    it('존재하지 않는 id면 404를 반환한다', async () => {
      mockGetSupabase.mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
              }),
            }),
          }),
        }),
      });
      const res = await DELETE(makeDelete('no-such-id'), makeDeleteContext('no-such-id'));
      expect(res.status).toBe(404);
    });

    it('정상 삭제 시 200을 반환한다', async () => {
      // 소유권 확인용 SELECT mock
      const ownerMock = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
              }),
            }),
          }),
        }),
      };
      // 삭제용 DELETE mock
      const deleteMock = buildDeleteMock({ error: null });

      // getSupabaseServerClient가 두 번 호출되는 경우 각각 다른 mock 반환
      mockGetSupabase
        .mockReturnValueOnce(ownerMock)
        .mockReturnValueOnce(deleteMock);

      const res = await DELETE(makeDelete('uuid-1'), makeDeleteContext('uuid-1'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });
  ```

- [ ] **Step 2: 테스트가 실패하는지 확인**

  ```bash
  npx vitest run src/__tests__/api/assets-drafts.test.ts
  ```
  Expected: DELETE 관련 3개 테스트 실패 (`Cannot find module`).

- [ ] **Step 3: DELETE Route 구현**

  `src/app/api/listing/assets/drafts/[id]/route.ts`:

  ```ts
  import { NextRequest } from 'next/server';
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
      .from('assets_drafts')
      .select('id')
      .eq('id', draftId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return {
        error: Response.json(
          { success: false, error: '해당 항목을 찾을 수 없거나 접근 권한이 없습니다.' },
          { status: 404 },
        ),
      };
    }
    return { ok: true };
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
        .from('assets_drafts')
        .delete()
        .eq('id', draftId)
        .eq('user_id', userId);

      if (error) throw error;

      return Response.json({ success: true });
    } catch (err) {
      console.error('[DELETE /api/listing/assets/drafts/[id]]', err);
      return Response.json(
        { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
        { status: 500 },
      );
    }
  }
  ```

- [ ] **Step 4: 테스트 통과 확인**

  ```bash
  npx vitest run src/__tests__/api/assets-drafts.test.ts
  ```
  Expected: 8개 테스트 모두 PASS.

- [ ] **Step 5: 커밋**

  ```bash
  git add src/app/api/listing/assets/drafts/[id]/route.ts src/__tests__/api/assets-drafts.test.ts
  git commit -m "feat(assets): DELETE /api/listing/assets/drafts/[id] API Route 추가"
  ```

---

## Task 4: 클라이언트 라이브러리 + 테스트

**Files:**
- Create: `src/lib/listing/assets-drafts.ts`
- Create: `src/__tests__/lib/assets-drafts.test.ts`

- [ ] **Step 1: 라이브러리 테스트 파일 작성**

  `src/__tests__/lib/assets-drafts.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { http, HttpResponse } from 'msw';
  import { server } from '../mocks/server';
  import {
    getAssetsDrafts,
    saveAssetsDraft,
    deleteAssetsDraft,
    type AssetsDraftMeta,
  } from '@/lib/listing/assets-drafts';

  const mockDraft: AssetsDraftMeta = {
    id: 'draft-1',
    name: '작업1',
    draftData: { mode: 'url', url: 'https://example.com' },
    createdAt: '2026-05-10T00:00:00.000Z',
  };

  describe('getAssetsDrafts', () => {
    beforeEach(() => {
      server.use(
        http.get('/api/listing/assets/drafts', () =>
          HttpResponse.json({ drafts: [mockDraft] }),
        ),
      );
    });

    it('임시저장 목록을 반환한다', async () => {
      const result = await getAssetsDrafts();
      expect(result).toEqual([mockDraft]);
    });

    it('서버 에러 시 빈 배열을 반환한다', async () => {
      server.use(
        http.get('/api/listing/assets/drafts', () =>
          HttpResponse.json({ error: 'DB error' }, { status: 500 }),
        ),
      );
      const result = await getAssetsDrafts();
      expect(result).toEqual([]);
    });

    it('401 시 빈 배열을 반환한다', async () => {
      server.use(
        http.get('/api/listing/assets/drafts', () =>
          HttpResponse.json({ error: '인증 필요' }, { status: 401 }),
        ),
      );
      const result = await getAssetsDrafts();
      expect(result).toEqual([]);
    });
  });

  describe('saveAssetsDraft', () => {
    beforeEach(() => {
      server.use(
        http.post('/api/listing/assets/drafts', () =>
          HttpResponse.json({ id: 'draft-1' }, { status: 201 }),
        ),
      );
    });

    it('저장 후 AssetsDraftMeta를 반환한다', async () => {
      const result = await saveAssetsDraft('작업1', { mode: 'url' });
      expect(result.id).toBe('draft-1');
      expect(result.name).toBe('작업1');
      expect(result.draftData).toEqual({ mode: 'url' });
    });

    it('서버 에러 시 에러를 던진다', async () => {
      server.use(
        http.post('/api/listing/assets/drafts', () =>
          HttpResponse.json({ error: '저장 실패' }, { status: 500 }),
        ),
      );
      await expect(saveAssetsDraft('작업1', {})).rejects.toThrow('저장 실패');
    });
  });

  describe('deleteAssetsDraft', () => {
    beforeEach(() => {
      server.use(
        http.delete('/api/listing/assets/drafts/:id', () =>
          HttpResponse.json({ success: true }),
        ),
      );
    });

    it('삭제 요청 시 에러 없이 완료된다', async () => {
      await expect(deleteAssetsDraft('draft-1')).resolves.not.toThrow();
    });

    it('서버 에러 시 에러를 던진다', async () => {
      server.use(
        http.delete('/api/listing/assets/drafts/:id', () =>
          HttpResponse.json({ error: '삭제 실패' }, { status: 500 }),
        ),
      );
      await expect(deleteAssetsDraft('draft-1')).rejects.toThrow('삭제 실패');
    });
  });
  ```

- [ ] **Step 2: 테스트가 실패하는지 확인**

  ```bash
  npx vitest run src/__tests__/lib/assets-drafts.test.ts
  ```
  Expected: `Cannot find module '@/lib/listing/assets-drafts'` 에러로 실패.

- [ ] **Step 3: 라이브러리 구현**

  `src/lib/listing/assets-drafts.ts`:

  ```ts
  export interface AssetsDraftMeta {
    id: string;
    name: string;
    draftData: Record<string, unknown>;
    createdAt: string;
  }

  export async function getAssetsDrafts(): Promise<AssetsDraftMeta[]> {
    try {
      const res = await fetch('/api/listing/assets/drafts');
      if (!res.ok) return [];
      const json = await res.json();
      return json.drafts ?? [];
    } catch {
      return [];
    }
  }

  export async function saveAssetsDraft(
    name: string,
    draftData: Record<string, unknown>,
  ): Promise<AssetsDraftMeta> {
    const res = await fetch('/api/listing/assets/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, draftData }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? '임시저장 실패');
    // API는 { id }만 반환하므로 클라이언트 측에서 AssetsDraftMeta 조합
    return {
      id: json.id as string,
      name,
      draftData,
      createdAt: new Date().toISOString(),
    };
  }

  export async function deleteAssetsDraft(id: string): Promise<void> {
    const res = await fetch(`/api/listing/assets/drafts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? '삭제 실패');
    }
  }
  ```

- [ ] **Step 4: 테스트 통과 확인**

  ```bash
  npx vitest run src/__tests__/lib/assets-drafts.test.ts
  ```
  Expected: 7개 테스트 모두 PASS.

- [ ] **Step 5: 커밋**

  ```bash
  git add src/lib/listing/assets-drafts.ts src/__tests__/lib/assets-drafts.test.ts
  git commit -m "feat(assets): assets-drafts 클라이언트 라이브러리 추가"
  ```

---

## Task 5: AssetsSaveLoad 컴포넌트

**Files:**
- Create: `src/components/listing/assets/AssetsSaveLoad.tsx`

- [ ] **Step 1: 컴포넌트 파일 작성**

  `src/components/listing/assets/AssetsSaveLoad.tsx`:

  ```tsx
  'use client';

  import React, { useState, useEffect } from 'react';
  import {
    getAssetsDrafts,
    saveAssetsDraft,
    deleteAssetsDraft,
    type AssetsDraftMeta,
  } from '@/lib/listing/assets-drafts';
  import { C } from '@/lib/design-tokens';

  interface Props {
    currentDraftData: Record<string, unknown>;
    onLoad: (data: Record<string, unknown>) => void;
  }

  const INPUT: React.CSSProperties = {
    flex: 1,
    padding: '5px 8px',
    borderRadius: 4,
    border: `1px solid ${C.border}`,
    fontSize: 12,
    background: '#fff',
    color: C.text,
  };

  const BTN: React.CSSProperties = {
    padding: '5px 10px',
    borderRadius: 4,
    border: `1px solid ${C.border}`,
    fontSize: 12,
    cursor: 'pointer',
    background: '#fff',
    color: C.text,
    whiteSpace: 'nowrap' as const,
  };

  export default function AssetsSaveLoad({ currentDraftData, onLoad }: Props) {
    const [drafts, setDrafts] = useState<AssetsDraftMeta[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [saveName, setSaveName] = useState('');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    useEffect(() => {
      getAssetsDrafts()
        .then(setDrafts)
        .catch(() => setMsg({ ok: false, text: '목록 로드 실패. 로그인을 확인해주세요.' }));
    }, []);

    const clearMsg = () => setMsg(null);

    const handleLoad = () => {
      const draft = drafts.find((d) => d.id === selectedId);
      if (!draft) return;
      onLoad(draft.draftData);
      setMsg({ ok: true, text: `"${draft.name}" 불러오기 완료` });
    };

    const handleSave = async () => {
      if (!saveName.trim()) return;
      setSaving(true);
      clearMsg();
      try {
        const saved = await saveAssetsDraft(saveName.trim(), currentDraftData);
        setDrafts((prev) => [saved, ...prev]);
        setSaveName('');
        setMsg({ ok: true, text: '저장 완료!' });
      } catch (err) {
        setMsg({ ok: false, text: err instanceof Error ? err.message : '저장 실패' });
      } finally {
        setSaving(false);
      }
    };

    const handleDelete = async () => {
      if (!selectedId) return;
      const draft = drafts.find((d) => d.id === selectedId);
      if (!draft || !window.confirm(`"${draft.name}"을(를) 삭제할까요?`)) return;
      setDeleting(true);
      clearMsg();
      try {
        await deleteAssetsDraft(selectedId);
        setDrafts((prev) => prev.filter((d) => d.id !== selectedId));
        setSelectedId('');
        setMsg({ ok: true, text: '삭제 완료' });
      } catch (err) {
        setMsg({ ok: false, text: err instanceof Error ? err.message : '삭제 실패' });
      } finally {
        setDeleting(false);
      }
    };

    const canLoad = !!selectedId;
    const canDelete = !!selectedId && !deleting;
    const canSave = !saving && !!saveName.trim();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>임시저장</div>

        {/* 불러오기 + 삭제 행 */}
        <div style={{ display: 'flex', gap: 4 }}>
          <select
            style={INPUT}
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); clearMsg(); }}
          >
            <option value="">
              {drafts.length === 0 ? '저장된 항목 없음' : '불러올 항목 선택...'}
            </option>
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button
            style={{ ...BTN, opacity: canLoad ? 1 : 0.4 }}
            onClick={handleLoad}
            disabled={!canLoad}
          >
            불러오기
          </button>
          <button
            style={{ ...BTN, color: '#dc2626', opacity: canDelete ? 1 : 0.4 }}
            onClick={handleDelete}
            disabled={!canDelete}
            title="선택한 항목 삭제"
          >
            삭제
          </button>
        </div>

        {/* 저장 행 */}
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            style={INPUT}
            placeholder="이름 입력 후 저장"
            value={saveName}
            onChange={(e) => { setSaveName(e.target.value); clearMsg(); }}
            onKeyDown={(e) => e.key === 'Enter' && canSave && handleSave()}
          />
          <button
            style={{ ...BTN, opacity: canSave ? 1 : 0.4 }}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>

        {msg && (
          <p style={{ fontSize: 11, margin: 0, color: msg.ok ? '#16a34a' : '#dc2626' }}>
            {msg.text}
          </p>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 2: TypeScript 타입 에러 없는지 확인**

  ```bash
  npx tsc --noEmit 2>&1 | grep -i "AssetsSaveLoad\|assets-drafts" | head -20
  ```
  Expected: 출력 없음 (에러 없음).

- [ ] **Step 3: 커밋**

  ```bash
  git add src/components/listing/assets/AssetsSaveLoad.tsx
  git commit -m "feat(assets): AssetsSaveLoad 임시저장·불러오기 컴포넌트 추가"
  ```

---

## Task 6: AssetsInputPanel 수정 + 통합 확인

**Files:**
- Modify: `src/components/listing/assets/AssetsInputPanel.tsx`

- [ ] **Step 1: AssetsInputPanel 수정 — import 추가**

  `src/components/listing/assets/AssetsInputPanel.tsx` 4번째 줄(`import { prepareUpload ... }` 아래)에 한 줄 추가:

  ```ts
  import AssetsSaveLoad from './AssetsSaveLoad';
  ```

- [ ] **Step 2: currentDraftData 계산 추가**

  함수 본문의 아래 줄:
  ```ts
  const { mode, url, thumbnailFiles, detailFiles, isGenerating } = assetsDraft;
  ```
  을 다음으로 교체:
  ```ts
  const { mode, url, thumbnailFiles, detailFiles, isGenerating } = assetsDraft;
  // UI 전용 필드 제외한 저장용 스냅샷
  const {
    isGenerating: _ig,
    generatingMessage: _gm,
    lastError: _le,
    ...currentDraftData
  } = assetsDraft;
  ```

- [ ] **Step 3: AssetsSaveLoad 마운트**

  `return (` 직후의 여는 `<div style={{ backgroundColor: C.card, ... }}>` 바로 다음, 기존 `{/* 모드 선택 라디오 버튼 */}` `<div>` 앞에 아래 코드를 삽입:

  ```tsx
  {/* 임시저장·불러오기 */}
  <AssetsSaveLoad
    currentDraftData={currentDraftData as Record<string, unknown>}
    onLoad={(data) => updateAssetsDraft(data as Parameters<typeof updateAssetsDraft>[0])}
  />
  <hr style={{ border: 'none', borderTop: '1px solid #eeeeee', margin: 0 }} />
  ```

  삽입 후 파일 구조:
  ```tsx
  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 임시저장·불러오기 */}
      <AssetsSaveLoad
        currentDraftData={currentDraftData as Record<string, unknown>}
        onLoad={(data) => updateAssetsDraft(data as Parameters<typeof updateAssetsDraft>[0])}
      />
      <hr style={{ border: 'none', borderTop: '1px solid #eeeeee', margin: 0 }} />
      {/* 모드 선택 라디오 버튼 */}
      <div style={{ display: 'flex', gap: '16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          ... (기존 코드 그대로)
  ```

- [ ] **Step 2: TypeScript 에러 없는지 확인**

  ```bash
  npx tsc --noEmit 2>&1 | grep -E "AssetsInputPanel|AssetsSaveLoad" | head -20
  ```
  Expected: 출력 없음.

- [ ] **Step 3: 전체 테스트 통과 확인**

  ```bash
  npx vitest run
  ```
  Expected: 기존 테스트 포함 전부 PASS, 새로 추가한 assets-drafts 테스트도 PASS.

- [ ] **Step 4: 커밋**

  ```bash
  git add src/components/listing/assets/AssetsInputPanel.tsx
  git commit -m "feat(assets): AssetsInputPanel에 임시저장·불러오기 UI 통합"
  ```

---

## 완료 체크리스트

- [ ] Supabase `assets_drafts` 테이블 생성 완료
- [ ] GET/POST API Route 테스트 통과
- [ ] DELETE API Route 테스트 통과
- [ ] 클라이언트 라이브러리 테스트 통과
- [ ] `AssetsSaveLoad` 컴포넌트 TypeScript 에러 없음
- [ ] `AssetsInputPanel` 수정 후 TypeScript 에러 없음
- [ ] `npx vitest run` 전체 PASS
