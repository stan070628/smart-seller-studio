# AI 편집 — 텍스트·표 파이프라인 재설계

**날짜:** 2026-05-17  
**상태:** 승인됨

## 배경

기존 `/api/ai/edit-image-text` 파이프라인은 Claude Vision OCR로 텍스트 bbox(좌표)를 추정한 뒤 흰색 마스킹 + 텍스트 오버레이 방식을 사용했다. bbox 추정이 픽셀 단위로 부정확하고, 마스킹 아티팩트가 발생해 상품 상세페이지에 사용할 수 없는 수준의 결과물이 나왔다.

## 목표

AiEditModal의 "텍스트·표" 섹션 버튼 3개(강조/가독성, 자동 다듬기, 표 데이터 수정)를 **텍스트 추출 → 새 클린 이미지 생성** 방식으로 통일한다.

## 결정 사항

| 항목 | 결정 |
|------|------|
| 출력 방식 | 원본 이미지 버리고 완전히 새 이미지 생성 (A안) |
| 버튼 동작 | 3개 모두 동일 파이프라인으로 통일 |
| 프롬프트 입력창 | 유지 (사용자 추가 지시 가능) |
| 디자인 스타일 | 미니멀 클린 (흰 배경, 검정 헤더, 얇은 구분선) |
| 이미지 크기 | 내용 기반 자동 (너비=원본, 높이=내용량 기준 자동) |
| 지원 콘텐츠 | 표 + 일반 텍스트 블록 모두 지원 (자동 감지) |
| 구현 방식 | 기존 resvg-js 파이프라인 재활용 (A안, 추가 패키지 없음) |

## 새 파이프라인

```
extractStructuredContent  →  applyUserInstruction  →  renderAsImage
(Claude Vision OCR)          (Claude Haiku)            (SVG → resvg-js → PNG)
```

기존 파이프라인과 비교:

| | 기존 | 새로운 |
|---|---|---|
| OCR 출력 | bbox 좌표 + 텍스트 | 구조화된 표/텍스트 JSON |
| 렌더링 | 마스킹 + 오버레이 | 전체 SVG 새로 생성 |
| 한글 정확도 | 위치 오류 발생 | 항상 정확 |

## 상세 설계

### 1. extractStructuredContent (OCR)

Claude Sonnet Vision이 이미지에서 구조화된 데이터를 반환한다.

```typescript
interface StructuredContent {
  type: 'table' | 'text';
  title?: string;        // 이미지 상단 제목 (예: "SIZE CHART")
  imageWidth: number;    // 원본 이미지 너비 (px)
  table?: {
    headers: string[];
    rows: string[][];
  };
  textBlocks?: Array<{
    text: string;
    bold: boolean;
  }>;
}
```

- bbox 좌표 추정 완전 제거
- 표/텍스트 자동 감지. 표 감지 실패 시 `text` 타입으로 폴백

### 2. applyUserInstruction (사용자 지시 적용)

Claude Haiku가 구조화된 데이터 + 사용자 프롬프트를 받아 수정된 `StructuredContent`를 반환한다.

- 프롬프트가 데이터 변경을 요구하면 수정 적용 (행 삭제, 셀 값 변경 등)
- 강조/가독성 기본 프롬프트: "핵심 숫자와 키워드를 명확하게 정리해주세요" → 데이터 그대로 유지. `renderAsImage`가 순수 숫자/단위 셀을 자동 bold 처리 (별도 플래그 불필요)
- 자동 다듬기 기본 프롬프트: "텍스트를 자연스러운 한국어로 교정해주세요" → 어색한 표현만 수정

### 3. renderAsImage (SVG → PNG)

미니멀 클린 스타일로 전체 이미지를 SVG로 생성 후 resvg-js로 PNG 변환한다.

**레이아웃 규칙:**

| 요소 | 스펙 |
|------|------|
| 너비 | 원본 이미지 너비 (최소 400px, 최대 1200px) |
| 여백 | 상하좌우 24px |
| 제목 배경색 | `#111827` |
| 제목 텍스트 | 흰색, Pretendard Bold, letter-spacing 2px |
| 헤더 행 배경 | `#f9fafb`, Bold |
| 짝수 행 | `#ffffff` / 홀수 행: `#f9fafb` 교대 |
| 구분선 | `#e5e7eb` 1px |
| 행 높이 | 32px |
| 컬럼 너비 | 각 컬럼 최대 텍스트 길이 비율로 자동 배분 |
| 텍스트 블록 줄간격 | 1.6 |
| 높이 (표) | 행 수 × 32px + 헤더 행(36px) + 제목(48px) + 여백으로 자동 계산 |
| 높이 (텍스트) | 텍스트 블록 수 × 줄 높이(28px) + 제목(48px) + 여백으로 자동 계산 |

### 4. UI 변경 (AiEditModal.tsx)

버튼 기본 프롬프트만 변경. UI 구조는 유지.

| 버튼 | 새 기본 프롬프트 |
|------|----------------|
| 강조/가독성 | `핵심 숫자와 키워드를 명확하게 정리해주세요` |
| 자동 다듬기 | `텍스트를 자연스러운 한국어로 교정해주세요` |
| 표 데이터 수정 | `표의 [셀명]을 [새값]으로 바꿔주세요` (기존 유지) |

모든 버튼은 `useTextEditRoute = true`로 새 파이프라인을 사용한다.

## 변경 파일

1. `src/lib/ai/image-text-edit.ts` — `extractTextRegions`, `parseEditIntent`, `composeTextOnImage` 함수를 `extractStructuredContent`, `applyUserInstruction`, `renderAsImage`로 교체
2. `src/app/api/ai/edit-image-text/route.ts` — 함수 호출 순서 업데이트, 에러 메시지 수정
3. `src/components/listing/AiEditModal.tsx` — `DETAIL_QUICK_PROMPTS_TEXT` 배열 프롬프트 문자열 수정

## 에러 처리

| 상황 | 에러 메시지 |
|------|------------|
| OCR 결과 비어있음 | "이미지에서 텍스트를 인식하지 못했습니다" |
| 표/텍스트 구분 실패 | `text` 타입으로 폴백 (에러 없음) |
| 렌더링 실패 | "이미지 생성 중 오류가 발생했습니다" |
