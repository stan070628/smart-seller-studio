# PRO 촬영 가이드 Phase 3 (컷별 실사진 업로드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** shootguide 카드마다 실사진을 업로드하면 `shoot_session`에 슬롯별 저장·진행률 표시하고, "에디터에서 편집" 시 detail_closeup 슬롯이 AI 씬 대신 그 실사진(원본)을 사용한다. 재개(`?draftId=`) 흐름에서도 동작.

**Architecture:** 순수 로직(슬롯 인덱스 추출)을 `shot-guide.ts`에 확장, PRO 페이지에 슬롯 업로드 상태(`slots`)+제품이미지 URL(`productImageUrls`) 지속화, apply 핸들러에서 실사진 override(가드 밖, detail_closeup 한정).

**Tech Stack:** Next.js 16, TS, vitest, Supabase.

> ⚠️ **환경:** studio 기본 vitest 행 → 순수 테스트는 node 임시 config(각 Task 포함). page.tsx 로직은 tsc + 브라우저 스모크. `@/`=`src/`. TARGETED `git add`(무관 untracked 다수, `route 2.ts` 등 제외). 브랜치: 현재 `feat-scene-image-quality`에서 Phase3 전용 브랜치를 판다(시작 시).

> 확인된 코드 사실(page.tsx): `saveShootDraft`(L272, `shootSession:{shotGuide,step:'guide'}` 하드코딩), 자동저장 dep `[draftId, shotGuide]`(L293), 재개 effect(L296-313, shotGuide만 복원), `handleShotGuide`(L316). apply 핸들러(L1025~): Step1 `uploadedImageUrls`(L1030-1047), Step2 `if(uploadedImageUrls.length>0)`(L1052) 안에서 `geminiUrlMap[i]`(원본 섹션 인덱스), Step3(L1113~) `genSlotIdx=첫 flux_lifestyle||detail_closeup`(L1117), `chosen`이 `uploadedImageUrls`(L1128) 사용. 슬롯/타입: `src/types/shot-guide.ts`(`ShotCard`,`ShotGuideInput`), `src/lib/detail-page/shot-guide.ts`(`extractDetailCloseupShots`).

---

## Task 1: 타입 + 순수 로직 (슬롯 인덱스) + 테스트

**Files:** Modify `src/types/shot-guide.ts`, `src/lib/detail-page/shot-guide.ts`, `src/lib/detail-page/shot-guide.test.ts`

- [ ] **Step 1: 테스트 갱신(먼저 실패 상태로)** — `shot-guide.test.ts`의 `extractDetailCloseupShots` 기대값을 인덱스 포함으로 바꾸고, `countUploaded` 테스트 추가:
```ts
// 기존 첫 테스트의 expect(out).toEqual([...]) 를 아래로 교체:
    expect(out).toEqual([
      { sectionIndex: 0, slotIndex: 0, sectionTitle: '디테일', promptHint: '지퍼 접사' },
      { sectionIndex: 2, slotIndex: 0, sectionTitle: '디테일2', promptHint: '원단 텍스처' },
    ]);
```
파일 하단에 추가:
```ts
import { countUploaded } from './shot-guide';
describe('countUploaded', () => {
  it('업로드된 슬롯 수를 센다', () => {
    expect(countUploaded([{ sectionIndex:0, slotIndex:0, uploadedUrl:'u' }, { sectionIndex:1, slotIndex:0, uploadedUrl:null }])).toBe(1);
    expect(countUploaded([])).toBe(0);
  });
});
```

- [ ] **Step 2: FAIL 확인** (node 임시 config; include `src/lib/detail-page/shot-guide.test.ts`)
```bash
cat > vitest.scratch.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({ resolve:{alias:{'@':path.resolve(__dirname,'./src')}},
  test:{environment:'node',setupFiles:[],pool:'threads',globals:true,include:['src/lib/detail-page/shot-guide.test.ts']} });
EOF
timeout 90 npx vitest run --config vitest.scratch.config.ts; echo "EXIT=$?"; rm -f vitest.scratch.config.ts
```
Expected: FAIL (기대값 불일치 + `countUploaded` 없음).

- [ ] **Step 3: 타입 확장 — `src/types/shot-guide.ts`**
`ShotGuideInput`에 인덱스 추가 + `ShootSlot` 추가:
```ts
export interface ShotGuideInput {
  sectionIndex: number;
  slotIndex: number;
  sectionTitle: string;
  promptHint: string;
}

export interface ShootSlot {
  sectionIndex: number;
  slotIndex: number;
  uploadedUrl: string | null;
}
```

