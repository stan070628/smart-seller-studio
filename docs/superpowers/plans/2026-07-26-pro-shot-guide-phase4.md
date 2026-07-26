# PRO 촬영 가이드 Phase 4 (실사진 AI 보정) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 업로드한 detail_closeup 실사진을 Sharp로 가볍게 보정(밝기·채도·선명도)하는 별도 엔드포인트를 만들고, 카드별 "AI 보정" 버튼으로 before/after 후 적용하면 그 보정본을 슬롯에 저장·apply 시 사용한다.

**Architecture:** 신규 `/api/ai/retouch-photo`(Sharp만) + `ShootSlot.retouchedUrl` + apply override를 `resolveSlotUrl(retouchedUrl ?? uploadedUrl)`로. 병렬 세션 코드(generate-scene-image·워터마크·upload) 미변경, page.tsx는 소폭 추가.

**Tech Stack:** Next.js, TS, Sharp, Supabase Storage, vitest.

> ⚠️ **격리:** 브랜치 `feat-pro-shot-retouch`(이미 생성됨, HEAD `a7eb5192` 기준). 병렬 세션이 쓰는 파일 수정 금지(신규 파일 위주, page.tsx 최소). 기본 vitest 행 → 순수 테스트는 node 임시 config. TARGETED `git add`.

> 확인된 사실: `ShootSlot`(`src/types/shot-guide.ts:18`) `{sectionIndex,slotIndex,uploadedUrl}`. apply override(`page.tsx:1188-1195`): `const realBySection={}; for(const sl of slots){ if(!sl.uploadedUrl)continue; const sec=generatedSections[sl.sectionIndex]; const genSlotIdx=(sec?.imageSlots??[]).findIndex(x=>x.slotType==='flux_lifestyle'||x.slotType==='detail_closeup'); if(genSlotIdx===sl.slotIndex) realBySection[sl.sectionIndex]=sl.uploadedUrl; }`. import(`page.tsx:8-9`) `{extractDetailCloseupShots, serializeShotChecklist, countUploaded}` + `type {ShotCard, ShootSlot}`. `uploadToStorage(path, ArrayBuffer, mime, size):{url}`(`src/lib/supabase/server.ts:75`). SSRF 패턴은 `cleanup-product-image/route.ts` 참조. 카드 렌더/`handleSlotUpload`는 `page.tsx:385, ~980-1005`.

---

## Task 1: 타입 + `resolveSlotUrl` + 테스트

**Files:** Modify `src/types/shot-guide.ts`, `src/lib/detail-page/shot-guide.ts`, `src/lib/detail-page/shot-guide.test.ts`

- [ ] **Step 1: 실패 테스트 추가** — `shot-guide.test.ts` 하단에:
```ts
import { resolveSlotUrl } from './shot-guide';
describe('resolveSlotUrl', () => {
  it('보정본이 있으면 보정본을 반환', () => {
    expect(resolveSlotUrl({ sectionIndex:0, slotIndex:0, uploadedUrl:'raw', retouchedUrl:'ret' })).toBe('ret');
  });
  it('보정본이 없으면 원본', () => {
    expect(resolveSlotUrl({ sectionIndex:0, slotIndex:0, uploadedUrl:'raw' })).toBe('raw');
    expect(resolveSlotUrl({ sectionIndex:0, slotIndex:0, uploadedUrl:'raw', retouchedUrl:null })).toBe('raw');
  });
  it('둘 다 없으면 null', () => {
    expect(resolveSlotUrl({ sectionIndex:0, slotIndex:0, uploadedUrl:null })).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL 확인** (node 임시 config, include `src/lib/detail-page/shot-guide.test.ts`)
```bash
cat > vitest.scratch.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({ resolve:{alias:{'@':path.resolve(__dirname,'./src')}},
  test:{environment:'node',setupFiles:[],pool:'threads',globals:true,include:['src/lib/detail-page/shot-guide.test.ts']} });
