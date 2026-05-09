# Label Save/Load/Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4개 라벨 에디터(품질표시, 이벤트 카드, 이미지 2×2, 영양정보 2×3) 모두에서 이름을 붙여 저장하고, 나중에 불러오거나 삭제할 수 있도록 구현한다.

**Architecture:** 기존 `label_templates` Supabase 테이블에 `label_type` 컬럼을 추가해 타입별로 구분한다. 공용 `LabelSaveLoad` 컴포넌트 하나가 4개 에디터 모두에서 사용된다. 각 에디터는 현재 상태를 `Record<string, unknown>` 으로 직렬화해 전달하고, 불러올 때 역직렬화한다.

**Tech Stack:** Next.js App Router, Supabase (PostgreSQL), React, TypeScript, Vitest

---

## File Map

| 경로 | 역할 |
|------|------|
| `supabase/migrations/060_label_type.sql` | CREATE: label_type 컬럼 추가 마이그레이션 |
| `src/lib/label/label-templates.ts` | MODIFY: LabelType 타입 추가, API 함수 일반화 |
| `src/app/api/label/templates/route.ts` | MODIFY: GET에 type 필터, POST에 label_type 수신 |
| `src/components/label/LabelSaveLoad.tsx` | CREATE: 공용 저장/불러오기/삭제 UI 컴포넌트 |
| `src/components/label/LabelEditor.tsx` | MODIFY: TemplatePicker → LabelSaveLoad 교체 |
| `src/components/label/EventCardEditor.tsx` | MODIFY: LabelSaveLoad 섹션 추가 |
| `src/components/label/ImageLabel2x2Editor.tsx` | MODIFY: LabelSaveLoad 섹션 추가 |
| `src/components/label/NutritionLabel2x3Editor.tsx` | MODIFY: LabelSaveLoad 섹션 추가 |
| `src/__tests__/api/label-templates.test.ts` | CREATE: GET type 필터, POST label_type 저장 테스트 |

---

## Task 1: DB 마이그레이션 — label_type 컬럼 추가

**Files:**
- Create: `supabase/migrations/060_label_type.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- supabase/migrations/060_label_type.sql
ALTER TABLE label_templates
  ADD COLUMN IF NOT EXISTS label_type TEXT NOT NULL DEFAULT 'quality';

CREATE INDEX IF NOT EXISTS idx_label_templates_user_type
  ON label_templates (user_id, label_type);
```

- [ ] **Step 2: Supabase에 적용**

```bash
npx supabase db push
```

Expected: 오류 없이 완료. `label_templates` 테이블에 `label_type` 컬럼이 생기고, 기존 행은 모두 `'quality'` 값을 가진다.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/060_label_type.sql
git commit -m "feat(label): label_type 컬럼 추가 — 라벨 타입별 템플릿 구분"
```

---

## Task 2: label-templates.ts — 타입 및 함수 일반화

**Files:**
- Modify: `src/lib/label/label-templates.ts`

- [ ] **Step 1: 파일 전체를 아래 내용으로 교체**

```ts
// src/lib/label/label-templates.ts

export type LabelType = 'quality' | 'event' | 'image2x2' | 'nutrition2x3';

export interface QualityFields {
  productName: string;
  material: string;
  size: string;
  country: string;
  importer: string;
  address: string;
  phone: string;
  extra: string;
}

export interface LabelTemplate {
  id: string;
  user_id: string;
  name: string;
  image_url: string;
  label_type: LabelType;
  fields: Record<string, unknown>;
  created_at: string;
}

