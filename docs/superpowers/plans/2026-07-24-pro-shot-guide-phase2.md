# PRO 촬영 가이드 Phase 2 (저장 & 재개) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** PRO 촬영 가이드 상태를 `detail_page_drafts`에 저장하고, "촬영 진행중" 리스트에서 다시 열어 `shootguide` 화면으로 복귀할 수 있게 한다.

**Architecture:** `detail_page_drafts`에 `shoot_session jsonb` 컬럼(마이그 092) 추가 → draft API에 `shootSession` 저장/조회 + `?list=1` 리스트 모드 → PRO 페이지에 draft 생성/자동저장/재개(`?draftId=`) 배선 + 업로드 화면에 "촬영 진행중" 리스트.

**Tech Stack:** Next.js 16(App Router), TypeScript, Supabase(Postgres), vitest.

> ⚠️ **DB 변경 주의:** Task 1은 사용자의 Supabase DB에 컬럼을 추가하는 마이그레이션이다. 추가(additive)·비파괴적이지만 **원격 DB 스키마 변경이므로, 적용은 사용자 확인/실행 단계로 둔다**(서브에이전트가 자동 적용하지 않음).
> **브랜치:** Phase 1 브랜치 `feat-pro-shot-guide` 위에서 이어서 진행(또는 Phase2 전용 브랜치). 커밋은 targeted-add.
> **테스트:** studio 기본 vitest는 이 환경에서 행 → 순수 로직은 node 임시 config recipe(각 Task 포함). 라우트/UI는 tsc + 브라우저 스모크.

> 확인된 사실: 최신 마이그레이션 091 → 다음 **092**. `DraftUpsertSchema`(`draft/route.ts:12`) `{id?,listingId?,productName?,sections,theme,thumbnailUrl?}`. POST가 `row` 구성(L45~), GET 단건 select(L107)·응답(L118~). GET는 id/listingId 둘 다 없으면 400(L91). `detail_page_drafts`(084): service-role RLS, FK 없음.

---

## Task 1: 마이그레이션 092 — `shoot_session` 컬럼

**Files:**
- Create: `supabase/migrations/092_detail_page_drafts_shoot_session.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**
```sql
-- PRO 촬영 세션 상태(촬영 가이드 + 컷별 업로드 진행)를 담는 jsonb.
-- 084 detail_page_drafts 확장. 추가/비파괴적.
alter table detail_page_drafts
  add column if not exists shoot_session jsonb not null default '{}';
```

- [ ] **Step 2: 커밋**
```bash
git add supabase/migrations/092_detail_page_drafts_shoot_session.sql
git commit -m "feat(db): detail_page_drafts.shoot_session 컬럼 (092)"
```

- [ ] **Step 3: DB 적용 (사용자 확인/실행 — 서브에이전트 자동실행 금지)**
아래 중 하나로 적용하고 결과를 확인한다:
- Supabase CLI(연결됨): `npx supabase db push` (로컬 마이그레이션을 연결된 프로젝트에 적용)
- 또는 Supabase 대시보드 SQL 에디터에 Step 1 SQL 실행
검증:
```sql
select column_name, data_type from information_schema.columns
where table_name = 'detail_page_drafts' and column_name = 'shoot_session';
```
Expected: `shoot_session | jsonb` 한 행. (적용 전엔 이후 Task의 저장/조회가 실패하므로 반드시 선행.)

---

## Task 2: draft API — `shootSession` 저장/조회 + `?list=1` 리스트 + 순수 요약 로직

**Files:**
- Create: `src/lib/detail-page/shoot-draft.ts` (순수 요약 로직)
- Test: `src/lib/detail-page/shoot-draft.test.ts`
- Modify: `src/app/api/detail-page/draft/route.ts`

- [ ] **Step 1: 실패 테스트 — `src/lib/detail-page/shoot-draft.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { deriveShootDraftSummary } from './shoot-draft';

