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
- `shootSession` 전체: `{ shotGuide: ShotCard[], slots: ShootSlot[], step: 'guide'|'shooting' }`.

### ② 업로드 UI (shootguide 카드마다)
- 각 촬영 카드 하단에 **"사진 업로드"** (숨김 `<input type=file accept="image/*">` + 버튼). 선택 시:
  - `FormData(file, usageContext:'listing_detail')` → `POST /api/listing/upload-image` → `data.url`.
  - `slots[i].uploadedUrl = url` 갱신 → 자동저장(Phase 2 draft 저장 재사용) → 카드에 **썸네일 + "완료"** 표시. 재업로드 가능.
- 화면 상단에 **진행률**: "업로드 N/M".
- 하나 이상 업로드되면 `step='shooting'`으로.

### ③ 원본 즉시 삽입 (apply 핸들러)
- Step 2에서 씬 생성 전에, `shootSession.slots` 중 `uploadedUrl`이 있는 항목으로 **섹션 인덱스 → 실사진 URL** 맵 구성.
- 각 gen-슬롯 섹션 처리 시: 그 섹션에 업로드된 실사진이 있으면(해당 `sectionIndex`의 detail_closeup 슬롯) → `generate-scene-image` 호출을 **건너뛰고** `geminiUrlMap[i] = 실사진URL` 로 설정.
- Step 3는 변경 없이 그 값을 슬롯에 배치 → 원본 실사진이 그 자리에 삽입됨.
- (라이프스타일 슬롯은 기존대로 AI 생성.)

### ④ 범위 밖 (Phase 4)
- 업로드 실사진의 AI 가벼운 보정(노출·색·배경 정돈). Phase 3는 **원본 그대로 삽입**까지.
- 슬롯당 다중 사진/선택 UI(현재는 슬롯당 1장, 재업로드로 교체).

## 4. 데이터 형태
```ts
// shoot-guide.ts (확장)
export interface ShotGuideInput { sectionIndex: number; slotIndex: number; sectionTitle: string; promptHint: string; }
export interface ShootSlot { sectionIndex: number; slotIndex: number; uploadedUrl: string | null; }
// shootSession(JSON): { shotGuide: ShotCard[], slots: ShootSlot[], step: 'guide'|'shooting' }
```

## 5. 구현 산출물 요약
1. `src/lib/detail-page/shot-guide.ts` — `extractDetailCloseupShots`에 `sectionIndex/slotIndex` 추가 + `ShootSlot` 타입 + 병합 헬퍼(진행률 등). 테스트 갱신.
2. `detail-maker-pro/page.tsx` — 가이드 생성 시 `slots` 초기화·저장, shootguide 카드에 업로드 UI/썸네일/진행률, `slots` 자동저장, `?draftId=` 재개 시 `slots` 복원.
3. `detail-maker-pro/page.tsx` (apply 핸들러) — 업로드 실사진이 있는 detail_closeup 슬롯은 씬 생성 대신 실사진 사용.
4. 검증: 순수 로직 유닛테스트 + 브라우저 스모크(파일 업로드→카드 썸네일→진행률→에디터에서 실사진 확인).

## 6. 참고
- 슬롯 매칭은 apply 핸들러가 **섹션당 1 gen 이미지**(`geminiUrlMap[sectionIndex]`)라, 실사진 override도 sectionIndex 기준이면 충분(한 섹션에 detail_closeup 다수인 엣지케이스는 첫 슬롯 기준).
- studio 기본 vitest 행 → 순수 테스트는 node 임시 config. 업로드/삽입은 tsc + 브라우저 스모크.
- Phase 2에서 확인된 draft POST 특성(claude_layout 섹션에 `content` 필수) 유지 — 실제 generatedSections엔 content 있음.
