# 내 상품 조회 — 소싱 출처 기능 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 상품 조회(BrowseMode)의 쿠팡/네이버 상품 테이블에 소싱 출처(온라인 URL 또는 오프라인 매장명)를 입력·저장·표시하는 기능을 추가한다.

**Architecture:** Render PostgreSQL(`SOURCING_DATABASE_URL`)에 `product_sourcing` 테이블을 신규 생성하고, Next.js API Route(`/api/listing/sourcing`)로 GET/PUT/DELETE를 처리한다. Zustand `useListingStore`에 `sourcingMap` 상태와 액션을 추가하고, `BrowseMode`에 `SourcingBadge`와 `SourcingPopover` 컴포넌트를 인라인으로 구현한다.

**Tech Stack:** Next.js App Router, `pg` (node-postgres), Zustand, React inline styles, Vitest

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/app/api/listing/sourcing/route.ts` | **신규** — GET(배치조회) / PUT(upsert) / DELETE(삭제) |
| `src/__tests__/api/listing-sourcing.test.ts` | **신규** — API route 단위 테스트 |
| `src/store/useListingStore.ts` | **수정** — `sourcingMap` 상태 + 3개 액션 추가 |
| `src/components/listing/browse/BrowseMode.tsx` | **수정** — 소싱 출처 열 + `SourcingBadge` + `SourcingPopover` |

---

## Task 1: Render DB 테이블 생성

**Files:**
- (DB 직접 실행 — 파일 변경 없음)

- [ ] **Step 1: psql로 Render DB에 접속해 테이블 생성**

`.env.local`의 `SOURCING_DATABASE_URL` 값을 사용한다.

```bash
psql $SOURCING_DATABASE_URL -c "
CREATE TABLE IF NOT EXISTS product_sourcing (
  id            SERIAL PRIMARY KEY,
  platform      TEXT NOT NULL CHECK (platform IN ('coupang', 'naver')),
  product_id    TEXT NOT NULL,
  sourcing_type TEXT NOT NULL CHECK (sourcing_type IN ('online', 'offline')),
  sourcing_value TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, product_id)
);
"
```

- [ ] **Step 2: 테이블 생성 확인**

```bash
psql $SOURCING_DATABASE_URL -c "\d product_sourcing"
```

기대 출력: 컬럼 목록 (id, platform, product_id, sourcing_type, sourcing_value, created_at, updated_at) 표시

---

## Task 2: API Route 구현 (TDD)

**Files:**
- Create: `src/__tests__/api/listing-sourcing.test.ts`
- Create: `src/app/api/listing/sourcing/route.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/__tests__/api/listing-sourcing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

import { GET, PUT, DELETE } from '@/app/api/listing/sourcing/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

// ── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/listing/sourcing', () => {
  it('ids가 없으면 빈 sourcing 반환', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing?platform=coupang&ids=');
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.sourcing).toEqual({});
  });

  it('ids 배치 조회 후 map 반환', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { product_id: '111', sourcing_type: 'online', sourcing_value: 'https://1688.com/x' },
        { product_id: '222', sourcing_type: 'offline', sourcing_value: '코스트코' },
      ],
    });
    const req = new NextRequest('http://localhost/api/listing/sourcing?platform=coupang&ids=111,222');
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.sourcing).toEqual({
      '111': { type: 'online', value: 'https://1688.com/x' },
      '222': { type: 'offline', value: '코스트코' },
    });
  });
});

// ── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /api/listing/sourcing', () => {
  it('value가 빈 문자열이면 400', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({ platform: 'coupang', productId: '111', type: 'online', value: '' }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('정상 upsert → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({ platform: 'coupang', productId: '111', type: 'online', value: 'https://1688.com/x' }),
    });
    const res = await PUT(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO product_sourcing'),
      ['coupang', '111', 'online', 'https://1688.com/x'],
    );
  });
});

// ── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/listing/sourcing', () => {
  it('정상 삭제 → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'DELETE',
      body: JSON.stringify({ platform: 'coupang', productId: '111' }),
    });
    const res = await DELETE(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM product_sourcing'),
      ['coupang', '111'],
    );
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/__tests__/api/listing-sourcing.test.ts
```

기대 출력: `Cannot find module '@/app/api/listing/sourcing/route'` 오류로 실패

- [ ] **Step 3: API Route 구현**

`src/app/api/listing/sourcing/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { requireAuth } from '@/lib/supabase/auth';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const sp = request.nextUrl.searchParams;
  const platform = sp.get('platform') ?? '';
  const idsRaw = sp.get('ids') ?? '';
  const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);

  if (ids.length === 0) {
    return Response.json({ sourcing: {} });
  }

  const pool = getSourcingPool();
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
  const result = await pool.query(
    `SELECT product_id, sourcing_type, sourcing_value
     FROM product_sourcing
     WHERE platform = $1 AND product_id IN (${placeholders})`,
    [platform, ...ids],
  );

  const sourcing: Record<string, { type: string; value: string }> = {};
  for (const row of result.rows) {
    sourcing[row.product_id] = { type: row.sourcing_type, value: row.sourcing_value };
  }

  return Response.json({ sourcing });
}

