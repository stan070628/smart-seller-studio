# 라벨 인쇄 기능 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠팡 소분 판매용 A4 라벨지(2×3, 99.1×93mm) 편집·PDF 저장·바로 인쇄 기능을 스마트셀러스튜디오 앱에 추가한다.

**Architecture:** 클라이언트 컴포넌트(`LabelEditor`)가 상태를 관리하고 `LabelPreview`에 실시간 반영. PDF는 html2pdf.js 클라이언트 래퍼(`label-pdf.ts`)로 생성, 인쇄는 `@media print` CSS + `window.print()`. 템플릿은 Supabase `label_templates` 테이블에 저장, 이미지는 API 라우트를 통해 Supabase Storage에 업로드.

**Tech Stack:** Next.js App Router, React, html2pdf.js, Supabase (Browser Client + Server Client), Vitest, @testing-library/react, MSW

---

## 파일 목록

| 역할 | 경로 |
|---|---|
| 신규 | `src/db/migrations/002_label_templates.sql` |
| 신규 | `src/lib/label/label-templates.ts` |
| 신규 | `src/lib/label/label-pdf.ts` |
| 신규 | `src/app/api/label/upload-image/route.ts` |
| 신규 | `src/components/label/LabelTextCell.tsx` |
| 신규 | `src/components/label/LabelImageCell.tsx` |
| 신규 | `src/components/label/LabelPreview.tsx` |
| 신규 | `src/components/label/QualityFieldsForm.tsx` |
| 신규 | `src/components/label/TemplatePicker.tsx` |
| 신규 | `src/components/label/LabelEditor.tsx` |
| 신규 | `src/app/label/page.tsx` |
| 수정 | `src/components/listing/ListingDashboard.tsx` |
| 신규 | `src/__tests__/lib/label-templates.test.ts` |
| 신규 | `src/__tests__/lib/label-pdf.test.ts` |
| 신규 | `src/__tests__/components/label-preview.test.tsx` |
| 신규 | `src/__tests__/components/quality-fields-form.test.tsx` |
| 신규 | `src/__tests__/components/template-picker.test.tsx` |
| 신규 | `src/__tests__/components/label-editor.test.tsx` |
| 수정 | `src/__tests__/mocks/handlers.ts` |

---

## Task 1: html2pdf.js 설치

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 패키지 설치**

```bash
npm install html2pdf.js
npm install --save-dev @types/html2pdf.js
```

- [ ] **Step 2: 설치 확인**

```bash
node -e "require('html2pdf.js'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install html2pdf.js for label PDF generation"
```

---

## Task 2: Supabase label_templates 테이블 마이그레이션

**Files:**
- Create: `src/db/migrations/002_label_templates.sql`

- [ ] **Step 1: SQL 마이그레이션 파일 작성**

`src/db/migrations/002_label_templates.sql` 파일을 생성한다:

```sql
-- label_templates: 라벨 인쇄 템플릿 저장
create table if not exists label_templates (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  image_url  text        not null default '',
  fields     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 사용자별 조회 인덱스
create index if not exists label_templates_user_id_idx on label_templates(user_id);

-- RLS 활성화
alter table label_templates enable row level security;

-- 본인 데이터만 접근 가능
create policy "Users can manage their own label templates"
  on label_templates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Supabase 대시보드에서 SQL 실행**

Supabase 프로젝트 → SQL Editor → 위 파일 내용 붙여넣기 → Run

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/002_label_templates.sql
git commit -m "feat(db): add label_templates table with RLS"
```

---

## Task 3: lib/label/label-templates.ts + 테스트

**Files:**
- Create: `src/lib/label/label-templates.ts`
- Create: `src/__tests__/lib/label-templates.test.ts`

- [ ] **Step 1: 타입 및 함수 시그니처 먼저 테스트 작성**