describe('deriveShootDraftSummary', () => {
  it('행에서 리스트용 요약(step·shotCount)을 파생한다', () => {
    const row = {
      id: 'abc', product_name: '보넬라 차렵이불', updated_at: '2026-07-24T00:00:00Z',
      shoot_session: { step: 'guide', shotGuide: [{ subject: 'a' }, { subject: 'b' }] },
    };
    expect(deriveShootDraftSummary(row)).toEqual({
      id: 'abc', productName: '보넬라 차렵이불', updatedAt: '2026-07-24T00:00:00Z',
      step: 'guide', shotCount: 2,
    });
  });
  it('shoot_session이 비었거나 shotGuide가 없어도 안전하다', () => {
    const row = { id: 'x', product_name: null, updated_at: 't', shoot_session: {} };
    expect(deriveShootDraftSummary(row)).toEqual({ id: 'x', productName: null, updatedAt: 't', step: null, shotCount: 0 });
  });
});
```

- [ ] **Step 2: FAIL 확인 (node 임시 config)**
```bash
cat > vitest.scratch.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node', setupFiles: [], pool: 'threads', globals: true,
    include: ['src/lib/detail-page/shoot-draft.test.ts'] },
});
EOF
timeout 90 npx vitest run --config vitest.scratch.config.ts; echo "EXIT=$?"
rm -f vitest.scratch.config.ts
```
Expected: FAIL — cannot resolve `./shoot-draft`.

- [ ] **Step 3: 순수 로직 — `src/lib/detail-page/shoot-draft.ts`**
```ts
export interface ShootDraftSummary {
  id: string;
  productName: string | null;
  updatedAt: string;
  step: string | null;
  shotCount: number;
}