export async function PUT(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { platform, productId, type, value } = body as {
    platform: string;
    productId: string;
    type: string;
    value: string;
  };

  if (!value?.trim()) {
    return Response.json({ success: false, error: '값이 비어 있습니다.' }, { status: 400 });
  }

  const pool = getSourcingPool();
  await pool.query(
    `INSERT INTO product_sourcing (platform, product_id, sourcing_type, sourcing_value, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (platform, product_id)
     DO UPDATE SET sourcing_type = $3, sourcing_value = $4, updated_at = NOW()`,
    [platform, productId, type, value],
  );

  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { platform, productId } = body as { platform: string; productId: string };

  const pool = getSourcingPool();
  await pool.query(
    `DELETE FROM product_sourcing WHERE platform = $1 AND product_id = $2`,
    [platform, productId],
  );

  return Response.json({ success: true });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/listing-sourcing.test.ts
```

기대 출력: 6개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/__tests__/api/listing-sourcing.test.ts src/app/api/listing/sourcing/route.ts
git commit -m "feat(sourcing): 소싱 출처 API route 추가 (GET/PUT/DELETE)"
```

---

## Task 3: useListingStore 소싱 상태·액션 추가

**Files:**
- Modify: `src/store/useListingStore.ts`

- [ ] **Step 1: ListingStore 인터페이스에 타입과 선언 추가**

`src/store/useListingStore.ts`의 `interface ListingStore` 블록 안, `clearError` 선언 바로 아래에 추가:

```ts
  // ─── 소싱 출처 ──────────────────────────────────────────────────────────────
  sourcingMap: Record<string, { type: 'online' | 'offline'; value: string } | null>;
  fetchSourcing: (platform: 'coupang' | 'naver', ids: string[]) => Promise<void>;
  saveSourcing: (platform: 'coupang' | 'naver', productId: string, type: 'online' | 'offline', value: string) => Promise<boolean>;
  deleteSourcing: (platform: 'coupang' | 'naver', productId: string) => Promise<boolean>;
```

- [ ] **Step 2: 초기 상태에 sourcingMap 추가**

`create(...)` 호출 내부의 초기값 블록(browsePlatform, browseFilters 등이 있는 곳) 바로 아래에 추가:

```ts
      sourcingMap: {},
```

- [ ] **Step 3: 액션 구현 추가**

`clearError` 액션 구현 바로 아래에 추가:

```ts
      // ─── 소싱 출처 액션 ─────────────────────────────────────────────────────
      fetchSourcing: async (platform, ids) => {
        if (ids.length === 0) return;
        try {
          const res = await fetch(
            `/api/listing/sourcing?platform=${platform}&ids=${ids.join(',')}`,
          );
          const json = await res.json();
          if (!res.ok) return;
          set((s) => ({
            sourcingMap: { ...s.sourcingMap, ...Object.fromEntries(
              Object.entries(json.sourcing as Record<string, { type: 'online' | 'offline'; value: string }>).map(
                ([id, val]) => [`${platform}:${id}`, val],
              ),
            )},
          }), false, 'listing/fetchSourcing');
        } catch {
          // 소싱 조회 실패는 조용히 무시
        }
      },

      saveSourcing: async (platform, productId, type, value) => {
        const key = `${platform}:${productId}`;
        const prev = get().sourcingMap[key] ?? null;
        // optimistic update
        set((s) => ({ sourcingMap: { ...s.sourcingMap, [key]: { type, value } } }), false, 'listing/saveSourcing/optimistic');
        try {
          const res = await fetch('/api/listing/sourcing', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform, productId, type, value }),
          });
          if (!res.ok) throw new Error('저장 실패');
          return true;
        } catch {
          // 롤백
          set((s) => ({ sourcingMap: { ...s.sourcingMap, [key]: prev } }), false, 'listing/saveSourcing/rollback');
          return false;
        }
      },

      deleteSourcing: async (platform, productId) => {
        const key = `${platform}:${productId}`;
        const prev = get().sourcingMap[key] ?? null;
        // optimistic update
        set((s) => ({ sourcingMap: { ...s.sourcingMap, [key]: null } }), false, 'listing/deleteSourcing/optimistic');
        try {
          const res = await fetch('/api/listing/sourcing', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform, productId }),
          });
          if (!res.ok) throw new Error('삭제 실패');
          return true;
        } catch {
          // 롤백
          set((s) => ({ sourcingMap: { ...s.sourcingMap, [key]: prev } }), false, 'listing/deleteSourcing/rollback');
          return false;
        }
      },
```

- [ ] **Step 4: fetchCoupangProducts 성공 후 fetchSourcing 호출**

`fetchCoupangProducts` 액션의 성공 블록(`set({ coupangProducts: ..., ... })` 바로 뒤)에 추가:

```ts
          // 소싱 출처 배치 조회
          const newIds = items.map((p: CoupangProduct) => String(p.sellerProductId));
          if (newIds.length > 0) get().fetchSourcing('coupang', newIds);
```

- [ ] **Step 5: fetchNaverProducts 성공 후 fetchSourcing 호출**

`fetchNaverProducts` 액션의 `set({ naverProducts: ... })` 바로 뒤에 추가:

```ts
          // 소싱 출처 배치 조회
          const newIds = (json.data?.items ?? []).map((p: NaverProduct) => String(p.originProductNo));
          if (newIds.length > 0) get().fetchSourcing('naver', newIds);
```

- [ ] **Step 6: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

기대 출력: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add src/store/useListingStore.ts
git commit -m "feat(sourcing): useListingStore에 sourcingMap 상태 및 액션 추가"
```

---

## Task 4: BrowseMode UI — 소싱 출처 열 추가

**Files:**
- Modify: `src/components/listing/browse/BrowseMode.tsx`

### 헬퍼 함수 및 컴포넌트 추가

- [ ] **Step 1: URL → 플랫폼 라벨 추출 함수 추가**

`BrowseMode.tsx` 상단, `function StatusBadge(...)` 위에 추가:

```ts
// ─── 소싱 출처 유틸 ───────────────────────────────────────────────────────────
function getOnlineLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes('1688.com')) return '1688';
    if (host.includes('domeggook.com')) return '도매꾹';
    if (host.includes('costco.co.kr')) return '코스트코 온라인';
    return host.replace(/^www\./, '').split('.')[0];
  } catch {
    return 'URL';
  }
}

const ONLINE_CHIPS: { label: string; prefix: string }[] = [
  { label: '1688', prefix: 'https://detail.1688.com/offer/' },
  { label: '도매꾹', prefix: 'https://domeggook.com/' },
  { label: '코스트코 온라인', prefix: 'https://www.costco.co.kr/' },
];

const OFFLINE_CHIPS = ['코스트코'];
```

- [ ] **Step 2: SourcingPopover 컴포넌트 추가**

`getOnlineLabel` 바로 아래에 추가:

```ts
interface SourcingPopoverProps {
  platform: 'coupang' | 'naver';
  productId: string;
  current: { type: 'online' | 'offline'; value: string } | null;
  onClose: () => void;
}