`src/__tests__/lib/label-templates.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// getBrowserClient 모킹
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  getBrowserClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-123' }),
}));

import {
  getLabelTemplates,
  saveLabelTemplate,
  deleteLabelTemplate,
  type QualityFields,
  type LabelTemplate,
} from '@/lib/label/label-templates';

const mockFields: QualityFields = {
  productName: '세차타월',
  material: '극세사 80% / 폴리아미드 20%',
  size: '40×40cm',
  country: '중국',
  importer: '㈜ 테스트',
  address: '서울시 강남구',
  phone: '02-000-0000',
  extra: '',
};

const mockTemplate: LabelTemplate = {
  id: 'tmpl-1',
  user_id: 'user-123',
  name: '기본 세차타월',
  image_url: 'https://example.com/logo.png',
  fields: mockFields,
  created_at: '2026-05-05T00:00:00.000Z',
};

describe('getLabelTemplates', () => {
  beforeEach(() => {
    mockFrom.mockReturnValue({
      select: mockSelect.mockReturnValue({
        eq: mockEq.mockReturnValue({
          order: mockOrder.mockResolvedValue({ data: [mockTemplate], error: null }),
        }),
      }),
    });
  });

  it('현재 유저의 템플릿 목록을 반환한다', async () => {
    const result = await getLabelTemplates();
    expect(result).toEqual([mockTemplate]);
    expect(mockFrom).toHaveBeenCalledWith('label_templates');
  });

  it('Supabase 에러 시 빈 배열을 반환한다', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });
    const result = await getLabelTemplates();
    expect(result).toEqual([]);
  });
});

describe('saveLabelTemplate', () => {
  beforeEach(() => {
    mockFrom.mockReturnValue({
      insert: mockInsert.mockReturnValue({
        select: mockSelect.mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockTemplate, error: null }),
        }),
      }),
    });
  });

  it('템플릿을 저장하고 반환한다', async () => {
    const result = await saveLabelTemplate('기본 세차타월', 'https://example.com/logo.png', mockFields);
    expect(result).toEqual(mockTemplate);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '기본 세차타월', user_id: 'user-123' })
    );
  });
});

describe('deleteLabelTemplate', () => {
  beforeEach(() => {
    mockFrom.mockReturnValue({
      delete: mockDelete.mockReturnValue({
        eq: mockEq.mockResolvedValue({ error: null }),
      }),
    });
  });

  it('id로 템플릿을 삭제한다', async () => {
    await expect(deleteLabelTemplate('tmpl-1')).resolves.not.toThrow();
    expect(mockDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/label-templates.test.ts
```
Expected: FAIL (모듈 없음)

- [ ] **Step 3: lib/label/label-templates.ts 구현**

`src/lib/label/label-templates.ts`:

```typescript
import { getBrowserClient } from '@/lib/supabase/client';
import { getCurrentUser } from '@/lib/auth';

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
  fields: QualityFields;
  created_at: string;
}

export async function getLabelTemplates(): Promise<LabelTemplate[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = getBrowserClient();
  const { data, error } = await supabase
    .from('label_templates')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as LabelTemplate[];
}

export async function saveLabelTemplate(
  name: string,
  imageUrl: string,
  fields: QualityFields,
): Promise<LabelTemplate> {
  const user = await getCurrentUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const supabase = getBrowserClient();
  const { data, error } = await supabase
    .from('label_templates')
    .insert({ user_id: user.id, name, image_url: imageUrl, fields })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? '템플릿 저장 실패');
  return data as LabelTemplate;
}

export async function deleteLabelTemplate(id: string): Promise<void> {
  const supabase = getBrowserClient();
  const { error } = await supabase.from('label_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/label-templates.test.ts
```
Expected: PASS (3개 describe, 5개 테스트)

- [ ] **Step 5: Commit**

```bash
git add src/lib/label/label-templates.ts src/__tests__/lib/label-templates.test.ts
git commit -m "feat(label): Supabase 템플릿 CRUD 라이브러리 추가"
```

---

## Task 4: POST /api/label/upload-image API 라우트

**Files:**
- Create: `src/app/api/label/upload-image/route.ts`
- Modify: `src/__tests__/mocks/handlers.ts`

- [ ] **Step 1: MSW 핸들러에 라벨 업로드 모킹 추가**

`src/__tests__/mocks/handlers.ts` 파일 끝부분, `export const handlers = [` 배열에 핸들러 추가:

```typescript
// 기존 import 아래에 추가 (파일 상단에 없으면)
// handlers.ts는 이미 http, HttpResponse를 import 중

const labelUploadHandler = http.post('/api/label/upload-image', () => {
  return HttpResponse.json(
    {
      success: true,
      data: {
        url: 'https://example.supabase.co/storage/v1/object/public/smart-seller-studio/labels/user-123/1700000000000_logo.png',
        fileName: 'logo.png',
      },
    },
    { status: 201 },
  );
});
```

그리고 `handlers` 배열에 `labelUploadHandler` 추가.

- [ ] **Step 2: API 라우트 구현**