export async function getLabelTemplates(labelType: LabelType): Promise<LabelTemplate[]> {
  const res = await fetch(`/api/label/templates?type=${encodeURIComponent(labelType)}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.templates ?? [];
}

export async function saveLabelTemplate(
  name: string,
  labelType: LabelType,
  fields: Record<string, unknown>,
): Promise<LabelTemplate> {
  const res = await fetch('/api/label/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, labelType, fields }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? '템플릿 저장 실패');
  return json.template as LabelTemplate;
}

export async function deleteLabelTemplate(id: string): Promise<void> {
  const res = await fetch(`/api/label/templates?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? '삭제 실패');
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/label/label-templates.ts
git commit -m "refactor(label): label-templates 타입 일반화 — LabelType + 범용 fields"
```

---

## Task 3: API 라우트 업데이트

**Files:**
- Modify: `src/app/api/label/templates/route.ts`

- [ ] **Step 1: 파일 전체를 아래 내용으로 교체**

```ts
// src/app/api/label/templates/route.ts
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { LabelType } from '@/lib/label/label-templates';

const VALID_TYPES: LabelType[] = ['quality', 'event', 'image2x2', 'nutrition2x3'];

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const rawType = request.nextUrl.searchParams.get('type') ?? 'quality';
  const labelType: LabelType = VALID_TYPES.includes(rawType as LabelType)
    ? (rawType as LabelType)
    : 'quality';

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('label_templates')
    .select('*')
    .eq('user_id', auth.userId)
    .eq('label_type', labelType)
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ templates: data ?? [] });
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '잘못된 요청 바디입니다.' }, { status: 400 });
  }

  const { name, labelType, fields } = body as {
    name?: string;
    labelType?: string;
    fields?: Record<string, unknown>;
  };

  if (!name?.trim()) {
    return Response.json({ error: '템플릿 이름을 입력해주세요.' }, { status: 400 });
  }

  const resolvedType: LabelType = VALID_TYPES.includes(labelType as LabelType)
    ? (labelType as LabelType)
    : 'quality';

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('label_templates')
    .insert({
      user_id: auth.userId,
      name: name.trim(),
      image_url: '',
      label_type: resolvedType,
      fields: fields ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    return Response.json({ error: error?.message ?? '저장 실패' }, { status: 500 });
  }

  return Response.json({ template: data }, { status: 201 });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from('label_templates')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.userId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/label/templates/route.ts
git commit -m "feat(api): label/templates GET type 필터, POST label_type 수신"
```

---

## Task 4: API 테스트 작성

**Files:**
- Create: `src/__tests__/api/label-templates.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```ts
// src/__tests__/api/label-templates.test.ts
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
const mockSupabaseFactory = getSupabaseServerClient as ReturnType<typeof vi.fn>;

const { GET, POST, DELETE } = await import('@/app/api/label/templates/route');

function makeSupabaseMock(selectResult: unknown[], insertResult: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data: insertResult, error: null });
  const insert = vi.fn().mockReturnValue({ select: () => ({ single }) });
  const orderFn = vi.fn().mockResolvedValue({ data: selectResult, error: null });
  const eqUser = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order: () => orderFn() }) });
  const select = vi.fn().mockReturnValue({ eq: eqUser });
  const deleteFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  });
  return { from: vi.fn().mockReturnValue({ select, insert, delete: deleteFn }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: 'user-1' });
});

describe('GET /api/label/templates', () => {
  it('type=event 쿼리 시 event 타입 템플릿만 반환', async () => {
    const eventTemplates = [{ id: '1', label_type: 'event', name: '이벤트1', fields: {} }];
    mockSupabaseFactory.mockReturnValue(makeSupabaseMock(eventTemplates));

    const req = new NextRequest('http://localhost/api/label/templates?type=event');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.templates).toEqual(eventTemplates);
  });

  it('type 파라미터 없으면 quality 타입으로 조회', async () => {
    const qualityTemplates = [{ id: '2', label_type: 'quality', name: '품질1', fields: {} }];
    mockSupabaseFactory.mockReturnValue(makeSupabaseMock(qualityTemplates));

    const req = new NextRequest('http://localhost/api/label/templates');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.templates).toEqual(qualityTemplates);
  });

  it('유효하지 않은 type은 quality로 fallback', async () => {
    mockSupabaseFactory.mockReturnValue(makeSupabaseMock([]));
    const req = new NextRequest('http://localhost/api/label/templates?type=invalid');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/label/templates', () => {
  it('name 없으면 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/label/templates', {
      method: 'POST',
      body: JSON.stringify({ labelType: 'event', fields: {} }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('정상 저장 시 201 반환', async () => {
    const saved = { id: '3', label_type: 'event', name: '이벤트저장', fields: { companyName: '테스트' } };
    mockSupabaseFactory.mockReturnValue(makeSupabaseMock([], saved));

    const req = new NextRequest('http://localhost/api/label/templates', {
      method: 'POST',
      body: JSON.stringify({ name: '이벤트저장', labelType: 'event', fields: { companyName: '테스트' } }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/label/templates', () => {
  it('id 없으면 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/label/templates', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('id 있으면 200 반환', async () => {
    mockSupabaseFactory.mockReturnValue(makeSupabaseMock([]));
    const req = new NextRequest('http://localhost/api/label/templates?id=abc', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/label-templates.test.ts
```

Expected: 현재 API에 `type` 필터가 없으므로 일부 테스트 FAIL.

- [ ] **Step 3: Task 3 완료 후 테스트 재실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/label-templates.test.ts
```

Expected: 모든 테스트 PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/__tests__/api/label-templates.test.ts
git commit -m "test(label): templates API GET type 필터 / POST / DELETE 단위 테스트"
```

---

## Task 5: LabelSaveLoad 공용 컴포넌트 생성

**Files:**
- Create: `src/components/label/LabelSaveLoad.tsx`

이 컴포넌트는 모든 에디터가 공유한다. 에디터는 `currentData`(현재 폼 상태 전체를 JSON으로), `labelType`, `onLoad` 콜백을 전달한다.

불러오기 시 `fields` 와 `image_url`(하위 호환용)을 병합해 `onLoad` 에 전달한다:
```
mergedData = { imageUrl: template.image_url, ...template.fields }
```
이렇게 하면 구버전 quality 템플릿(`image_url`에 URL 저장)도 올바르게 로드된다.

- [ ] **Step 1: 컴포넌트 파일 작성**

```tsx
// src/components/label/LabelSaveLoad.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  getLabelTemplates,
  saveLabelTemplate,
  deleteLabelTemplate,
  type LabelType,
  type LabelTemplate,
} from '@/lib/label/label-templates';

interface Props {
  labelType: LabelType;
  currentData: Record<string, unknown>;
  onLoad: (data: Record<string, unknown>) => void;
}

const INPUT: React.CSSProperties = {
  flex: 1, padding: '5px 8px', borderRadius: 4,
  border: '1px solid #d1d5db', fontSize: 12,
  background: '#fff', color: '#111',
};

const BTN: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 4,
  border: '1px solid #d1d5db', fontSize: 12,
  cursor: 'pointer', background: '#fff', color: '#111',
};

export default function LabelSaveLoad({ labelType, currentData, onLoad }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getLabelTemplates(labelType)
      .then(setTemplates)
      .catch(() => setMsg({ ok: false, text: '목록 로드 실패. 로그인을 확인해주세요.' }));
  }, [labelType]);

  const clearMsg = () => setMsg(null);

  const handleLoad = () => {
    const tmpl = templates.find((t) => t.id === selectedId);
    if (!tmpl) return;
    // image_url 하위 호환: fields 안에 imageUrl 없으면 image_url 컬럼 값 사용
    const merged: Record<string, unknown> = {
      imageUrl: tmpl.image_url || undefined,
      ...tmpl.fields,
    };
    onLoad(merged);
    setMsg({ ok: true, text: `"${tmpl.name}" 불러오기 완료` });
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    clearMsg();
    try {
      const tmpl = await saveLabelTemplate(saveName.trim(), labelType, currentData);
      setTemplates((prev) => [tmpl, ...prev]);
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
    const tmpl = templates.find((t) => t.id === selectedId);
    if (!tmpl || !window.confirm(`"${tmpl.name}"을(를) 삭제할까요?`)) return;
    setDeleting(true);
    clearMsg();
    try {
      await deleteLabelTemplate(selectedId);
      setTemplates((prev) => prev.filter((t) => t.id !== selectedId));
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
      {/* 불러오기 + 삭제 행 */}
      <div style={{ display: 'flex', gap: 4 }}>
        <select
          style={{ ...INPUT }}
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); clearMsg(); }}
        >
          <option value="">
            {templates.length === 0 ? '저장된 템플릿 없음' : '템플릿 선택...'}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
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
          title="선택한 템플릿 삭제"
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

- [ ] **Step 2: 커밋**

```bash
git add src/components/label/LabelSaveLoad.tsx
git commit -m "feat(label): LabelSaveLoad 공용 저장/불러오기/삭제 컴포넌트"
```

---

## Task 6: LabelEditor — TemplatePicker를 LabelSaveLoad로 교체

**Files:**
- Modify: `src/components/label/LabelEditor.tsx`

현재 LabelEditor는 TemplatePicker를 사용하며 `imageUrl`과 `fields`를 별도로 전달한다. LabelSaveLoad에는 두 값을 합쳐서 전달하고, onLoad에서 분리한다.

- [ ] **Step 1: LabelEditor.tsx 읽기 (전체 내용 확인)**

파일 전체를 읽어 정확한 import 목록과 state 변수명을 확인한다.

- [ ] **Step 2: import 수정 — TemplatePicker 제거, LabelSaveLoad 추가**

`TemplatePicker` import를 `LabelSaveLoad`로 교체:

```ts
// 삭제
import TemplatePicker from './TemplatePicker';

// 추가
import LabelSaveLoad from './LabelSaveLoad';
```

- [ ] **Step 3: TemplatePicker JSX를 LabelSaveLoad로 교체**

LabelEditor 내의 TemplatePicker JSX를 찾아 아래로 교체:

```tsx
<LabelSaveLoad
  labelType="quality"
  currentData={{ imageUrl, ...fields }}
  onLoad={(data) => {
    const { imageUrl: loadedUrl, ...rest } = data as { imageUrl?: string } & Record<string, unknown>;
    if (loadedUrl) setImageUrl(loadedUrl);
    setFields(rest as QualityFields);
  }}
/>
```

- [ ] **Step 4: TypeScript 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | grep "LabelEditor\|LabelSaveLoad\|TemplatePicker"
```

Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/components/label/LabelEditor.tsx
git commit -m "refactor(label): LabelEditor TemplatePicker → LabelSaveLoad 교체"
```

---

## Task 7: EventCardEditor — LabelSaveLoad 추가

**Files:**
- Modify: `src/components/label/EventCardEditor.tsx`

저장할 데이터: `{ companyName, phone, prizeText, thanksMsg }`

- [ ] **Step 1: import 추가**

파일 상단 import에 추가:

```ts
import LabelSaveLoad from './LabelSaveLoad';
```

- [ ] **Step 2: 좌측 패널 상단에 LabelSaveLoad 섹션 삽입**

좌측 폼 div의 첫 번째 자식(첫 번째 `<div style={SECTION}>` 바로 앞)에 삽입:

```tsx
{/* 저장 / 불러오기 */}
<div style={SECTION}>
  <div style={SECTION_TITLE}>저장 / 불러오기</div>
  <LabelSaveLoad
    labelType="event"
    currentData={{ companyName, phone, prizeText, thanksMsg }}
    onLoad={(data) => {
      const d = data as { companyName?: string; phone?: string; prizeText?: string; thanksMsg?: string };
      if (d.companyName !== undefined) setCompanyName(d.companyName);
      if (d.phone !== undefined) setPhone(d.phone);
      if (d.prizeText !== undefined) setPrizeText(d.prizeText);
      if (d.thanksMsg !== undefined) setThanksMsg(d.thanksMsg);
    }}
  />
</div>
```

- [ ] **Step 3: TypeScript 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | grep "EventCardEditor\|LabelSaveLoad"
```

Expected: 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/components/label/EventCardEditor.tsx
git commit -m "feat(label): EventCardEditor 저장/불러오기/삭제 기능 추가"
```

---

## Task 8: ImageLabel2x2Editor — LabelSaveLoad 추가

**Files:**
- Modify: `src/components/label/ImageLabel2x2Editor.tsx`

저장할 데이터: `{ imageUrl, imagePosition: { x, y } }`

- [ ] **Step 1: import 추가**

```ts
import LabelSaveLoad from './LabelSaveLoad';
```

- [ ] **Step 2: 좌측 패널 상단에 LabelSaveLoad 섹션 삽입**

좌측 폼 div의 첫 번째 `<div style={SECTION}>` 바로 앞에 삽입:

```tsx
{/* 저장 / 불러오기 */}
<div style={SECTION}>
  <div style={SECTION_TITLE}>저장 / 불러오기</div>
  <LabelSaveLoad
    labelType="image2x2"
    currentData={{ imageUrl, imagePosition }}
    onLoad={(data) => {
      const d = data as { imageUrl?: string; imagePosition?: { x: number; y: number } };
      if (d.imageUrl) setImageUrl(d.imageUrl);
      if (d.imagePosition) setImagePosition(d.imagePosition);
    }}
  />
</div>
```

- [ ] **Step 3: TypeScript 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | grep "ImageLabel2x2Editor\|LabelSaveLoad"
```

Expected: 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/components/label/ImageLabel2x2Editor.tsx
git commit -m "feat(label): ImageLabel2x2Editor 저장/불러오기/삭제 기능 추가"
```

---

## Task 9: NutritionLabel2x3Editor — LabelSaveLoad 추가

**Files:**
- Modify: `src/components/label/NutritionLabel2x3Editor.tsx`

저장할 데이터: 한글 표시 사항 + 소분 계산기 입력값 + 영양 정보 전체.

- [ ] **Step 1: import 추가**

```ts
import LabelSaveLoad from './LabelSaveLoad';
import type { NutritionRow } from './nutrition-types';
```

(`NutritionRow` import가 이미 있으면 중복 추가하지 않는다.)

- [ ] **Step 2: 좌측 패널 상단에 LabelSaveLoad 섹션 삽입**

좌측 폼 div의 첫 번째 `<div style={SECTION}>` 바로 앞에 삽입:

```tsx
{/* 저장 / 불러오기 */}
<div style={SECTION}>
  <div style={SECTION_TITLE}>저장 / 불러오기</div>
  <LabelSaveLoad
    labelType="nutrition2x3"
    currentData={{
      productName, itemInfo, foodType, importer, manufacturer,
      contentAmount, expiryDate, originCountry, storageMethod, ingredients,
      unitCount, unitWeight, unitUnit,
      servingSize, calories, rows,
    }}
    onLoad={(data) => {
      const d = data as {
        productName?: string; itemInfo?: string; foodType?: string;
        importer?: string; manufacturer?: string; contentAmount?: string;
        expiryDate?: string; originCountry?: string; storageMethod?: string;
        ingredients?: string; unitCount?: string; unitWeight?: string;
        unitUnit?: string; servingSize?: string; calories?: string;
        rows?: NutritionRow[];
      };
      if (d.productName !== undefined) setProductName(d.productName);
      if (d.itemInfo !== undefined) setItemInfo(d.itemInfo);
      if (d.foodType !== undefined) setFoodType(d.foodType);
      if (d.importer !== undefined) setImporter(d.importer);
      if (d.manufacturer !== undefined) setManufacturer(d.manufacturer);
      if (d.contentAmount !== undefined) setContentAmount(d.contentAmount);
      if (d.expiryDate !== undefined) setExpiryDate(d.expiryDate);
      if (d.originCountry !== undefined) setOriginCountry(d.originCountry);
      if (d.storageMethod !== undefined) setStorageMethod(d.storageMethod);
      if (d.ingredients !== undefined) setIngredients(d.ingredients);
      if (d.unitCount !== undefined) setUnitCount(d.unitCount);
      if (d.unitWeight !== undefined) setUnitWeight(d.unitWeight);
      if (d.unitUnit !== undefined) setUnitUnit(d.unitUnit);
      if (d.servingSize !== undefined) setServingSize(d.servingSize);
      if (d.calories !== undefined) setCalories(d.calories);
      if (d.rows) setRows(d.rows);
    }}
  />
</div>
```

- [ ] **Step 3: TypeScript 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | grep "NutritionLabel2x3Editor\|LabelSaveLoad"
```

Expected: 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/components/label/NutritionLabel2x3Editor.tsx
git commit -m "feat(label): NutritionLabel2x3Editor 저장/불러오기/삭제 기능 추가"
```

---

## Task 10: 최종 검증

- [ ] **Step 1: 전체 테스트 실행**

```bash
npx vitest run src/__tests__/api/label-templates.test.ts
```

Expected: 모든 테스트 PASS.

- [ ] **Step 2: TypeScript 전체 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep -v "^$" | head -20
```

Expected: label 관련 신규 오류 없음.

- [ ] **Step 3: 로컬 서버 실행 후 수동 검증**

```bash
npm run dev
```

브라우저에서 `/label` 접속 후 각 탭에서 확인:
1. **이벤트 카드**: 입력 → 저장 → 내용 변경 → 불러오기(원래 값 복원) → 삭제
2. **이미지 2×2**: 이미지 업로드 + 위치 조절 → 저장 → 불러오기(이미지 + 위치 복원) → 삭제
3. **영양정보 2×3**: 모든 필드 입력 → 저장 → 불러오기(전체 복원) → 삭제
4. **품질표시 라벨**: 기존 TemplatePicker 동작이 LabelSaveLoad로 동일하게 작동하는지 확인
