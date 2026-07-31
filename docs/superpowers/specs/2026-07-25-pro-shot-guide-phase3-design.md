# PRO 촬영 가이드 Phase 3 (컷별 실사진 업로드) 설계 문서

> 작성일: 2026-07-25
> 상태: 승인됨 (구현 대기)
> 선행: Phase 1(가이드 표시)·Phase 2(저장&재개) 병합 완료 (base `feat-scene-image-quality`).

## 0. 맥락
"PRO 상세페이지에 실사진 넣기" 4단계 중 3단계. 사용자가 촬영 가이드대로 찍은 실사진을 **컷(=detail_closeup 슬롯)별로 업로드**하면, **보정 없이 원본이 즉시 해당 슬롯에 삽입**된다(Phase 4에서 AI 보정으로 업그레이드). 결정: 실사진 대상은 `detail_closeup`만, "원본 즉시 삽입"(옵션 2).

## 1. 목적
- `shootguide` 화면의 각 촬영 카드에 실사진 업로드 UI 추가 → 슬롯별 사진 저장·진행률·썸네일.
- "에디터에서 편집" 시, 업로드된 실사진이 있는 `detail_closeup` 슬롯은 AI 씬 생성 대신 **그 실사진을 사용**.

## 2. 현재 구조 (확인됨)
- PRO 페이지 `src/app/listing/[id]/detail-maker-pro/page.tsx`:
  - Phase 1: `handleShotGuide`가 `extractDetailCloseupShots(generatedSections)` → `{sectionTitle, promptHint}[]`로 shot 추출 → `/api/ai/generate-shot-guide` → `shotGuide: ShotCard[]` → `shootguide` 화면.
  - Phase 2: `shootSession = { shotGuide, step:'guide' }` 저장, `?draftId=` 재개.
  - **apply 핸들러**(“에디터에서 편집”, ~L1030): Step1 productImages 업로드 → `uploadedImageUrls`. Step2(~L1049): gen 슬롯(`flux_lifestyle`|`detail_closeup`) 있는 섹션마다 `POST /api/ai/generate-scene-image` → `geminiUrlMap[i]`(**섹션 인덱스 i 별, 섹션당 1장**). Step3(~L1111): 섹션마다 gen 슬롯 자리에 `geminiUrlMap[i]`를 넣어 `attachedImages` 구성 → `sessionStorage 'pro_sections'` → 에디터.
- 업로드 인프라: `POST /api/listing/upload-image` (multipart `file` + `usageContext`; 반환 `{ data:{ url, ... } }`). 재사용.
- 순수 로직: `src/lib/detail-page/shot-guide.ts`(`extractDetailCloseupShots` 등).

## 3. 설계

### ① 슬롯 식별자 확보 (순수 로직 확장)
- `extractDetailCloseupShots` 반환을 확장: `{ sectionIndex, slotIndex, sectionTitle, promptHint }`. (기존 테스트도 갱신.)
- `handleShotGuide`: API 입력엔 기존대로 `{sectionTitle, promptHint}`만 보내고, `sectionIndex/slotIndex`는 클라이언트에 보관.
- 가이드 생성 시 `shootSession.slots` 저장(shotGuide와 index 정렬):
  ```
  slots: [{ sectionIndex, slotIndex, uploadedUrl: string | null }]
  ```
- `shootSession` 전체: `{ shotGuide: ShotCard[], slots: ShootSlot[], step: 'guide'|'shooting', productImageUrls: string[] }`.
- **[리뷰반영-HIGH1] `productImageUrls`**: 재개 시 `productImages`(File)는 복원 불가. 그래서 **가이드 생성(`handleShotGuide`) 시점에 productImages를 Supabase에 업로드**(`/api/listing/upload-image`)해 URL 배열을 `shootSession.productImageUrls`에 저장한다. apply 핸들러는 File 업로드분(`uploadedImageUrls`)이 비면 이 값을 사용 → 재개-적용 흐름에서도 라이프스타일/누끼 이미지가 정상 생성됨.

### ② 업로드 UI (shootguide 카드마다)
- 각 촬영 카드 하단에 **"사진 업로드"** (숨김 `<input type=file accept="image/*">` + 버튼). 선택 시:
  - `FormData(file, usageContext:'listing_detail')` → `POST /api/listing/upload-image` → 응답 `{success, data:{url}}`에서 `data.url`(성공·2xx 확인).
  - `slots[i].uploadedUrl = url` 로 **새 slots를 만들어** 갱신 → 그 **새 값을 인자로** 자동저장(아래 ⑤). 카드에 **썸네일 + "완료"** 표시. 재업로드 가능.
- 화면 상단 **진행률**: "업로드 N/M".
- 하나 이상 업로드되면 `step='shooting'`.
- **[리뷰반영-LOW] HEIC**: iOS가 대개 JPEG로 변환하나 아닐 수 있음. 415 응답 시 "지원 형식(jpg/png/webp)으로 다시" 안내. 업로드 라우트는 리사이즈+JPEG 재인코딩하므로 "원본"은 정확히는 리인코딩본.