- [ ] **Step 4: 로직 확장 — `src/lib/detail-page/shot-guide.ts`**
`extractDetailCloseupShots`를 인덱스 포함으로 교체하고 `countUploaded` 추가:
```ts
import type { ShotCard, ShotGuideInput, ShootSlot } from '@/types/shot-guide';

type LooseSection = { title?: string; imageSlots?: Array<{ slotType?: string; promptHint?: string }> };

export function extractDetailCloseupShots(sections: LooseSection[]): ShotGuideInput[] {
  const out: ShotGuideInput[] = [];
  (sections ?? []).forEach((s, sectionIndex) => {
    (s?.imageSlots ?? []).forEach((slot, slotIndex) => {
      if (slot?.slotType === 'detail_closeup') {
        out.push({ sectionIndex, slotIndex, sectionTitle: s.title ?? '(제목 없음)', promptHint: slot.promptHint ?? '' });
      }
    });
  });
  return out;
}

export function countUploaded(slots: ShootSlot[]): number {
  return (slots ?? []).filter(s => !!s?.uploadedUrl).length;
}
```
(`serializeShotChecklist`, `parseShotGuideResponse`는 그대로 유지.)

- [ ] **Step 5: PASS 확인** (Step 2 recipe 재사용). Expected: 통과(기존 + countUploaded).

- [ ] **Step 6: 커밋**
```bash
git add src/types/shot-guide.ts src/lib/detail-page/shot-guide.ts src/lib/detail-page/shot-guide.test.ts
git commit -m "feat(shot-guide): 슬롯 인덱스 추출 + ShootSlot 타입 + countUploaded"
```

---

## Task 2: PRO 페이지 — 슬롯/제품URL 상태 + Phase2 저장 배선 수정 + 재개/무효화

**Files:** Modify `src/app/listing/[id]/detail-maker-pro/page.tsx`. READ the regions at L272(saveShootDraft), L289(autosave), L296(resume), L316(handleShotGuide), and the "처음부터" reset (~L1005) first.

- [ ] **Step 1: import + state**
```ts
import type { ShotCard, ShootSlot } from '@/types/shot-guide';
// 상태 추가(다른 useState 근처):
const [slots, setSlots] = useState<ShootSlot[]>([]);
const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
```
(`ShotCard` 이미 import돼 있으면 `ShootSlot`만 추가.)

- [ ] **Step 2: `saveShootDraft`를 세션 인자 기반으로 리팩터** (L272 블록 교체)
```ts
async function saveShootDraft(
  nextId: string | null,
  session: { shotGuide: ShotCard[]; slots: ShootSlot[]; step: 'guide' | 'shooting'; productImageUrls: string[] },
): Promise<string | null> {
  const res = await fetch('/api/detail-page/draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: nextId ?? undefined, productName, sections: generatedSections, theme: {}, shootSession: session }),
  });
  const json = await res.json();
  return (json?.id as string) ?? nextId;
}
// 현재 세션 스냅샷 헬퍼(선택): step 파생
function currentStep(sl: ShootSlot[]): 'guide' | 'shooting' { return sl.some(s => s.uploadedUrl) ? 'shooting' : 'guide'; }
```

