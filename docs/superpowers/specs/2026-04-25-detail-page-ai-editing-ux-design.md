# Detail Page AI Editing UX Redesign

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** 상세페이지 섹션을 두 케이스(HTML 있음 / 사진 첨부)에 맞게 자동으로 전환되는 AI 편집 UX로 개선한다.

**Architecture:** `detailHtml` 상태 유무로 UI를 자동 분기. HTML이 있으면 편집 모드, 없으면 사진 첨부 → HTML 생성 모드.

**Tech Stack:** Next.js App Router, Claude Haiku (프롬프트 제안), Claude Sonnet (HTML 편집/생성), Gemini 2.5 Flash Image (이미지 편집)

---

## 케이스 1: HTML 있음 (URL에서 가져온 경우)

### UI 구성
```
[상세페이지 미리보기 iframe]

AI 추천 지시문 (3개 카드)
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  설명 강화형  │ │  레이아웃정리형│ │  모바일최적화형│
└──────────────┘ └──────────────┘ └──────────────┘

[지시문 입력란___________________________]
[AI 편집]                    [처음부터 재생성]
```

### 동작
- **AI 추천 지시문 3개**: `suggest-thumbnail-prompts` API, `context: 'detail-html'` (신규) → HTML 편집 지시문 제안
- **AI 편집**: 선택된 카드 or 직접 입력 지시문 → `POST /api/ai/edit-detail-html` (기존)
- **처음부터 재생성**: `POST /api/ai/edit-detail-html` with instruction `"상품 정보를 바탕으로 상세페이지를 처음부터 완전히 재작성해줘"`

---

## 케이스 2: HTML 없음 (사진 첨부 모드)

### UI 구성
```
┌─────────────────────────────────────────┐
│    📷 사진을 끌어다 놓거나 클릭하여 추가  │
└─────────────────────────────────────────┘

AI 추천 편집 프롬프트 (3개 카드)
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  배경 정리형  │ │  특징 강조형  │ │ 라이프스타일형│
└──────────────┘ └──────────────┘ └──────────────┘

첨부된 사진 목록:
[사진 썸네일]  [AI 편집 ▼ (프롬프트 선택 or 직접입력)]  [삭제]
[사진 썸네일]  [AI 편집 ▼]  [삭제]

[HTML 생성] ← 편집된 사진 URLs + 상품정보 → 신규 HTML
```

### 동작
- **AI 추천 편집 프롬프트 3개**: `suggest-thumbnail-prompts`, `context: 'detail'` (기존)
- **각 사진 AI 편집**: 선택된 프롬프트 or 직접 입력 → `POST /api/ai/edit-thumbnail` → 결과 URL로 해당 슬롯 교체
- **HTML 생성**: 현재 `detailImages` URL 배열 + 상품명/가격 → `POST /api/ai/generate-detail-html` (imageUrls 파라미터 추가 필요)

---

## 필요한 코드 변경

### 1. `suggest-thumbnail-prompts` API — `context: 'detail-html'` 추가

**파일**: `src/app/api/ai/suggest-thumbnail-prompts/route.ts`

- `RequestSchema`의 context enum에 `'detail-html'` 추가
- `buildDetailHtmlSystemPrompt()` 함수 신규 추가:
  ```
  HTML 편집 지시문 3가지 제안:
  1. 설명 강화형: 상품 설명을 더 구체적이고 설득력 있게
  2. 레이아웃 정리형: 이미지/텍스트 구성을 모바일 친화적으로
  3. 특징 강조형: 상품의 핵심 특징 3가지 부각
  ```
- `POST` 핸들러에서 `context === 'detail-html'` 분기 처리

### 2. `generate-detail-html` API — `imageUrls` 파라미터 추가

**파일**: `src/app/api/ai/generate-detail-html/route.ts`

- `RequestSchema`에 `imageUrls: z.array(z.string().url()).max(5).optional()` 추가
- `images`가 없고 `imageUrls`가 있을 때: 서버에서 각 URL fetch → base64 변환 → 기존 로직 활용
- `images`와 `imageUrls` 둘 다 없으면 400 에러

### 3. `page.tsx` Section 4 UI 분기

**파일**: `src/app/listing/auto-register/page.tsx`

**상태 추가 없음** — 기존 `detailHtml`, `detailImages`, `detailSuggestedPrompts` 등 활용

**UI 분기 로직**:
```tsx
{detailHtml ? (
  <DetailHtmlEditSection ... />   // 케이스 1
) : (
  <DetailPhotoSection ... />       // 케이스 2
)}
```

**케이스 1 핸들러**:
- `handleDetailHtmlEdit(instruction: string)` → `POST /api/ai/edit-detail-html`
- `handleDetailHtmlRegenerate()` → 같은 API, 완전 재작성 instruction
- `handleGenerateDetailHtmlPrompts()` → `context: 'detail-html'` 로 프롬프트 생성

**케이스 2 핸들러** (기존 것 그대로 + HTML 생성 추가):
- `handleDetailImgAiEdit(idx)` → 기존
- `handleDetailFileChange()` → 기존
- `handleGenerateDetailHtml()` (신규): `detailImages` URL 배열 → `generate-detail-html` API → `setDetailHtml(html)`

**UI 전환 관련**:
- HTML 생성 성공 시 `detailHtml`이 set되면 자동으로 케이스 1 UI로 전환됨
- 케이스 1에서 "사진으로 다시 시작" 링크 추가 → `setDetailHtml(null)` + `setDetailImages([])`

---

## 데이터 흐름

### 케이스 1 흐름
```
URL 입력 → parse-url API → detailHtml 설정
→ 케이스 1 UI 표시
→ suggest-thumbnail-prompts (context:'detail-html') → 지시문 3개 표시
→ 지시문 선택/입력 → edit-detail-html API → detailHtml 갱신 → 미리보기 갱신
```

### 케이스 2 흐름
```
사진 첨부 (파일 선택 or 드래그앤드롭) → Supabase Storage 업로드 → detailImages에 URL 추가
→ 케이스 2 UI 표시
→ suggest-thumbnail-prompts (context:'detail') → 이미지 편집 프롬프트 3개 표시
→ 사진별 AI 편집: edit-thumbnail API → 해당 슬롯 URL 교체
→ [HTML 생성] → generate-detail-html API (imageUrls) → detailHtml 설정
→ 자동으로 케이스 1 UI로 전환 (미리보기 + HTML 편집 모드)
```

---

## 주요 결정 사항

| 항목 | 결정 | 이유 |
|------|------|------|
| UI 전환 방식 | 조건부 자동 전환 (detailHtml 유무) | 사용자가 선택 없이 맥락에 맞게 자동 표시 |
| 케이스 2 사진 편집 후 | AI가 새 HTML 생성 (Option C) | 사진 여러 장을 조합해 완성도 있는 상세페이지 생성 |
| 케이스 1 AI 편집 | 지시문 편집 + 완전 재생성 모두 제공 | 유연성 확보 |
| generate-detail-html | imageUrls 파라미터 추가 (URL fetch 서버사이드) | 클라이언트에서 base64 변환 불필요, 보안 |
| suggest-thumbnail-prompts | context 확장 (detail-html 추가) | 기존 API 재사용, 케이스별 특화 프롬프트 |