/** detail_page_drafts 행 → "촬영 진행중" 리스트 항목 요약. */
export function deriveShootDraftSummary(row: {
  id: string;
  product_name?: string | null;
  updated_at: string;
  shoot_session?: unknown;
}): ShootDraftSummary {
  const ss = (row.shoot_session ?? {}) as { step?: unknown; shotGuide?: unknown };
  const shotCount = Array.isArray(ss.shotGuide) ? ss.shotGuide.length : 0;
  const step = typeof ss.step === 'string' ? ss.step : null;
  return {
    id: row.id,
    productName: row.product_name ?? null,
    updatedAt: row.updated_at,
    step,
    shotCount,
  };
}
```

- [ ] **Step 4: PASS 확인** (Step 2 recipe 재사용). Expected: 2 passed.

- [ ] **Step 5: 커밋(순수 로직)**
```bash
git add src/lib/detail-page/shoot-draft.ts src/lib/detail-page/shoot-draft.test.ts
git commit -m "feat(shoot-draft): 촬영 초안 리스트 요약 파생 로직"
```

- [ ] **Step 6: 라우트 확장 — `src/app/api/detail-page/draft/route.ts`**
파일을 읽고 아래를 적용:

(a) 상단 import 추가: `import { deriveShootDraftSummary } from '@/lib/detail-page/shoot-draft';`

(b) `DraftUpsertSchema`(L12)에 필드 추가:
```ts
shootSession: z.record(z.string(), z.unknown()).optional(),
```

(c) POST 구조분해(L37)에 `shootSession` 추가하고, `row` 구성 직후 조건부로 컬럼 세팅(미전달 시 기존값 보존):
```ts
const { id, listingId, productName, sections, theme, thumbnailUrl, shootSession } = parsed.data;
// ... 기존 row 구성 ...
if (shootSession !== undefined) {
  (row as Record<string, unknown>).shoot_session = shootSession;
}
```

(d) GET 단건 select(L107)에 `shoot_session` 추가하고, 응답(L118 draft 객체)에 `shootSession: d.shoot_session` 추가.

(e) **리스트 모드**: GET 함수에서 `const { searchParams } = new URL(...)` 직후, `if (!id && !listingId)` 400 분기 **앞에** 추가:
```ts
if (searchParams.get('list')) {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('detail_page_drafts')
      .select('id, product_name, updated_at, shoot_session')
      .eq('user_id', userId)
      .not('shoot_session->>step', 'is', null)   // 촬영 세션이 시작된 초안만
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const drafts = (data ?? []).map((r) => deriveShootDraftSummary(r as never));
    return Response.json({ success: true, drafts });
  } catch (err) {
    console.error('[GET /api/detail-page/draft?list]', err);
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 7: 타입체크**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-page/draft|shoot-draft" || echo "no type errors in touched files"
```
Expected: `no type errors in touched files`.

- [ ] **Step 8: 커밋(라우트)**
```bash
git add src/app/api/detail-page/draft/route.ts
git commit -m "feat(draft): shootSession 저장/조회 + ?list=1 촬영 초안 리스트"
```

---

## Task 3: PRO 페이지 — 저장/자동저장/재개 배선

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`

먼저 파일을 읽고 확인: `useSearchParams`/router import 여부, `handleShotGuide`(Phase1에서 추가됨), 상태 선언부, `generatedSections`/`productName`/`productPoints` 이름.

- [ ] **Step 1: 상태 + import 추가**
```ts
// 이미 next/navigation 사용 중이면 재사용
import { useSearchParams } from 'next/navigation';
```
```ts
const [draftId, setDraftId] = useState<string | null>(null);
```

- [ ] **Step 2: 저장 유틸 추가**
```ts
async function saveShootDraft(nextId: string | null) {
  const res = await fetch('/api/detail-page/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: nextId ?? undefined,
      productName,
      sections: generatedSections,
      theme: {},
      shootSession: { shotGuide: shotGuide ?? [], step: 'guide' },
    }),
  });
  const json = await res.json();
  if (json?.id) return json.id as string;
  return nextId;
}
```

- [ ] **Step 3: `handleShotGuide` 성공부에 저장 연결**
`setShotGuide(...)`/`setScreen('shootguide')` 직후:
```ts
try {
  const id = await saveShootDraft(draftId);
  if (id) {
    setDraftId(id);
    // URL에 draftId 반영(shallow) — 새로고침/재접속 복원용
    const url = new URL(window.location.href);
    url.searchParams.set('draftId', id);
    window.history.replaceState(null, '', url.toString());
  }
} catch { /* 저장 실패는 조용히 무시(가이드 표시는 유지) */ }
```

- [ ] **Step 4: 자동저장(디바운스)** — `shotGuide`/`draftId` 변화 시 1.5s 후 재저장
```ts
useEffect(() => {
  if (!draftId || !shotGuide) return;
  const t = setTimeout(() => { saveShootDraft(draftId).catch(() => {}); }, 1500);
  return () => clearTimeout(t);
}, [draftId, shotGuide]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 5: 재개(mount)** — `?draftId=` 있으면 복원
```ts
const searchParams = useSearchParams();
useEffect(() => {
  const rid = searchParams.get('draftId');
  if (!rid) return;
  (async () => {
    try {
      const res = await fetch(`/api/detail-page/draft?id=${rid}`);
      const json = await res.json();
      const d = json?.draft;
      if (!d) return;
      setDraftId(d.id);
      if (d.productName) setProductName(d.productName);
      if (Array.isArray(d.sections)) setGeneratedSections(d.sections);
      const sg = d.shootSession?.shotGuide;
      if (Array.isArray(sg)) setShotGuide(sg);
      setScreen('shootguide');
    } catch { /* 무시 */ }
  })();
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```
> 상태 setter 실제 이름(`setGeneratedSections`/`setProductName` 등)을 파일에서 확인해 일치시킬 것. 없으면 해당 필드 복원은 생략하고 concern으로 보고.

- [ ] **Step 6: 타입체크**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-maker-pro/page" || echo "no type errors in touched file"
```
Expected: `no type errors in touched file`.

- [ ] **Step 7: 커밋**
```bash
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(shot-guide): PRO 촬영 초안 저장/자동저장/재개(?draftId) 배선"
```

---

## Task 4: "촬영 진행중" 리스트 UI (업로드 화면)

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`

- [ ] **Step 1: 리스트 상태 + fetch**
```ts
const [shootDrafts, setShootDrafts] = useState<Array<{ id: string; productName: string | null; updatedAt: string; step: string | null; shotCount: number }>>([]);

useEffect(() => {
  (async () => {
    try {
      const res = await fetch('/api/detail-page/draft?list=1');
      const json = await res.json();
      if (json?.success && Array.isArray(json.drafts)) setShootDrafts(json.drafts);
    } catch { /* 무시 */ }
  })();
}, []);
```

- [ ] **Step 2: 업로드 화면 상단에 리스트 렌더**
`upload` 화면 return JSX 상단(제목 아래)에, `shootDrafts.length > 0`일 때만:
```tsx
{shootDrafts.length > 0 && (
  <div style={{ marginBottom: 16, padding: 12, border: '1px solid #2a2a3a', borderRadius: 8 }}>
    <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>이어서 진행할 촬영</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {shootDrafts.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set('draftId', d.id);
            window.location.href = url.toString();
          }}
          style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: '1px solid #2a2a3a', background: 'transparent', color: '#e2e8f0', cursor: 'pointer' }}
        >
          {d.productName || '(제목 없음)'} · 컷 {d.shotCount}개 · {new Date(d.updatedAt).toLocaleDateString('ko-KR')}
        </button>
      ))}
    </div>
  </div>
)}
```
> 스타일은 페이지의 기존 인라인 다크테마 톤에 맞춤(주변 요소 색값 참고). `?draftId=`로 이동하면 Task 3의 재개 경로가 복원한다.

- [ ] **Step 3: 타입체크**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-maker-pro/page" || echo "no type errors in touched file"
```
Expected: `no type errors in touched file`.

