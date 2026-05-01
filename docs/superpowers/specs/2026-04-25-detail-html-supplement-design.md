# 상세페이지 HTML 보충 모드 설계

**Goal:** URL에서 가져온 기존 상세페이지 HTML을 기반으로, AI 편집 지시문과 이미지가 이를 보충/추가하는 방식으로 변경

**Architecture:** 3곳 독립 패치 (API 2개 + page.tsx 1곳). 엔드포인트 신설 없음.

**Tech Stack:** Next.js App Router API Route, Gemini/Claude AI, TypeScript

---

## 변경 1: `src/app/api/ai/edit-detail-html/route.ts`

`EDIT_SYSTEM_PROMPT` 교체:
- 기존: "수정하되, HTML 구조와 이미지 태그는 그대로 유지하세요"
- 변경: "기존 HTML을 기반으로 지시문에 따라 내용을 보충·추가하되, 기존 텍스트·이미지·구조는 절대 삭제/교체하지 마세요. 지시문이 없는 섹션은 그대로 둡니다."

`buildUserPrompt`는 이미 `currentHtml` 전달 중 → 변경 없음.

## 변경 2: `src/app/api/ai/generate-detail-html/route.ts`

- Request body에 `existingHtml?: string` 추가
- `existingHtml` 있을 때: 기존 HTML을 base로, 이미지를 적절한 위치에 삽입하는 프롬프트
- `existingHtml` 없을 때: 기존 동작 유지 (이미지만으로 신규 생성)

## 변경 3: `src/app/listing/auto-register/page.tsx`

`handleGenerateHtmlFromImages` 내 fetch body에 `existingHtml: detailHtml` 추가 (한 줄).