- [ ] **Step 3: 자동저장 effect 수정** (L289 교체) — dep에 slots 포함, 최신 상태 저장
```ts
useEffect(() => {
  if (!draftId || !shotGuide) return;
  const t = setTimeout(() => {
    saveShootDraft(draftId, { shotGuide, slots, step: currentStep(slots), productImageUrls }).catch(() => {});
  }, 1500);
  return () => clearTimeout(t);
}, [draftId, shotGuide, slots, productImageUrls]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: 재개 effect에 slots/step/productImageUrls 복원** (L296 블록 내 `setShotGuide(sg)` 부근에 추가)
```ts
const ss = d.shootSession ?? {};
if (Array.isArray(ss.slots)) setSlots(ss.slots);
if (Array.isArray(ss.productImageUrls)) setProductImageUrls(ss.productImageUrls);
```

- [ ] **Step 5: `handleShotGuide`에서 제품이미지 업로드 + slots 초기화 + 전체 세션 저장**
`extractDetailCloseupShots` 호출 결과(`shots`)에 이제 `sectionIndex/slotIndex`가 있다. 성공 처리부(L340 `setShotGuide(...)` 이후)를 이렇게 확장:
```ts
setShotGuide(json.data.shots as ShotCard[]);
// 슬롯 초기화(추출 shots와 1:1). 재실행 시 이전 업로드는 초기화(무효화 정책).
const initSlots: ShootSlot[] = shots.map(sh => ({ sectionIndex: sh.sectionIndex, slotIndex: sh.slotIndex, uploadedUrl: null }));
setSlots(initSlots);
// 제품 이미지를 지금 업로드해 URL 확보(재개-적용에서 라이프스타일/누끼용). 실패는 빈 배열.
let prodUrls: string[] = [];
try {
  prodUrls = (await Promise.allSettled(productImages.map(async (file) => {
    const fd = new FormData(); fd.append('file', file); fd.append('usageContext', 'listing_detail');
    const r = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
    const j = await r.json() as { success: boolean; data?: { url: string } };
    if (!j.success || !j.data?.url) throw new Error('upload failed');
    return j.data.url;
  }))).filter((x): x is PromiseFulfilledResult<string> => x.status === 'fulfilled').map(x => x.value);
} catch { /* 무시 */ }
setProductImageUrls(prodUrls);
setScreen('shootguide');
try {
  const id = await saveShootDraft(draftId, { shotGuide: json.data.shots, slots: initSlots, step: 'guide', productImageUrls: prodUrls });
  if (id) {
    setDraftId(id);
    const url = new URL(window.location.href); url.searchParams.set('draftId', id);
    window.history.replaceState(null, '', url.toString());
  }
} catch { /* 무시 */ }
```
> 기존 `handleShotGuide`의 `extractDetailCloseupShots(...)` 캐스팅은 인덱스 필드를 포함하도록 반환 타입이 이미 확장됐으니 그대로 동작. `shots`를 위 블록에서 재사용하므로 함수 스코프에 있음을 확인.

- [ ] **Step 6: "처음부터"/재생성 시 무효화** — 레이아웃 리셋 핸들러(~L1005)와 generate가 새 레이아웃을 만들 때, 아래를 함께 초기화:
```ts
setShotGuide(null); setSlots([]); setProductImageUrls([]);
```
(draftId는 유지해도 되지만, 다른 상품으로 새로 시작하면 `setDraftId(null)`도 고려 — 최소구현은 shotGuide/slots/productImageUrls 초기화로 stale 매핑 차단.)

- [ ] **Step 7: 타입체크 + 커밋**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-maker-pro/page" || echo "no type errors in touched file"
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(shot-guide): 슬롯/제품URL 상태 + 저장 배선 수정 + 재개/무효화 (Phase3)"
```

---

## Task 3: shootguide 카드 업로드 UI

**Files:** Modify `src/app/listing/[id]/detail-maker-pro/page.tsx` (shootguide 화면 렌더 블록, `if (screen === 'shootguide')`).

- [ ] **Step 1: 업로드 핸들러 추가** (컴포넌트 내)
```ts
async function handleSlotUpload(index: number, file: File) {
  const fd = new FormData(); fd.append('file', file); fd.append('usageContext', 'listing_detail');
  const r = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
  const j = await r.json() as { success: boolean; data?: { url: string }; error?: string };
  if (!j.success || !j.data?.url) { alert(j.error || '업로드 실패(jpg/png/webp).'); return; }
  const next = slots.map((s, i) => i === index ? { ...s, uploadedUrl: j.data!.url } : s);
  setSlots(next); // 자동저장 effect가 새 slots로 저장
}
```

- [ ] **Step 2: 진행률 표시** — shootguide 화면 상단 소제목 옆:
```tsx
<span style={{ fontSize: 12, color: '#a0a0b0' }}>업로드 {countUploaded(slots)}/{(shotGuide ?? []).length}</span>
```
(`import { countUploaded } from '@/lib/detail-page/shot-guide';` 추가.)

- [ ] **Step 3: 카드마다 업로드 입력 + 썸네일** — 각 카드(`cards.map((c,i)=>...)`) 하단에:
```tsx
<div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
  {slots[i]?.uploadedUrl ? (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={slots[i]!.uploadedUrl!} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid #374151' }} />
      <span style={{ fontSize: 12, color: '#4ade80' }}>완료</span>
    </>
  ) : null}
  <label style={{ fontSize: 12, color: '#e2e8f0', border: '1px solid #374151', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
    {slots[i]?.uploadedUrl ? '다시 업로드' : '사진 업로드'}
    <input type="file" accept="image/*" style={{ display: 'none' }}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSlotUpload(i, f); e.currentTarget.value = ''; }} />
  </label>
</div>
```
> `slots[i]`는 shotGuide[i]와 index 정렬(Task2 initSlots). 길이 불일치 대비 옵셔널 체이닝 사용.

- [ ] **Step 4: 푸터 문구 수정** — 기존 "촬영·업로드·보정은 다음 단계에서 추가됩니다. 지금은 …" 문구를 업로드가 생겼으니 갱신(예: "찍은 사진을 각 컷에 업로드하세요. 보정은 다음 단계에서 적용됩니다.").

