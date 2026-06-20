# 씬 이미지 편집 패널 설계

**날짜:** 2026-06-20
**상태:** 확정

---

## 목적

hero / point 섹션의 AI 생성 씬 이미지를 레퍼런스 이미지 + 지시어로 **편집하거나 새로 생성**할 수 있는 인라인 패널을 SectionCard에 추가한다.

---

## UX 흐름

```
SectionCard "씬 편집 ▾" 클릭
  ↓
인라인 패널 열림 (카드 헤더 바로 아래)
  ├─ [이미지 있을 때] 현재 씬 이미지 썸네일 미리보기 표시
  └─ [이미지 없을 때] "아직 생성된 이미지가 없어요" 안내 배너

  ↓ 사용자 입력
  ├─ 레퍼런스 이미지 선택 (최대 2장, 합산)
  │   ├─ "참고 이미지에서" → uploadedUrls 그리드 선택 UI
  │   └─ "PC에서 업로드" → 파일 피커 → /api/listing/upload-image → URL 획득
  └─ 지시어 textarea (선택)
       예) "배경을 더 밝게, 야외 카페 분위기로"

  ↓ "수정 재생성" / "새로 생성" 클릭
  → onSceneEdit(section, { instruction, referenceImageUrls }) 호출
  → 성공 시 패널 자동 닫힘, 이미지 교체, HTML 미리보기 갱신
  → 실패 시 패널 유지 (에러 인라인 표시, 재시도 가능)
```

---

## 아키텍처

### API 변경 — `generate-scene-image` 확장

신규 endpoint 대신 **기존 `/api/ai/generate-scene-image`에 필드 추가**한다.

Gemini에 별도 edit API가 없고, baseImageUrl도 reference 이미지 중 하나로 투입되는 동일 파이프라인이기 때문에 신규 endpoint는 SSRF allowlist · rate-limit · 에러 매핑을 통째로 중복시킨다.

**추가 Request 필드:**

```ts
// 기존 RequestBodySchema에 추가
baseImageUrl: z.string().url().optional(),   // 편집 모드: 기존 씬 이미지 URL
instruction:  z.string().max(500).optional(), // 편집/생성 지시어
```

**내부 분기 (프롬프트 빌더):**

```
baseImageUrl 있음 → 편집 모드
  - 이미지 다운로드 실패 → 명시적 에러 반환 (조용한 폴백 X)
  - Claude 프롬프트에 각 이미지 역할 라벨링:
      [BASE] 수정할 기존 씬 이미지
      [REF]  레퍼런스 이미지 (선택)
      instruction을 편집 지시로 반영

baseImageUrl 없음 → 새 생성 모드
  - 기존 generate-scene-image 흐름 유지
  - instruction을 sceneHint로 병합
```

**Rate limit:** 편집 모드는 별도 키 버킷(`edit-scene-image`)으로 분리해 일반 생성 한도와 충돌 방지.

---

### 신규 컴포넌트 — `SceneEditPanel.tsx`

`src/components/listing/detail-editor/SceneEditPanel.tsx`

**Props:**
```ts
interface SceneEditPanelProps {
  section: DetailSection;
  uploadedUrls: string[];        // 왼쪽 패널 상품 이미지
  isEditing: boolean;
  error: string | null;
  onEdit: (opts: {
    instruction: string;
    referenceImageUrls: string[];
  }) => Promise<void>;
  onClose: () => void;
}
```

**로컬 상태:**
```ts
instruction:      string          // 지시어
selectedRefUrls:  string[]        // uploadedUrls에서 선택
pcUploadedUrls:   string[]        // PC 업로드 결과 URL
showRefPicker:    boolean         // 참고 이미지 선택 UI 표시
pcUploading:      boolean         // PC 업로드 진행 중
pcUploadError:    string | null   // PC 업로드 에러
```

**레퍼런스 상한:** `selectedRefUrls + pcUploadedUrls` 합산 **최대 2장** 한 곳에서 강제.

**PC 업로드:** 패널 내에서 직접 `/api/listing/upload-image` 호출. 결과는 패널 unmount 시 버려지는 임시값 (부모 상태 불필요).

---

### 수정 파일

#### `SectionCard.tsx`