### ③ 원본 즉시 삽입 (apply 핸들러) — [리뷰반영-HIGH1·HIGH2]
- **가드 밖으로**: 실사진 override(`geminiUrlMap[sectionIndex] = uploadedUrl`)와 `uploadedImageUrls` 대체(productImageUrls)는 **`if (uploadedImageUrls.length > 0)` 밖/앞**에서 수행한다. (현재 Step2 전체가 이 가드 안이라, 재개 시 통째로 스킵됨 — 반드시 밖으로.)
  - 구체적으로: apply 시작부에서 `const effectiveProductUrls = uploadedImageUrls.length > 0 ? uploadedImageUrls : (shootSession.productImageUrls ?? [])` 를 만들어 Step2/Step3가 이걸 쓰게 한다. Step3의 non-gen 슬롯 이미지 선택(현재 `uploadedImageUrls[refIdx]`)도 `effectiveProductUrls` 기준으로.
- **혼합 슬롯 규칙**: 오버라이드는 **그 섹션이 targeting하는 gen 슬롯(Step3의 `genSlotIdx` = 첫 `flux_lifestyle||detail_closeup`)이 실제로 `detail_closeup`일 때만** 적용한다. 즉 `slot.slotIndex === genSlotIdx` 인 detail_closeup에만 실사진을 넣는다. 첫 gen 슬롯이 `flux_lifestyle`이면 override하지 말고 기존대로 AI 생성(라이프스타일 유지). → `ShootSlot.slotIndex`를 실제로 사용.
- Step3는 그 외 변경 없음 → 매칭된 detail_closeup 자리에 원본 실사진 삽입.

### ④ 재개·재생성 상태 관리 — [리뷰반영-HIGH1·MED4]
- **재개(`?draftId=`)**: 복원 시 `slots`, `step`, `productImageUrls`까지 복원(현재는 shotGuide만). 
- **무효화**: "처음부터"(레이아웃 리셋) 및 `handleShotGuide` 재실행 시 `shotGuide`·`slots`·`productImageUrls`(및 필요시 `draftId`)를 초기화한다 — 옛 sectionIndex가 새 레이아웃에 잘못 매핑되는 것 방지(업로드 유실은 수용, 명시).
- **정합성 가드**: `shotGuide`와 `slots`를 zip할 때 길이 불일치면 안전 처리(코드로 1:1 보장 안 되고 프롬프트 의존이므로).

### ⑤ Phase 2 저장 배선 수정 — [리뷰반영-MED3]
- `saveShootDraft`가 세션을 하드코딩(`{shotGuide, step:'guide'}`)하지 않게 리팩터: **인자로 `{ shotGuide, slots, step, productImageUrls }`를 받아** 그대로 저장(자동저장이 `step`/`slots`를 덮어쓰지 않게).
- 자동저장 effect의 dep 배열에 `slots`, `step` 포함. 업로드 직후 저장은 **setState의 stale 클로저를 피해** 새 slots를 명시 인자로 전달.

### ⑥ 범위 밖 (Phase 4)
- 업로드 실사진의 AI 가벼운 보정. Phase 3는 **원본 그대로 삽입**까지. 슬롯당 1장(재업로드로 교체).

## 4. 데이터 형태
```ts
// src/types/shot-guide.ts (기존 파일에 추가) — 주의: lib은 shot-guide.ts, 타입은 types/shot-guide.ts
export interface ShotGuideInput { sectionIndex: number; slotIndex: number; sectionTitle: string; promptHint: string; }
export interface ShootSlot { sectionIndex: number; slotIndex: number; uploadedUrl: string | null; }
// shootSession(JSON): { shotGuide: ShotCard[]; slots: ShootSlot[]; step: 'guide'|'shooting'; productImageUrls: string[] }
```

## 5. 구현 산출물 요약
1. `src/types/shot-guide.ts` — `ShotGuideInput`에 `sectionIndex/slotIndex` 추가 + `ShootSlot` 타입.
2. `src/lib/detail-page/shot-guide.ts` — `extractDetailCloseupShots`가 `sectionIndex/slotIndex` 포함 반환 + 병합/진행률 헬퍼. **테스트 갱신**(fixture 기대값 `{0,0}`,`{2,0}`).
3. `detail-maker-pro/page.tsx` — 가이드 생성 시 productImages 업로드→`productImageUrls` + `slots` 초기화, shootguide 카드 업로드 UI/썸네일/진행률, 저장 배선 수정(⑤), 재개/무효화(④), 푸터 문구("다음 단계…") 제거/수정.
4. `detail-maker-pro/page.tsx` (apply 핸들러) — override를 가드 밖으로 + detail_closeup(=genSlotIdx)만 override + `effectiveProductUrls` 사용(③).
5. 검증: 순수 로직 유닛테스트 + 브라우저 스모크 — **특히 재개(`?draftId=`)→업로드→적용→에디터에서 실사진 확인**(주 흐름), 혼합 슬롯 섹션에서 라이프스타일이 AI로 남는지.

## 6. 참고
- `geminiUrlMap`은 필터 전 원본 인덱스 `i`로 키잉됨(Step2 `map((s,i))` 후 filter, `geminiUrlMap[i]`) — sectionIndex 오버라이드가 올바른 섹션에 안착함(리뷰 검증됨).
- upload-image 계약: 파트명 `file`, `usageContext ∈ {listing_thumbnail, listing_detail}`, 응답 `{success, data:{url,assetId,...}}` 201.
- studio 기본 vitest 행 → 순수 테스트는 node 임시 config. 업로드/삽입은 tsc + 브라우저 스모크.
- draft POST 특성(claude_layout 섹션에 `content` 필수) 유지 — 실제 generatedSections엔 content 있음.