- [ ] **Step 5: 타입체크 + 커밋**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-maker-pro/page" || echo "no type errors in touched file"
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(shot-guide): shootguide 카드 실사진 업로드 UI + 진행률"
```

---

## Task 4: apply 핸들러 — 실사진 override (가드 밖 + detail_closeup 한정)

**Files:** Modify `src/app/listing/[id]/detail-maker-pro/page.tsx` (apply 핸들러 onClick, L1025-1164).

- [ ] **Step 1: effectiveProductUrls + 실사진 override 맵** — Step1(`uploadedImageUrls` 확보) 직후, Step2 가드 **앞에** 삽입:
```ts
// 재개 시 productImages(File) 없음 → 저장해둔 productImageUrls로 폴백
const effectiveProductUrls = uploadedImageUrls.length > 0 ? uploadedImageUrls : productImageUrls;
// 실사진 override: detail_closeup이 그 섹션의 targeting gen 슬롯(genSlotIdx)일 때만
const realBySection: Record<number, string> = {};
for (const sl of slots) {
  if (!sl.uploadedUrl) continue;
  const sec = generatedSections[sl.sectionIndex];
  const genSlotIdx = (sec?.imageSlots ?? []).findIndex(
    x => x.slotType === 'flux_lifestyle' || x.slotType === 'detail_closeup',
  );
  if (genSlotIdx === sl.slotIndex) realBySection[sl.sectionIndex] = sl.uploadedUrl;
}
Object.assign(geminiUrlMap, realBySection);
```
(`geminiUrlMap`은 L1051에서 이미 선언됨. 이 블록은 그 선언 뒤·Step2 가드 앞에 둔다.)

- [ ] **Step 2: Step2 가드/스킵 수정** — `if (uploadedImageUrls.length > 0)`(L1052)를 `if (effectiveProductUrls.length > 0)`로, 그리고 `genItems`에서 **이미 override된 섹션은 제외**:
```ts
const genItems = generatedSections
  .map((s, i) => ({ s, i }))
  .filter(({ s, i }) => realBySection[i] === undefined && (s.imageSlots?.some(slot => isGenSlot(slot.slotType)) ?? false));
```
그리고 Step2 내부에서 `uploadedImageUrls`를 참조하던 `refImages`(L1069-1072)를 `effectiveProductUrls` 기준으로 변경.

- [ ] **Step 3: Step3의 `chosen`을 effectiveProductUrls로** (L1127-1130)
```ts
const chosen = effectiveProductUrls.length > 0 ? effectiveProductUrls[refIdx % effectiveProductUrls.length] : undefined;
```
Step3의 `idx === genSlotIdx && geminiUrl ? geminiUrl : (chosen ?? '')`는 그대로 — override된 실사진이 `geminiUrl`로 들어와 detail_closeup 자리에 배치됨.

- [ ] **Step 4: pro_meta도 effectiveProductUrls로**(선택) — `sessionStorage.setItem('pro_meta', JSON.stringify({ productName, uploadedImageUrls: effectiveProductUrls }))`.

- [ ] **Step 5: 타입체크 + 커밋**
```bash
timeout 240 npx tsc --noEmit 2>&1 | grep -E "detail-maker-pro/page" || echo "no type errors in touched file"
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(shot-guide): apply에서 detail_closeup 실사진 override (가드 밖·재개 지원)"
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
Expected: 통과.

- [ ] **Step 2: 브라우저 스모크 (주 흐름 우선)** — dev 서버(로그인됨):
  1. PRO로 레이아웃 생성(detail_closeup 포함) → "📸 촬영 가이드" → 카드에 "사진 업로드" 보이는지, 진행률 0/N.
  2. 각 카드에 이미지 업로드 → 썸네일·"완료"·진행률 증가, URL이 `?draftId=` 초안에 저장되는지.
  3. **새로고침/재접속(`?draftId=`)** → 업로드 상태(썸네일·진행률)까지 복원되는지.
  4. "에디터에서 편집" → detail_closeup 슬롯에 **업로드한 실사진**이 보이는지(AI 씬 아님), 라이프스타일 슬롯은 AI로 남는지.
  5. (혼합 슬롯 섹션이 있으면) 실사진이 라이프스타일 자리에 잘못 들어가지 않는지.
- [ ] **Step 3: 스모크로 생성된 테스트 초안 정리**(선택) — draft 삭제.

---

## 참고
- 리뷰(Fable5) 반영: override는 `uploadedImageUrls>0` 가드 밖(재개 지원), detail_closeup=genSlotIdx일 때만(혼합 슬롯), 저장은 세션 인자화(step/slots 보존), 재생성 시 무효화.
- Phase 4(보정)는 별도: 이 실사진 URL을 `generate-scene-image` edit 모드로 가볍게 보정해 교체.