EOF
timeout 90 npx vitest run --config vitest.scratch.config.ts; echo "EXIT=$?"; rm -f vitest.scratch.config.ts
```
Expected: FAIL (`resolveSlotUrl` 없음).

- [ ] **Step 3: 타입 확장** — `src/types/shot-guide.ts`의 `ShootSlot`에 필드 추가:
```ts
export interface ShootSlot {
  sectionIndex: number;
  slotIndex: number;
  uploadedUrl: string | null;
  retouchedUrl?: string | null; // Phase 4: 보정본 URL
}
```

- [ ] **Step 4: `resolveSlotUrl` 추가** — `src/lib/detail-page/shot-guide.ts` 하단(기존 export 유지):
```ts
import type { ShootSlot } from '@/types/shot-guide'; // 이미 import돼 있으면 생략
export function resolveSlotUrl(slot: ShootSlot): string | null {
  return slot?.retouchedUrl ?? slot?.uploadedUrl ?? null;
}
```
(파일 상단 import에 `ShootSlot`가 이미 있으면 새 import 줄은 넣지 말 것.)

- [ ] **Step 5: PASS 확인**(Step 2 recipe 재사용). Expected: 통과.

- [ ] **Step 6: 커밋**
```bash
git add src/types/shot-guide.ts src/lib/detail-page/shot-guide.ts src/lib/detail-page/shot-guide.test.ts
git commit -m "feat(shot-guide): ShootSlot.retouchedUrl + resolveSlotUrl"
```

---

## Task 2: `POST /api/ai/retouch-photo` (Sharp 보정)

**Files:** Create `src/app/api/ai/retouch-photo/route.ts`

- [ ] **Step 1: 라우트 작성** — 전체 내용:
```ts
/**
 * POST /api/ai/retouch-photo
 * 업로드된 실사진을 Sharp로 가볍게 보정(밝기·채도·선명도) 후 Storage에 저장, URL 반환.
 * AI·합성·배경변경 없음. 자연스러운 결정론적 보정.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { uploadToStorage } from '@/lib/supabase/server';

export const maxDuration = 60;
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };
// SSRF 방어: Supabase Storage URL만 허용 (cleanup-product-image 패턴)
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;
const RequestSchema = z.object({ imageUrl: z.string().url() });

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'retouch-photo'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '이미지 URL이 올바르지 않습니다.' }, { status: 400 });
  }
  const { imageUrl } = parsed.data;
  if (!SUPABASE_URL_PATTERN.test(imageUrl)) {
    return NextResponse.json({ success: false, error: '허용되지 않은 이미지 URL입니다.' }, { status: 400 });
  }

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`이미지 로드 실패 (${res.status})`);
    const inputBuf = Buffer.from(await res.arrayBuffer());

    // 보수적 자연 보정: EXIF 회전 + 밝기·채도 소폭 + 라이트 샤픈. 정규화/과보정 지양.
    const outBuf = await sharp(inputBuf)
      .rotate()
      .modulate({ brightness: 1.04, saturation: 1.06 })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 90 })
      .toBuffer();

    const path = `retouched/${Date.now()}.jpg`;
    const ab = outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength) as ArrayBuffer;
    const { url } = await uploadToStorage(path, ab, 'image/jpeg', outBuf.byteLength);
    return NextResponse.json({ success: true, url });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: '보정 중 오류가 발생했습니다.', _debug: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 타입체크**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "retouch-photo" || echo "no type errors in touched files"
```
Expected: `no type errors in touched files`. (`sharp`·`uploadToStorage` import가 프로젝트에 존재함을 tsc가 확인.)

- [ ] **Step 3: 커밋**
```bash
git add src/app/api/ai/retouch-photo/route.ts
git commit -m "feat(retouch): Sharp 실사진 보정 엔드포인트 /api/ai/retouch-photo"
```

---

## Task 3: apply 핸들러 — `resolveSlotUrl` 사용

**Files:** Modify `src/app/listing/[id]/detail-maker-pro/page.tsx`

- [ ] **Step 1: import에 `resolveSlotUrl` 추가** (L8의 shot-guide import에):
```ts
import { extractDetailCloseupShots, serializeShotChecklist, countUploaded, resolveSlotUrl } from '@/lib/detail-page/shot-guide';
```

- [ ] **Step 2: override 루프 수정** (L1188-1195의 `for (const sl of slots)` 블록):
```ts
for (const sl of slots) {
  const u = resolveSlotUrl(sl);
  if (!u) continue;
  const sec = generatedSections[sl.sectionIndex];
  const genSlotIdx = (sec?.imageSlots ?? []).findIndex(
    x => x.slotType === 'flux_lifestyle' || x.slotType === 'detail_closeup',
  );
  if (genSlotIdx === sl.slotIndex) realBySection[sl.sectionIndex] = u;
}
```
(변경점: `if(!sl.uploadedUrl)continue` → `const u=resolveSlotUrl(sl); if(!u)continue`, 그리고 `= sl.uploadedUrl` → `= u`.)

- [ ] **Step 3: 타입체크 + 커밋**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-maker-pro/page" || echo "no type errors in touched file"
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(retouch): apply override가 보정본 우선(resolveSlotUrl) 사용"
```

---

## Task 4: 카드 "AI 보정" UI (before/after)

**Files:** Modify `src/app/listing/[id]/detail-maker-pro/page.tsx` (shootguide 카드 렌더 + 상태/핸들러)

READ FIRST: `handleSlotUpload`(~L385) 부근, shootguide 카드 렌더 블록(`slots[i]?.uploadedUrl` 썸네일/업로드 label, ~L980-1005), `slots`/`setSlots` 상태.

- [ ] **Step 1: 상태 추가** (다른 useState 근처)
```ts
const [retouchPreview, setRetouchPreview] = useState<{ index: number; url: string } | null>(null);
const [retouchLoading, setRetouchLoading] = useState<number | null>(null);
```

- [ ] **Step 2: 핸들러 추가** (`handleSlotUpload` 근처)
```ts
async function handleRetouch(index: number) {
  const src = slots[index]?.uploadedUrl;
  if (!src) return;
  setRetouchLoading(index);
  try {
    const r = await fetch('/api/ai/retouch-photo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: src }),
    });
    const j = await r.json() as { success: boolean; url?: string; error?: string };
    if (!j.success || !j.url) { alert(j.error || '보정 실패'); return; }
    setRetouchPreview({ index, url: j.url });
  } catch (e) {
    alert(e instanceof Error ? e.message : '보정 실패');
  } finally {
    setRetouchLoading(null);
  }
}
function applyRetouch(index: number, url: string) {
  setSlots(prev => prev.map((s, i) => i === index ? { ...s, retouchedUrl: url } : s));
  setRetouchPreview(null);
}
```

- [ ] **Step 3: 카드 UI 확장** — 업로드된 카드(`slots[i]?.uploadedUrl` 블록)에서:
(a) 썸네일 src를 보정본 우선으로: `slots[i]?.retouchedUrl ?? slots[i]?.uploadedUrl`, 보정본이면 옆에 `<span style={{fontSize:12,color:'#60a5fa'}}>보정됨</span>`.
(b) 업로드 label 옆에 **"AI 보정"** 버튼(보정본 있으면 "다시 보정"):
```tsx
{slots[i]?.uploadedUrl && (
  <button type="button" onClick={() => handleRetouch(i)} disabled={retouchLoading === i}
    style={{ fontSize: 12, color: '#e2e8f0', border: '1px solid #374151', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
    {retouchLoading === i ? '보정 중…' : (slots[i]?.retouchedUrl ? '다시 보정' : 'AI 보정')}
  </button>
)}
```
(c) 이 카드에 대한 프리뷰(`retouchPreview?.index === i`)면 before/after + 적용/원본유지:
```tsx
{retouchPreview?.index === i && (
  <div style={{ marginTop: 8, padding: 8, border: '1px solid #374151', borderRadius: 6 }}>
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
      <div><div style={{ fontSize: 11, color: '#a0a0b0' }}>원본</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={slots[i]!.uploadedUrl!} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} /></div>
      <div><div style={{ fontSize: 11, color: '#60a5fa' }}>보정본</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={retouchPreview.url} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} /></div>
    </div>
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <button type="button" onClick={() => applyRetouch(i, retouchPreview.url)}
        style={{ fontSize: 12, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>적용</button>
      <button type="button" onClick={() => setRetouchPreview(null)}
        style={{ fontSize: 12, color: '#e2e8f0', border: '1px solid #374151', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', background: 'transparent' }}>원본 유지</button>
    </div>
  </div>
)}
```
> 스타일은 주변 인라인 다크테마에 맞춰 조정. `applyRetouch`의 `setSlots`가 Phase 2 자동저장을 트리거해 `retouchedUrl`이 draft에 영속화됨.

- [ ] **Step 4: 타입체크 + 커밋**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-maker-pro/page" || echo "no type errors in touched file"
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(retouch): 카드별 AI 보정 버튼 + before/after + 적용"
```

---

## Task 5: 통합 검증

- [ ] **Step 1: 순수 로직 테스트**
```bash
cat > vitest.scratch.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({ resolve:{alias:{'@':path.resolve(__dirname,'./src')}},
  test:{environment:'node',setupFiles:[],pool:'threads',globals:true,include:['src/lib/detail-page/shot-guide.test.ts']} });
EOF
timeout 90 npx vitest run --config vitest.scratch.config.ts; echo "EXIT=$?"; rm -f vitest.scratch.config.ts
```
Expected: 통과(기존 + resolveSlotUrl).

- [ ] **Step 2: 브라우저 스모크** — dev 서버(로그인):
  1. 실사진 업로드된 카드에서 **"AI 보정"** → before/after 미리보기(원본 vs 보정본)가 뜨는지.
  2. **"적용"** → 썸네일이 보정본으로 바뀌고 "보정됨" 뱃지, draft에 `retouchedUrl` 저장되는지(재개로 확인).
  3. **"원본 유지"** → 변경 없음 확인.
  4. **"에디터에서 편집"** → detail_closeup 슬롯에 **보정본**이 들어가는지(retouchedUrl 우선).
  5. retouch-photo가 직접 fetch로 201+url 반환하는지(작은 이미지로).
- [ ] **Step 3: 스모크 테스트 초안 정리**(선택).

---

## 참고
- 병렬 세션 충돌 회피: 신규 파일(retouch-photo) + page.tsx 소폭. generate-scene-image/워터마크/upload 미변경.
- Sharp 보정값(brightness/saturation/sharpen)은 튜닝 가능 — 과하면 자연스러움 저하.
- 이로써 PRO 실사진 4단계(가이드→저장/재개→업로드→보정) 완성.
