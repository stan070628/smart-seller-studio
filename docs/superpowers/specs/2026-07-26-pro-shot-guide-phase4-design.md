# PRO 촬영 가이드 Phase 4 (실사진 AI 보정) 설계 문서

> 작성일: 2026-07-26
> 상태: 승인됨 (구현 대기)
> 선행: Phase 1·2 병합됨, Phase 3(`feat-pro-shot-upload`, 미병합). 이 문서는 Phase 4.

## 0. 맥락 · 결정
"PRO 상세페이지에 실사진 넣기" 4단계의 마지막. 업로드한 실사진 디테일컷을 **가볍게 보정**해 슬롯에 쓴다. 확정 결정:
- **격리**: 병렬 세션("PRO 옵션·씬 품질/워터마크")이 `generate-scene-image`·워터마크·`detail-maker-pro/page.tsx`를 대거 수정 중 → **현재 HEAD 기준 새 브랜치 `feat-pro-shot-retouch`**, 보정은 **별도 엔드포인트**(그들 코드 미변경). 병렬 세션 원칙 "어떤 업로드 경로도 사용자 이미지를 자동 편집하지 않음" 준수 → 보정은 **명시적 opt-in**.
- **트리거/UX**: 카드별 **"AI 보정"** 버튼 → **before/after 미리보기** → "적용" 또는 "원본 유지".
- **방식**: **Sharp만**(결정론·자연스러움). 밝기·채도·선명도 미세 보정. AI·합성·배경변경 없음.

## 1. 목적
업로드된 `detail_closeup` 실사진을 Sharp로 가볍게 보정한 버전을 만들고, 사용자가 적용하면 그 보정본을 슬롯에 저장·apply 시 사용한다. 원본은 항상 보존(폐기/재보정 가능).

## 2. 현재 구조 (확인됨)
- `ShootSlot`(`src/types/shot-guide.ts`): `{ sectionIndex, slotIndex, uploadedUrl: string|null }` (Phase 3).
- apply 핸들러(`detail-maker-pro/page.tsx`) 실사진 override(Phase 3): `for (const sl of slots){ if(!sl.uploadedUrl) continue; ... realBySection[sl.sectionIndex] = sl.uploadedUrl; }`.
- shootguide 카드 업로드 UI(Phase 3): 카드마다 썸네일 + "사진 업로드"/"다시 업로드".
- 재사용 패턴: `cleanup-product-image/route.ts`(auth·rate-limit·SSRF 가드 `SUPABASE_URL_PATTERN=/^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//`). 업로드 `uploadToStorage(path, arrayBuffer, mime, size): {url,...}`(`src/lib/supabase/server.ts:75`), upload-ai가 Buffer→ArrayBuffer로 호출.
- Sharp는 프로젝트 전역 사용.
- 현재 브랜치 HEAD `a7eb5192`(병렬 세션). Phase 4 브랜치는 여기서 분기.

## 3. 설계

### ① 데이터
- `ShootSlot`에 `retouchedUrl: string | null` 추가(기존 초안은 미존재→`undefined`→null 취급).
- 슬롯 최종 URL 해상도(순수): `resolveSlotUrl(slot) = slot.retouchedUrl ?? slot.uploadedUrl ?? null`.

### ② 새 엔드포인트 `POST /api/ai/retouch-photo`
- 파일: `src/app/api/ai/retouch-photo/route.ts`
- 입력: `{ imageUrl: string }` (zod). **SSRF 가드**: `SUPABASE_URL_PATTERN` 미일치 시 400.
- 처리(Sharp만):
  1. `fetch(imageUrl)` → `arrayBuffer` → `Buffer`
  2. `sharp(buf).rotate()` (EXIF) → 보수적 보정: `.modulate({ brightness: 1.04, saturation: 1.06 })` + `.sharpen({ sigma: 0.6 })` (+ 선택 `.gamma(1.05)`) → `.jpeg({ quality: 90 })` → `toBuffer()`. **정규화·과보정 지양(자연스러움 우선), 값은 튜닝 가능.**
  3. `uploadToStorage('retouched/${ts}.jpg', out.buffer as ArrayBuffer, 'image/jpeg', out.byteLength)` → `{ url }`
- 출력: `{ success: true, url }`. 인증·rate-limit은 cleanup-product-image 패턴.
- 실패: 4xx/5xx + 한국어 메시지.

### ③ apply 핸들러 (Phase 3 override 한 줄 수정)
- `realBySection[sl.sectionIndex] = sl.uploadedUrl` → `resolveSlotUrl(sl)` 사용. 가드도 `if (!resolveSlotUrl(sl)) continue`.
- 보정본 있으면 보정본, 없으면 원본이 슬롯에 삽입됨.

### ④ UI (shootguide 카드마다)
- 상태 추가: `retouchPreview: { index: number; url: string } | null`, `retouchLoading: number | null`.
- 업로드된(=`slots[i].uploadedUrl`) 카드에 **"AI 보정"** 버튼(보정본 있으면 "다시 보정"):
  - 클릭 → `POST /api/ai/retouch-photo { imageUrl: uploadedUrl }` → `setRetouchPreview({ index:i, url })`.
- `retouchPreview.index === i`인 카드: **before(원본)/after(보정본) 나란히** + **"적용"**(→ `setSlots`로 `slots[i].retouchedUrl=url`, 자동저장 → 프리뷰 닫기) / **"원본 유지"**(프리뷰 닫기, 변경 없음).
- 적용된 카드: 썸네일=보정본(`retouchedUrl`), **"보정됨"** 뱃지.

### ⑤ 격리
- 새 브랜치 `feat-pro-shot-retouch`(HEAD `a7eb5192`에서). `generate-scene-image`·워터마크·upload 라우트 **미변경**. `page.tsx`는 카드 버튼/프리뷰만 소폭 추가.

### ⑥ 범위 밖
- Gemini 배경 정돈(이번엔 Sharp만). 다중 보정 프리셋/강도 슬라이더. 배치 보정.

## 4. 데이터 형태
```ts
export interface ShootSlot {
  sectionIndex: number;
  slotIndex: number;
  uploadedUrl: string | null;
  retouchedUrl?: string | null; // Phase 4
}
export function resolveSlotUrl(slot: ShootSlot): string | null; // retouchedUrl ?? uploadedUrl ?? null
```

## 5. 구현 산출물 요약
1. `src/types/shot-guide.ts` — `ShootSlot.retouchedUrl`.
2. `src/lib/detail-page/shot-guide.ts` — `resolveSlotUrl` + 테스트.
3. `src/app/api/ai/retouch-photo/route.ts` — Sharp 보정 엔드포인트(SSRF·auth·rate-limit·업로드).
4. `detail-maker-pro/page.tsx` — 카드 "AI 보정" + before/after + 적용/원본유지 + 상태.
5. `detail-maker-pro/page.tsx` (apply) — override를 `resolveSlotUrl(sl)`로.
6. 검증: `resolveSlotUrl` 유닛테스트 + 브라우저 스모크(업로드된 실사진 보정 → before/after → 적용 → 에디터에 보정본 반영). retouch 엔드포인트는 실이미지로 브라우저에서 확인.

## 6. 참고
- studio 기본 vitest 행 → 순수 테스트는 node 임시 config. 엔드포인트/UI는 tsc + 브라우저 스모크.
- 병렬 세션 충돌 회피가 이 설계의 제약 — 공유 파일(page.tsx)은 최소 추가, 나머지는 신규 파일.
- retouch 결과는 Supabase Storage(`retouched/`)에 저장, apply→에디터→draft 자동저장으로 흐름 유지.