| 항목 | 변경 |
|---|---|
| `onSceneRegenerate` prop | 제거 |
| `onSceneEdit` prop 추가 | `(section, opts) => Promise<void>` |
| `uploadedUrls` prop 추가 | `string[]` |
| `isSceneEditing` prop 추가 | `boolean` |
| `sceneEditError` prop 추가 | `string \| null` |
| 기존 로컬 `isRegenerating` | 제거 (부모 prop으로 통합) |
| "재생성" 버튼 | "씬 편집 ▾" 버튼으로 교체 + SceneEditPanel 마운트 |

모든 새 props는 `optional`로 선언해 Step3 등 기존 사용처의 회귀를 방지한다.

#### `DetailPageEditor.tsx`

```ts
// 추가 prop
uploadedUrls?: string[];   // SectionCard로 전달
```

#### `DetailMakerClient.tsx`

**편집 핸들러:**
```ts
// 기존
handleSceneRegenerate(section)

// 신규 교체
handleSceneEdit(section, { instruction, referenceImageUrls })
  1. POST /api/ai/generate-scene-image
       baseImageUrl: section.attachedImages[0]?.url  // 없으면 새 생성
       referenceImageUrls
       instruction
       sectionType: section.type === 'hero' ? 'hero' : 'lifestyle'
       productInfo: { headline: section.content.headline }
  2. imageBase64 반환 → POST /api/image/upload-ai → 영구 URL
  3. section.attachedImages 업데이트
  4. refreshRenderedHtml()   // ← 반드시 호출
```

**상태 관리:**
```ts
// 단일값 (동시 편집 불필요)
editingSectionId: string | null
sceneEditError: { sectionId: string; message: string } | null

// 패널 닫히거나 다른 섹션 열릴 때 error 무효화
```

**Race condition 방지:** 기존 `sceneGenIdRef` 패턴을 `sceneEditIdRef`로 동일하게 적용.

**Undo:** 편집 전 이전 URL 1개 보관 → "되돌리기" 버튼 노출.
```ts
prevSceneUrls: Map<sectionId, string>  // 편집 직전 URL 저장
```

**DetailPageEditor에 추가 전달:**
```tsx
<DetailPageEditor
  ...
  uploadedUrls={uploadedUrls}        // 추가
  onSceneEdit={handleSceneEdit}      // onSceneRegenerate 대체
/>
```

---

## 엣지케이스 처리

| 케이스 | 처리 방법 |
|---|---|
| baseImageUrl fetch 실패 | 조용한 폴백 X — 명시적 에러 반환, 패널에 표시 |
| base 씬 + 원본 상품 혼합 | 프롬프트에서 `[BASE]` / `[REF]` 역할 라벨링으로 오인 방지 |
| 레퍼런스 상한 초과 | 패널에서 합산 2장 강제, 초과 선택 불가 |
| Race condition | `sceneEditIdRef` 로 구식 응답 폐기 |
| 편집 중 패널 닫기 | `AbortController`로 진행 중 요청 취소 |
| Step3 등 외부 사용처 | props optional 유지 → 해당 뷰에서 씬 편집 비활성 (의도된 동작) |
| 에러 메시지 | 기존 route의 ANTHROPIC / overloaded 한글 매핑 동일하게 적용 |

---

## 테스트

- `SceneEditPanel` 단위: 패널 열기/닫기, 레퍼런스 선택 상한, PC 업로드 에러 표시, 지시어 입력 → onEdit 호출
- `generate-scene-image` route: `baseImageUrl` 있을 때 편집 분기, 없을 때 기존 생성 분기, fetch 실패 시 에러
- `DetailMakerClient` 통합: 편집 성공 → attachedImages 갱신 + refreshRenderedHtml 호출, undo URL 보관

---

## 변경 파일 요약

| 파일 | 종류 |
|---|---|
| `src/app/api/ai/generate-scene-image/route.ts` | 수정 (필드 추가, 분기 로직) |
| `src/components/listing/detail-editor/SceneEditPanel.tsx` | 신규 |
| `src/components/listing/detail-editor/SectionCard.tsx` | 수정 |
| `src/components/listing/detail-editor/DetailPageEditor.tsx` | 수정 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 |