function SourcingPopover({ platform, productId, current, onClose }: SourcingPopoverProps) {
  const { saveSourcing, deleteSourcing } = useListingStore();
  const [tab, setTab] = React.useState<'online' | 'offline'>(current?.type ?? 'online');
  const [inputValue, setInputValue] = React.useState(current?.type === tab ? current.value : '');
  const [saving, setSaving] = React.useState(false);

  // 탭 전환 시 입력값 초기화
  const handleTabChange = (t: 'online' | 'offline') => {
    setTab(t);
    setInputValue(current?.type === t ? current.value : '');
  };

  const handleSave = async () => {
    if (!inputValue.trim()) return;
    setSaving(true);
    const ok = await saveSourcing(platform, productId, tab, inputValue.trim());
    setSaving(false);
    if (ok) onClose();
  };

  const handleDelete = async () => {
    setSaving(true);
    await deleteSourcing(platform, productId);
    setSaving(false);
    onClose();
  };

  return (
    <>
      {/* 오버레이 — 외부 클릭 감지 */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onClick={onClose}
      />
      {/* 팝오버 카드 */}
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 1000,
          marginTop: '6px',
          width: '300px',
          backgroundColor: '#fff',
          border: `1px solid ${C.border}`,
          borderRadius: '10px',
          padding: '16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '12px' }}>
          📦 소싱 출처
        </div>

        {/* 탭 토글 */}
        <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '14px' }}>
          {(['online', 'offline'] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              style={{
                flex: 1,
                padding: '7px 0',
                fontSize: '12px',
                fontWeight: tab === t ? 700 : 500,
                background: tab === t ? C.accent : '#f9f9f9',
                color: tab === t ? '#fff' : C.textSub,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {t === 'online' ? '🌐 온라인 URL' : '🏪 오프라인 매장'}
            </button>
          ))}
        </div>

        {/* 입력 영역 */}
        <label style={{ fontSize: '11px', fontWeight: 600, color: C.textSub, display: 'block', marginBottom: '5px' }}>
          {tab === 'online' ? '소싱 URL' : '매장명'}
        </label>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={tab === 'online' ? 'https://detail.1688.com/...' : '예: 코스트코'}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '7px 10px',
            border: `1px solid ${C.accent}`,
            borderRadius: '6px',
            fontSize: '12px',
            outline: 'none',
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          autoFocus
        />

        {/* 빠른 선택 칩 */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '8px' }}>
          {tab === 'online'
            ? ONLINE_CHIPS.map((chip) => (
                <span
                  key={chip.label}
                  onClick={() => setInputValue(chip.prefix)}
                  style={{
                    padding: '3px 9px',
                    border: `1px solid ${C.border}`,
                    borderRadius: '100px',
                    fontSize: '11px',
                    color: C.textSub,
                    cursor: 'pointer',
                    backgroundColor: '#f9f9f9',
                  }}
                >
                  {chip.label}
                </span>
              ))
            : OFFLINE_CHIPS.map((chip) => (
                <span
                  key={chip}
                  onClick={() => setInputValue(chip)}
                  style={{
                    padding: '3px 9px',
                    border: `1px solid ${C.border}`,
                    borderRadius: '100px',
                    fontSize: '11px',
                    color: C.textSub,
                    cursor: 'pointer',
                    backgroundColor: '#f9f9f9',
                  }}
                >
                  {chip}
                </span>
              ))
          }
        </div>

        {/* 버튼 행 */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end', alignItems: 'center' }}>
          {current && (
            <button
              onClick={handleDelete}
              disabled={saving}
              style={{
                marginRight: 'auto',
                padding: '5px 12px',
                fontSize: '12px',
                background: 'none',
                color: '#ef4444',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              삭제
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              background: C.btnSecondaryBg,
              color: C.btnSecondaryText,
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !inputValue.trim()}
            style={{
              padding: '6px 16px',
              fontSize: '12px',
              background: saving || !inputValue.trim() ? 'rgba(190,0,20,0.4)' : C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              cursor: saving || !inputValue.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: SourcingBadge 컴포넌트 추가**

`SourcingPopover` 바로 아래에 추가:

```ts
interface SourcingBadgeProps {
  platform: 'coupang' | 'naver';
  productId: string;
}

function SourcingBadge({ platform, productId }: SourcingBadgeProps) {
  const { sourcingMap } = useListingStore();
  const [open, setOpen] = React.useState(false);
  const key = `${platform}:${productId}`;
  const sourcing = sourcingMap[key] ?? null;

  const badgeStyle: React.CSSProperties = sourcing
    ? sourcing.type === 'online'
      ? { background: '#e0f2fe', color: '#0369a1' }
      : { background: '#f0fdf4', color: '#15803d' }
    : { background: '#f9f9f9', color: '#aaa', border: '1px dashed #ddd' };

  const badgeLabel = sourcing
    ? sourcing.type === 'online'
      ? `🌐 ${getOnlineLabel(sourcing.value)}`
      : `🏪 ${sourcing.value}`
    : '＋ 소싱 출처';

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <span
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 9px',
          borderRadius: '100px',
          fontSize: '11px',
          fontWeight: sourcing ? 700 : 400,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          ...badgeStyle,
        }}
      >
        {badgeLabel}
      </span>
      {open && (
        <SourcingPopover
          platform={platform}
          productId={productId}
          current={sourcing}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: `BrowseMode.tsx` 상단에 React import 확인 및 추가**

파일 최상단의 import 블록을 확인한다. `import { useEffect, useState } from 'react';` 에 `React`가 없으면 수정:

```ts
import React, { useEffect, useState } from 'react';
```

- [ ] **Step 5: CoupangBrowser 테이블 헤더에 "소싱 출처" 열 추가**

`CoupangBrowser` 함수 내 `thead` 부분의 컬럼 배열을 수정:

```ts
// 변경 전
{['상품ID', '상품명', '브랜드', '상태', '카테고리', '등록일', ''].map((col) => (

// 변경 후
{['상품ID', '상품명', '브랜드', '상태', '카테고리', '등록일', '소싱 출처', ''].map((col) => (
```

- [ ] **Step 6: CoupangBrowser 테이블 행에 소싱 출처 셀 추가**

`filtered.map((pr) => { ... })` 내부 `<tr>` 안, 수정 버튼 `<td>` 바로 앞에 추가:

```tsx
                    <td style={{ padding: '11px 12px' }}>
                      <SourcingBadge platform="coupang" productId={String(pr.sellerProductId)} />
                    </td>
```

- [ ] **Step 7: NaverBrowser 테이블 헤더에 "소싱 출처" 열 추가**

`NaverBrowser` 함수 내 `thead` 컬럼 배열 수정:

```ts
// 변경 전
{['이미지', '상품명', '상태', '판매가', '재고', '카테고리', '등록일', ''].map((col) => (

// 변경 후
{['이미지', '상품명', '상태', '판매가', '재고', '카테고리', '등록일', '소싱 출처', ''].map((col) => (
```

- [ ] **Step 8: NaverBrowser 테이블 행에 소싱 출처 셀 추가**

`NaverBrowser`의 `filtered.map((p) => { ... })` 내부 `<tr>` 안, 수정 버튼 `<td>` 바로 앞에 추가:

```tsx
                    <td style={{ padding: '11px 12px' }}>
                      <SourcingBadge platform="naver" productId={String(p.originProductNo)} />
                    </td>
```

- [ ] **Step 9: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

기대 출력: 오류 없음

- [ ] **Step 10: 개발 서버에서 동작 확인**

```bash
npm run dev
```

1. `/listing` 페이지 접속 → "내 상품 조회" 탭 클릭
2. 쿠팡 탭: 상품 목록 로드 후 "소싱 출처" 열 표시 확인
3. `＋ 소싱 출처` 뱃지 클릭 → 팝오버 열림 확인
4. 온라인 탭: URL 입력 → "1688" 칩 클릭 → prefix 채워짐 확인
5. 저장 → 뱃지가 `🌐 1688`로 변경 확인
6. 뱃지 재클릭 → 오프라인 탭 전환 → "코스트코" 칩 클릭 → 저장 → `🏪 코스트코` 확인
7. 뱃지 재클릭 → 삭제 → `＋ 소싱 출처`로 복귀 확인
8. 네이버 탭에서도 동일 동작 확인

- [ ] **Step 11: 커밋**

```bash
git add src/components/listing/browse/BrowseMode.tsx
git commit -m "feat(sourcing): BrowseMode에 소싱 출처 열 및 팝오버 UI 추가"
```
