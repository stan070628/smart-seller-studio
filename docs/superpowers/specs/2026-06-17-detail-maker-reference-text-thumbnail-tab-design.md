# 상품상세 자동만들기 — 참고 텍스트 입력 + 썸네일 탭 분리

**날짜**: 2026-06-17  
**상태**: 확정

## 1. 개요

상품상세 자동만들기에 두 가지 기능을 추가한다:

1. **참고 텍스트 입력** — 판매자가 AI 생성 시 참고할 자유 텍스트(경쟁사 카피, 스펙, 셀링 포인트 메모 등)를 선택적으로 입력
2. **썸네일 탭 분리** — 왼쪽 패널을 "상세페이지" / "썸네일" 2탭으로 나눠 각 기능에 집중

## 2. UI 구조

### 2.1 탭 레이아웃

헤더 바로 아래에 2탭 토글을 추가한다.

```
┌─────────────────────────────────┐
│ 상품상세 자동만들기               │
│ 상품명 + 이미지로 1분 만에...     │
├─────────────────────────────────┤
│ [  상세페이지  ] [  썸네일  ]    │
├─────────────────────────────────┤
│  (탭별 콘텐츠)                  │
└─────────────────────────────────┘
```

### 2.2 상세페이지 탭

기존 입력 필드 순서 유지:
- 상품명 (필수)
- 카테고리
- 브랜드명 (선택)
- 참고 이미지 업로드
- 무드 브리프 (CreativeBriefPanel)
- **[신규] 참고 텍스트 입력 섹션** (접기/펼치기)

하단 고정: `✨ AI 상세페이지 생성` 버튼

### 2.3 참고 텍스트 입력 섹션

```
[+ 참고 텍스트 추가]   ← 버튼. 펼쳐지면 [참고 텍스트 ▲ × ]로 변경

펼쳐진 상태:
┌──────────────────────────────────┐
│ 경쟁사 상세페이지, 제품 스펙,     │
│ 셀링 포인트 등 참고할 내용을      │
│ 자유롭게 입력하세요               │
│                                  │
│                          0/3000  │
└──────────────────────────────────┘
```

- `+ 참고 텍스트 추가` 버튼 클릭 → textarea 펼쳐짐
- 접기(▲) 클릭 → textarea 숨김, **내용 보존** (다음 생성 시 여전히 전송)
- × 클릭 → textarea 숨김 + **내용 초기화**
- 글자 수 카운터: 우하단 `{length}/3000`

### 2.4 썸네일 탭

기존 `DetailMakerThumbnailPanel`을 이 탭으로 이동. 참고 이미지는 탭 공통으로 공유된다.

## 3. 데이터 흐름

### 3.1 참고 텍스트 전달 경로

```
DetailMakerClient
  referenceText (string)        ← 새 state
  setReferenceText              ← setter

  → DetailMakerInputPanel props로 전달
  → handleGenerate() 호출 시 API body에 포함

POST /api/ai/generate-detail-html
  body: { ..., referenceText: string | undefined }

buildDetailPageUserPrompt(imageAnalysis, productName, productSpecs, conversationContext, referenceText?)
  → 프롬프트 끝에 추가:
    "\n\n[판매자 참고 텍스트]\n{referenceText}"
```

### 3.2 탭 상태

- `activeTab: 'detail' | 'thumbnail'` — `DetailMakerInputPanel` 내부 state (외부 노출 불필요)
- `showReferenceText: boolean` — textarea 펼침 여부 — `DetailMakerInputPanel` 내부 state

## 4. 컴포넌트 변경 범위

### 4.1 `DetailMakerInputPanel` props 변경

기존 props 유지. 신규 추가 2개:

```ts
referenceText: string
setReferenceText: (v: string) => void
```

썸네일 관련 기존 props(`thumbnailRefUrls`, `isGeneratingThumbnail`, `thumbnailError`, `onGenerateThumbnail`)는 유지하되 썸네일 탭에서만 렌더링.

### 4.2 `DetailMakerClient` 변경

```ts
const [referenceText, setReferenceText] = useState('');

// handleGenerate 내 fetch body에 추가
body: JSON.stringify({
  imageUrls: uploadedUrls,
  productName: fullProductName,
  category,
  mobileMode: true,
  referenceText: referenceText.trim() || undefined,
})
```

### 4.3 API route (`/api/ai/generate-detail-html/route.ts`)

`RequestSchema`에 추가:
```ts
referenceText: z.string().max(3000).optional(),
```

`parseResult.data`에서 `referenceText` 추출 후 `buildDetailPageUserPrompt` 호출 시 전달.

### 4.4 `buildDetailPageUserPrompt` (`/lib/ai/prompts/detail-page.ts`)

파라미터 추가:
```ts
function buildDetailPageUserPrompt(
  imageAnalysis: ProductImageAnalysis,
  productName?: string,
  productSpecs?: Array<{ label: string; value: string }>,
  conversationContext?: ConversationContext,
  referenceText?: string,   // 신규
): string
```

프롬프트 끝에 조건부 추가:
```ts
if (referenceText?.trim()) {
  prompt += `\n\n[판매자 참고 텍스트]\n${referenceText.trim()}`;
}
```

## 5. 엣지 케이스

| 상황 | 동작 |
|------|------|
| 참고 텍스트 없이 생성 | 기존과 동일 (referenceText undefined) |
| 참고 텍스트 접힌 상태로 생성 | 내용 있으면 그대로 전송 |
| × 로 내용 지운 후 생성 | referenceText 빈 문자열 → undefined 처리 |
| 3000자 초과 입력 시도 | maxLength로 브라우저 단에서 차단 |
| 썸네일 탭에서 참고 이미지 0장 | 기존 ThumbnailPanel 경고 메시지 그대로 |

## 6. 변경 파일 목록

1. `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` — 탭 UI + 참고 텍스트 섹션 추가
2. `src/app/listing/detail-maker/DetailMakerClient.tsx` — referenceText state + handleGenerate 수정
3. `src/app/api/ai/generate-detail-html/route.ts` — RequestSchema + buildDetailPageUserPrompt 호출 수정
4. `src/lib/ai/prompts/detail-page.ts` — buildDetailPageUserPrompt 시그니처 + 프롬프트 조립 수정