`src/app/api/label/upload-image/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { uploadToStorage, STORAGE_BUCKET, getSupabaseServerClient } from '@/lib/supabase/server';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ success: false, error: 'file required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) {
    return NextResponse.json({ success: false, error: 'unsupported file type' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ success: false, error: 'file too large' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `labels/${user.id}/${timestamp}_${safeName}`;

  const result = await uploadToStorage(storagePath, buffer, file.type, file.size);

  return NextResponse.json(
    { success: true, data: { url: result.url, fileName: file.name } },
    { status: 201 },
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/label/upload-image/route.ts src/__tests__/mocks/handlers.ts
git commit -m "feat(api): POST /api/label/upload-image 라벨 이미지 업로드 라우트 추가"
```

---

## Task 5: lib/label/label-pdf.ts + 테스트

**Files:**
- Create: `src/lib/label/label-pdf.ts`
- Create: `src/__tests__/lib/label-pdf.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/lib/label-pdf.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// html2pdf.js 모킹
const mockHtml2pdf = vi.fn(() => ({
  set: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  save: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('html2pdf.js', () => ({ default: mockHtml2pdf }));

import { generatePdf, printLabel } from '@/lib/label/label-pdf';

describe('generatePdf', () => {
  beforeEach(() => mockHtml2pdf.mockClear());

  it('html2pdf를 올바른 옵션으로 호출한다', async () => {
    const el = document.createElement('div');
    await generatePdf(el);

    expect(mockHtml2pdf).toHaveBeenCalledTimes(1);
    const instance = mockHtml2pdf.mock.results[0].value;
    expect(instance.set).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'label.pdf',
        jsPDF: expect.objectContaining({ unit: 'mm', format: 'a4' }),
        html2canvas: expect.objectContaining({ scale: 2, useCORS: true }),
      }),
    );
    expect(instance.from).toHaveBeenCalledWith(el);
    expect(instance.save).toHaveBeenCalled();
  });
});

describe('printLabel', () => {
  it('window.print()를 호출한다', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const el = document.createElement('div');
    printLabel(el);
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/label-pdf.test.ts
```
Expected: FAIL

- [ ] **Step 3: label-pdf.ts 구현**

`src/lib/label/label-pdf.ts`:

```typescript
export async function generatePdf(element: HTMLElement): Promise<void> {
  const html2pdf = (await import('html2pdf.js')).default;

  const opts = {
    margin: [7, 5, 7, 5] as [number, number, number, number],
    filename: 'label.pdf',
    image: { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
  };

  await html2pdf().set(opts).from(element).save();
}

export function printLabel(_element: HTMLElement): void {
  window.print();
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/label-pdf.test.ts
```
Expected: PASS (2개 테스트)

- [ ] **Step 5: Commit**

```bash
git add src/lib/label/label-pdf.ts src/__tests__/lib/label-pdf.test.ts
git commit -m "feat(label): html2pdf.js 래퍼 (PDF 생성 + 인쇄)"
```

---

## Task 6: LabelTextCell + LabelImageCell 컴포넌트

**Files:**
- Create: `src/components/label/LabelTextCell.tsx`
- Create: `src/components/label/LabelImageCell.tsx`
- Create: `src/__tests__/components/label-cells.test.tsx`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/components/label-cells.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LabelTextCell from '@/components/label/LabelTextCell';
import LabelImageCell from '@/components/label/LabelImageCell';
import type { QualityFields } from '@/lib/label/label-templates';

const mockFields: QualityFields = {
  productName: '세차타월',
  material: '극세사 80%',
  size: '40×40cm',
  country: '중국',
  importer: '㈜ 테스트',
  address: '서울시 강남구',
  phone: '02-000-0000',
  extra: 'KC인증 B123-456',
};

describe('LabelTextCell', () => {
  it('품질표시 항목 8개를 모두 렌더한다', () => {
    render(<LabelTextCell fields={mockFields} />);
    expect(screen.getByText('세차타월')).toBeInTheDocument();
    expect(screen.getByText('극세사 80%')).toBeInTheDocument();
    expect(screen.getByText('40×40cm')).toBeInTheDocument();
    expect(screen.getByText('중국')).toBeInTheDocument();
    expect(screen.getByText('㈜ 테스트')).toBeInTheDocument();
    expect(screen.getByText('서울시 강남구')).toBeInTheDocument();
    expect(screen.getByText('02-000-0000')).toBeInTheDocument();
    expect(screen.getByText('KC인증 B123-456')).toBeInTheDocument();
  });

  it('extra가 비어있으면 해당 행을 렌더하지 않는다', () => {
    const fields = { ...mockFields, extra: '' };
    render(<LabelTextCell fields={fields} />);
    expect(screen.queryByText(/KC인증/)).not.toBeInTheDocument();
  });
});