- [ ] **Step 4: 커밋**
```bash
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(shot-guide): 업로드 화면에 '촬영 진행중' 리스트"
```

---

## Task 5: 통합 검증

- [ ] **Step 1: 순수 로직 테스트**
```bash
cat > vitest.scratch.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node', setupFiles: [], pool: 'threads', globals: true,
    include: ['src/lib/detail-page/shoot-draft.test.ts'] },
});
EOF
timeout 90 npx vitest run --config vitest.scratch.config.ts; echo "EXIT=$?"
rm -f vitest.scratch.config.ts
```
Expected: 2 passed.

- [ ] **Step 2: 브라우저 스모크 (마이그레이션 적용 완료 전제)**
dev 서버에서:
1. PRO 흐름으로 레이아웃 생성 → "📸 촬영 가이드 만들기" → `shootguide` 화면. URL이 `?draftId=…`로 바뀌는지.
2. 페이지 **새로고침** → 같은 가이드가 복원되고 `shootguide`로 착지하는지.
3. PRO 업로드 화면(`/listing/new/detail-maker-pro`) 재진입 → 상단 **"이어서 진행할 촬영"** 리스트에 방금 초안이 뜨는지 → 클릭 시 복귀하는지.
4. (네트워크 탭) POST `/api/detail-page/draft` 201/200, GET `?list=1`·`?id=` 200 확인.

---

## 참고
- Phase 2는 저장/재개까지. 컷별 실사진 업로드는 Phase 3, 보정·삽입은 Phase 4.
- `shoot_session` 스키마: `{ shotGuide: ShotCard[], step: 'guide' }`. Phase 3에서 `slots:[{sectionIndex, slotIndex, subject, status, assetUrl}]` 추가 예정.
- 마이그레이션(Task 1 Step 3)은 반드시 DB에 적용돼야 이후 저장/조회가 동작.