describe('LabelImageCell', () => {
  it('imageUrl이 있으면 img 태그를 렌더한다', () => {
    render(<LabelImageCell imageUrl="https://example.com/logo.png" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('imageUrl이 없으면 플레이스홀더 텍스트를 렌더한다', () => {
    render(<LabelImageCell imageUrl="" />);
    expect(screen.getByText(/이미지/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/label-cells.test.tsx
```
Expected: FAIL

- [ ] **Step 3: LabelTextCell 구현**

`src/components/label/LabelTextCell.tsx`:

```typescript
'use client';

import type { QualityFields } from '@/lib/label/label-templates';

interface Props {
  fields: QualityFields;
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  lineHeight: 1.5,
};

const LABEL_STYLE: React.CSSProperties = {
  flexShrink: 0,
  fontWeight: 600,
  width: 48,
};

export default function LabelTextCell({ fields }: Props) {
  const rows: { label: string; value: string }[] = [
    { label: '품  명', value: fields.productName },
    { label: '소  재', value: fields.material },
    { label: '크  기', value: fields.size },
    { label: '제조국', value: fields.country },
    { label: '수입원', value: fields.importer },
    { label: '주  소', value: fields.address },
    { label: '전  화', value: fields.phone },
  ];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '6px 8px',
        boxSizing: 'border-box',
        fontSize: 8,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={ROW_STYLE}>
          <span style={LABEL_STYLE}>{row.label}:</span>
          <span>{row.value}</span>
        </div>
      ))}
      {fields.extra && (
        <div style={ROW_STYLE}>
          <span style={LABEL_STYLE}>기  타:</span>
          <span>{fields.extra}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: LabelImageCell 구현**

`src/components/label/LabelImageCell.tsx`:

```typescript
'use client';

interface Props {
  imageUrl: string;
}

export default function LabelImageCell({ imageUrl }: Props) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt="상표 이미지"
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      ) : (
        <span style={{ color: '#9ca3af', fontSize: 11 }}>이미지 없음</span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/label-cells.test.tsx
```
Expected: PASS (4개 테스트)

- [ ] **Step 6: Commit**

```bash
git add src/components/label/LabelTextCell.tsx src/components/label/LabelImageCell.tsx src/__tests__/components/label-cells.test.tsx
git commit -m "feat(label): LabelTextCell + LabelImageCell 컴포넌트 추가"
```

---

## Task 7: LabelPreview 컴포넌트

**Files:**
- Create: `src/components/label/LabelPreview.tsx`
- Create: `src/__tests__/components/label-preview.test.tsx`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/components/label-preview.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LabelPreview from '@/components/label/LabelPreview';
import type { QualityFields } from '@/lib/label/label-templates';

const mockFields: QualityFields = {
  productName: '세차타월',
  material: '극세사 80%',
  size: '40×40cm',
  country: '중국',
  importer: '㈜ 테스트',
  address: '서울시 강남구',
  phone: '02-000-0000',
  extra: '',
};

describe('LabelPreview', () => {
  it('id="label-preview" 요소를 렌더한다 (인쇄/PDF 대상)', () => {
    const { container } = render(
      <LabelPreview imageUrl="" fields={mockFields} />,
    );
    expect(container.querySelector('#label-preview')).not.toBeNull();
  });

  it('이미지 칸 3개와 텍스트 칸 3개를 렌더한다', () => {
    render(<LabelPreview imageUrl="" fields={mockFields} />);
    // 품질표시 텍스트는 3번 반복
    expect(screen.getAllByText('세차타월')).toHaveLength(3);
    // imageUrl 없으면 "이미지 없음" 3개
    expect(screen.getAllByText('이미지 없음')).toHaveLength(3);
  });

  it('imageUrl이 있으면 img가 3개 렌더된다', () => {
    render(<LabelPreview imageUrl="https://example.com/logo.png" fields={mockFields} />);
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(3);
    images.forEach((img) => {
      expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
    });
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/label-preview.test.tsx
```
Expected: FAIL

- [ ] **Step 3: LabelPreview 구현**

`src/components/label/LabelPreview.tsx`:

```typescript
'use client';

import { forwardRef } from 'react';
import LabelImageCell from './LabelImageCell';
import LabelTextCell from './LabelTextCell';
import type { QualityFields } from '@/lib/label/label-templates';

interface Props {
  imageUrl: string;
  fields: QualityFields;
}

// A4: 210×297mm. 여백 좌우 5mm, 상하 7mm.
// 칸: 99.1×93mm. 가로 간격 ≈0.9mm, 세로 간격 ≈1.3mm.
const CELL_WIDTH_MM = 99.1;
const CELL_HEIGHT_MM = 93;
const GAP_H_MM = 0.9;
const GAP_V_MM = 1.3;

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `${CELL_WIDTH_MM}mm ${CELL_WIDTH_MM}mm`,
  gridTemplateRows: `repeat(3, ${CELL_HEIGHT_MM}mm)`,
  columnGap: `${GAP_H_MM}mm`,
  rowGap: `${GAP_V_MM}mm`,
  padding: '7mm 5mm',
  width: '210mm',
  minHeight: '297mm',
  boxSizing: 'border-box',
  background: '#fff',
};

const CELL_STYLE: React.CSSProperties = {
  width: `${CELL_WIDTH_MM}mm`,
  height: `${CELL_HEIGHT_MM}mm`,
  overflow: 'hidden',
  boxSizing: 'border-box',
  border: '0.2px solid #ccc',
};

const LabelPreview = forwardRef<HTMLDivElement, Props>(({ imageUrl, fields }, ref) => {
  return (
    <div id="label-preview" ref={ref} style={GRID_STYLE}>
      {[0, 1, 2].map((i) => (
        <>
          <div key={`img-${i}`} style={CELL_STYLE}>
            <LabelImageCell imageUrl={imageUrl} />
          </div>
          <div key={`text-${i}`} style={CELL_STYLE}>
            <LabelTextCell fields={fields} />
          </div>
        </>
      ))}
    </div>
  );
});

LabelPreview.displayName = 'LabelPreview';
export default LabelPreview;
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/label-preview.test.tsx
```
Expected: PASS (3개 테스트)

- [ ] **Step 5: Commit**

```bash
git add src/components/label/LabelPreview.tsx src/__tests__/components/label-preview.test.tsx
git commit -m "feat(label): LabelPreview A4 그리드 컴포넌트 추가"
```

---

## Task 8: QualityFieldsForm 컴포넌트

**Files:**
- Create: `src/components/label/QualityFieldsForm.tsx`
- Create: `src/__tests__/components/quality-fields-form.test.tsx`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/components/quality-fields-form.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QualityFieldsForm from '@/components/label/QualityFieldsForm';
import type { QualityFields } from '@/lib/label/label-templates';

const emptyFields: QualityFields = {
  productName: '',
  material: '',
  size: '',
  country: '',
  importer: '',
  address: '',
  phone: '',
  extra: '',
};

describe('QualityFieldsForm', () => {
  it('8개 입력 필드를 렌더한다', () => {
    render(<QualityFieldsForm fields={emptyFields} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/품명/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/소재/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/크기/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/제조국/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/수입원/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/주소/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/전화번호/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/기타/)).toBeInTheDocument();
  });

  it('입력 변경 시 onChange를 올바른 key로 호출한다', () => {
    const onChange = vi.fn();
    render(<QualityFieldsForm fields={emptyFields} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/품명/), { target: { value: '세차타월' } });
    expect(onChange).toHaveBeenCalledWith({ ...emptyFields, productName: '세차타월' });
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/quality-fields-form.test.tsx
```
Expected: FAIL

- [ ] **Step 3: QualityFieldsForm 구현**

`src/components/label/QualityFieldsForm.tsx`:

```typescript
'use client';

import type { QualityFields } from '@/lib/label/label-templates';

interface Props {
  fields: QualityFields;
  onChange: (fields: QualityFields) => void;
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 12,
  boxSizing: 'border-box',
};

const FIELD_CONFIGS: { key: keyof QualityFields; placeholder: string; required: boolean }[] = [
  { key: 'productName', placeholder: '품명 (예: 세차타월)', required: true },
  { key: 'material', placeholder: '소재 (예: 극세사 80% / 폴리아미드 20%)', required: true },
  { key: 'size', placeholder: '크기 (예: 40×40cm)', required: true },
  { key: 'country', placeholder: '제조국 (예: 중국)', required: true },
  { key: 'importer', placeholder: '수입원/판매원 (예: ㈜ 회사명)', required: true },
  { key: 'address', placeholder: '주소', required: true },
  { key: 'phone', placeholder: '전화번호', required: true },
  { key: 'extra', placeholder: '기타 (KC인증번호 등, 선택)', required: false },
];

export default function QualityFieldsForm({ fields, onChange }: Props) {
  const handleChange = (key: keyof QualityFields, value: string) => {
    onChange({ ...fields, [key]: value });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {FIELD_CONFIGS.map(({ key, placeholder }) => (
        <input
          key={key}
          style={INPUT_STYLE}
          placeholder={placeholder}
          value={fields[key]}
          onChange={(e) => handleChange(key, e.target.value)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/quality-fields-form.test.tsx
```
Expected: PASS (2개 테스트)

- [ ] **Step 5: Commit**

```bash
git add src/components/label/QualityFieldsForm.tsx src/__tests__/components/quality-fields-form.test.tsx
git commit -m "feat(label): QualityFieldsForm 품질표시 입력 컴포넌트 추가"
```

---

## Task 9: TemplatePicker 컴포넌트

**Files:**
- Create: `src/components/label/TemplatePicker.tsx`
- Create: `src/__tests__/components/template-picker.test.tsx`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/components/template-picker.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGetLabelTemplates = vi.fn();
const mockSaveLabelTemplate = vi.fn();
const mockDeleteLabelTemplate = vi.fn();

vi.mock('@/lib/label/label-templates', () => ({
  getLabelTemplates: mockGetLabelTemplates,
  saveLabelTemplate: mockSaveLabelTemplate,
  deleteLabelTemplate: mockDeleteLabelTemplate,
}));

import TemplatePicker from '@/components/label/TemplatePicker';
import type { QualityFields, LabelTemplate } from '@/lib/label/label-templates';

const mockFields: QualityFields = {
  productName: '세차타월', material: '극세사', size: '40×40cm',
  country: '중국', importer: '㈜테스트', address: '서울', phone: '02-0000', extra: '',
};

const mockTemplate: LabelTemplate = {
  id: 'tmpl-1', user_id: 'u1', name: '기본 템플릿',
  image_url: '', fields: mockFields, created_at: '2026-05-05T00:00:00Z',
};

describe('TemplatePicker', () => {
  beforeEach(() => {
    mockGetLabelTemplates.mockResolvedValue([mockTemplate]);
    mockSaveLabelTemplate.mockResolvedValue(mockTemplate);
  });

  it('마운트 시 템플릿 목록을 로드한다', async () => {
    render(
      <TemplatePicker
        currentImageUrl="" currentFields={mockFields}
        onLoad={vi.fn()} onImageLoad={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(mockGetLabelTemplates).toHaveBeenCalledTimes(1);
    });
  });

  it('"불러오기" 클릭 시 onLoad가 선택된 템플릿 fields로 호출된다', async () => {
    const onLoad = vi.fn();
    render(
      <TemplatePicker
        currentImageUrl="" currentFields={mockFields}
        onLoad={onLoad} onImageLoad={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByRole('combobox'));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tmpl-1' } });
    fireEvent.click(screen.getByRole('button', { name: /불러오기/ }));
    expect(onLoad).toHaveBeenCalledWith(mockFields);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/template-picker.test.tsx
```
Expected: FAIL

- [ ] **Step 3: TemplatePicker 구현**

`src/components/label/TemplatePicker.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import {
  getLabelTemplates,
  saveLabelTemplate,
  type LabelTemplate,
  type QualityFields,
} from '@/lib/label/label-templates';

interface Props {
  currentImageUrl: string;
  currentFields: QualityFields;
  onLoad: (fields: QualityFields) => void;
  onImageLoad: (imageUrl: string) => void;
}

const BTN: React.CSSProperties = {
  flex: 1, padding: '5px 10px', borderRadius: 4,
  border: '1px solid #d1d5db', fontSize: 12, cursor: 'pointer', background: '#fff',
};

export default function TemplatePicker({ currentImageUrl, currentFields, onLoad, onImageLoad }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLabelTemplates().then(setTemplates);
  }, []);

  const handleLoad = () => {
    const tmpl = templates.find((t) => t.id === selectedId);
    if (!tmpl) return;
    onLoad(tmpl.fields);
    if (tmpl.image_url) onImageLoad(tmpl.image_url);
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const tmpl = await saveLabelTemplate(saveName.trim(), currentImageUrl, currentFields);
      setTemplates((prev) => [tmpl, ...prev]);
      setSaveName('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          style={{ flex: 1, padding: '5px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12 }}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">템플릿 선택...</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button style={BTN} onClick={handleLoad} disabled={!selectedId}>불러오기</button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          style={{ flex: 1, padding: '5px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12 }}
          placeholder="템플릿 이름 입력 후 저장"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <button style={BTN} onClick={handleSave} disabled={saving || !saveName.trim()}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/template-picker.test.tsx
```
Expected: PASS (2개 테스트)

- [ ] **Step 5: Commit**

```bash
git add src/components/label/TemplatePicker.tsx src/__tests__/components/template-picker.test.tsx
git commit -m "feat(label): TemplatePicker 템플릿 저장/불러오기 컴포넌트 추가"
```

---

## Task 10: LabelEditor 조립 + @media print CSS

**Files:**
- Create: `src/components/label/LabelEditor.tsx`
- Create: `src/__tests__/components/label-editor.test.tsx`

- [ ] **Step 1: 테스트 작성**

`src/__tests__/components/label-editor.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/label/label-templates', () => ({
  getLabelTemplates: vi.fn().mockResolvedValue([]),
  saveLabelTemplate: vi.fn(),
  deleteLabelTemplate: vi.fn(),
}));

import LabelEditor from '@/components/label/LabelEditor';

describe('LabelEditor', () => {
  it('"PDF 저장" 과 "바로 인쇄" 버튼을 렌더한다', () => {
    render(<LabelEditor />);
    expect(screen.getByRole('button', { name: /PDF 저장/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /바로 인쇄/ })).toBeInTheDocument();
  });

  it('productName URL 파라미터로 품명 필드가 자동 채워진다', () => {
    vi.mock('next/navigation', () => ({
      useSearchParams: () => new URLSearchParams('productName=세차타월'),
    }));
    render(<LabelEditor />);
    // 품명 입력 필드
    const input = screen.getByPlaceholderText(/품명/);
    expect((input as HTMLInputElement).value).toBe('세차타월');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/label-editor.test.tsx
```
Expected: FAIL

- [ ] **Step 3: LabelEditor 구현**

`src/components/label/LabelEditor.tsx`:

```typescript
'use client';

import { useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import LabelPreview from './LabelPreview';
import QualityFieldsForm from './QualityFieldsForm';
import TemplatePicker from './TemplatePicker';
import { generatePdf, printLabel } from '@/lib/label/label-pdf';
import type { QualityFields } from '@/lib/label/label-templates';

const EMPTY_FIELDS: QualityFields = {
  productName: '', material: '', size: '', country: '',
  importer: '', address: '', phone: '', extra: '',
};

const C = {
  border: '#e5e7eb',
  bg: '#f9fafb',
  sectionTitle: { fontWeight: 700, fontSize: 12, marginBottom: 8 } as React.CSSProperties,
  section: { marginBottom: 16 } as React.CSSProperties,
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 12,
  fontWeight: 600, cursor: 'pointer', color: '#fff',
};

export default function LabelEditor() {
  const searchParams = useSearchParams();
  const initialProductName = searchParams.get('productName') ?? '';

  const [fields, setFields] = useState<QualityFields>({
    ...EMPTY_FIELDS,
    productName: initialProductName,
  });
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/label/upload-image', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.success) setImageUrl(json.data.url);
    } finally {
      setUploading(false);
    }
  };

  const handlePdf = async () => {
    if (!previewRef.current) return;
    await generatePdf(previewRef.current);
  };

  const handlePrint = () => {
    if (!previewRef.current) return;
    printLabel(previewRef.current);
  };

  return (
    <>
      <style>{`
        @media print {
          body > * { display: none !important; }
          #label-preview { display: grid !important; }
          @page { margin: 0; size: A4; }
        }
      `}</style>

      <div style={{ display: 'flex', height: 'calc(100vh - 60px)', background: C.bg }}>

        {/* 좌측 폼 패널 */}
        <div style={{
          width: 300, flexShrink: 0, background: '#fff',
          borderRight: `1px solid ${C.border}`, padding: 16, overflowY: 'auto',
        }}>
          <div style={C.section}>
            <div style={C.sectionTitle}>템플릿</div>
            <TemplatePicker
              currentImageUrl={imageUrl}
              currentFields={fields}
              onLoad={setFields}
              onImageLoad={setImageUrl}
            />
          </div>

          <div style={C.section}>
            <div style={C.sectionTitle}>상표 이미지</div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              style={{
                border: '2px dashed #d1d5db', borderRadius: 6, padding: 16,
                textAlign: 'center', cursor: 'pointer', fontSize: 12, color: '#6b7280',
              }}
            >
              {uploading ? '업로드 중...' : imageUrl ? '이미지 변경' : '클릭하여 이미지 선택 (PNG/JPG)'}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
            />
            {imageUrl && (
              <img src={imageUrl} alt="미리보기" style={{ marginTop: 8, maxWidth: '100%', maxHeight: 80, objectFit: 'contain' }} />
            )}
          </div>

          <div style={C.section}>
            <div style={C.sectionTitle}>품질표시 항목</div>
            <QualityFieldsForm fields={fields} onChange={setFields} />
          </div>
        </div>

        {/* 우측 미리보기 + 액션 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
            background: '#fff', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>
              미리보기 — A4 · 99.1×93mm × 6칸
            </span>
            <button style={{ ...BTN_PRIMARY, background: '#6366f1' }} onClick={handlePdf}>
              ⬇ PDF 저장
            </button>
            <button style={{ ...BTN_PRIMARY, background: '#059669' }} onClick={handlePrint}>
              🖨 바로 인쇄
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 20, background: '#e5e7eb', display: 'flex', justifyContent: 'center' }}>
            <LabelPreview ref={previewRef} imageUrl={imageUrl} fields={fields} />
          </div>
        </div>

      </div>
    </>
  );
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/label-editor.test.tsx
```
Expected: PASS (2개 테스트)

- [ ] **Step 5: Commit**

```bash
git add src/components/label/LabelEditor.tsx src/__tests__/components/label-editor.test.tsx
git commit -m "feat(label): LabelEditor 전체 조립 + @media print CSS"
```

---

## Task 11: /label 페이지 + 리스팅 진입점 버튼

**Files:**
- Create: `src/app/label/page.tsx`
- Modify: `src/components/listing/ListingDashboard.tsx`

- [ ] **Step 1: /label 페이지 생성**

`src/app/label/page.tsx`:

```typescript
import { Suspense } from 'react';
import type { Metadata } from 'next';
import LabelEditor from '@/components/label/LabelEditor';

export const metadata: Metadata = {
  title: '라벨 인쇄 | SmartSellerStudio',
  description: '소분 판매용 A4 라벨지를 편집하고 인쇄합니다.',
};

export default function LabelPage() {
  return (
    <Suspense>
      <LabelEditor />
    </Suspense>
  );
}
```

- [ ] **Step 2: 리스팅 헤더에 "🏷 라벨 인쇄" 버튼 추가**

`src/components/listing/ListingDashboard.tsx`에서 `{/* 우측: 1688 가져오기 */}` 블록 바로 위에 다음 버튼을 추가한다:

```tsx
{/* 우측: 라벨 인쇄 */}
<Link
  href={`/label?productName=${encodeURIComponent(draft.name || '')}`}
  style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.btnSecondaryBg,
    color: C.btnSecondaryText,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    marginRight: 6,
  }}
>
  🏷 라벨 인쇄
</Link>
```

- [ ] **Step 3: draft.name 참조 확인**

`useListingStore`의 `draft.name` 필드를 ListingDashboard에서 이미 사용 중인지 확인:

```bash
grep -n "draft\.name\|draft\." src/components/listing/ListingDashboard.tsx | head -5
```

`draft`가 `useListingStore()` 반환값이면 `const { draft } = useListingStore()` 구조분해로 접근 가능. 이미 존재하는 변수를 사용한다. 없으면 `const draft = useListingStore((s) => s.draft)` 추가.

- [ ] **Step 4: 기존 리스팅 탭 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/listing-dashboard-tabs.test.tsx
```
Expected: PASS (기존 3개 테스트 모두)

- [ ] **Step 5: 전체 테스트 실행**

```bash
npx vitest run
```
Expected: 전체 PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/label/page.tsx src/components/listing/ListingDashboard.tsx
git commit -m "feat(label): /label 페이지 추가 + 리스팅 헤더 라벨 인쇄 진입점 버튼"
```

---

## 셀프 리뷰

**스펙 커버리지 체크:**

| 스펙 요구사항 | 구현 Task |
|---|---|
| A4 2×3 라벨 규격 (99.1×93mm, 여백 7/5mm) | Task 7 LabelPreview |
| 왼쪽 열 상표 이미지 × 3 | Task 6 LabelImageCell + Task 7 |
| 오른쪽 열 품질표시 텍스트 × 3 | Task 6 LabelTextCell + Task 7 |
| 앱 통합 (/label 페이지) | Task 11 |
| 템플릿 저장/불러오기 | Task 3, 9 |
| 리스팅 연동 (productName URL 파라미터) | Task 10, 11 |
| 이미지 업로드 → Supabase Storage | Task 4 |
| PDF 저장 (html2pdf.js) | Task 5, 10 |
| 바로 인쇄 (window.print + @media print) | Task 5, 10 |
| label_templates DB 테이블 | Task 2 |

**타입 일관성:**
- `QualityFields`, `LabelTemplate` — Task 3에서 정의, Task 6/7/8/9/10에서 임포트
- `LabelPreview` — `forwardRef<HTMLDivElement, Props>` — Task 10에서 `previewRef`로 접근
- `generatePdf(element: HTMLElement)` / `printLabel(element: HTMLElement)` — Task 5 정의, Task 10 호출

모든 요구사항 커버됨. 플레이스홀더 없음.
