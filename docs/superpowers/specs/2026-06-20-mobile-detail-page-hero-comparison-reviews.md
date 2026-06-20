# 모바일 상세페이지 개선: 히어로 임팩트 · 비교 섹션 · 후기 섹션

> 작성일: 2026-06-20
> 범위: 모바일(쿠팡) 상세페이지 AI 생성 파이프라인 (mobileMode=true)

## 1. 배경 및 문제

현재 모바일 상세페이지 AI 생성 결과에 세 가지 문제가 있다.

1. **brand_header 미생성** — AI가 `brandName`을 빈 문자열로 반환하면 섹션이 통째로 생략됨.
2. **히어로 임팩트 부족** — 텍스트가 위 패딩 박스에, 이미지가 아래에 배치되어 스크롤을 멈추게 하는 힘이 없음.
3. **비교·후기 섹션 없음** — 경쟁사 비교(페인포인트 → 반박) 섹션과 리얼 후기 섹션이 존재하지 않아 구매 전환 요소가 부족함.

## 2. 목표

- 히어로를 "전체폭 이미지 + 상단 굵은 텍스트 패널" 구조로 교체
- `comparison` 섹션 신설: 페인포인트 → 반박 → 비교표 → 선택적 이미지
- `reviews` 섹션 신설: 임팩트 타이틀 + ★ 후기 카드
- `brand_header`가 항상 생성되도록 AI 프롬프트 + 파서 수정

## 3. 범위 (YAGNI)

- **포함**: 타입 추가, AI 프롬프트 스키마 확장, 파서 업데이트, 렌더러 추가·수정
- **제외**: 데스크톱 모드 변경 없음 / 기존 point·image_grid·spec_table 렌더러 변경 없음 / 에디터 UI 패널 변경 없음 (섹션 편집은 기존 SectionCard 재사용)

## 4. 타입 시스템 (`src/types/detail-page.ts`)

### 4.1 SectionType 추가

```typescript
type SectionType =
  | 'hero' | 'selling_points' | 'features' | 'stats'
  | 'spec_table' | 'usage_steps' | 'warning' | 'cta'
  | 'brand_header' | 'point' | 'image_grid'
  | 'comparison'   // ← 신규
  | 'reviews';     // ← 신규
```

### 4.2 ComparisonContent

```typescript
export interface ComparisonContent {
  type: 'comparison';
  painPoint: string;     // 기존 제품의 불편함 질문형 (예: "기존 제품은 소음이 심한데…")
  counterClaim: string;  // 반박 선언 (예: "이 제품은 그럴 일 없습니다 ✓")
  items: Array<{
    label: string;       // 비교 항목명 (예: "소음")
    theirValue: string;  // 기존 제품 값 (예: "있음")
    ourValue: string;    // 이 제품 값 (예: "없음")
  }>;
}
```

`attachedImages` 2장이면 기존/이 제품 이미지를 좌우 표시, 0장이면 표만 렌더링.

### 4.3 ReviewsContent

```typescript
export interface ReviewsContent {
  type: 'reviews';
  title: string;    // 예: "고객님들의 100% 리얼 후기"
  eyebrow: string;  // 예: "피치 필통, 연말 선물로도!"
  items: Array<{
    rating: number; // 4 또는 5
    text: string;   // 40자 이내 후기 본문
  }>;
}
```

## 5. AI 프롬프트 (`src/lib/ai/prompts/detail-page.ts`)

### 5.1 MobileDetailPageContent 인터페이스 확장

```typescript
export interface MobileDetailPageContent {
  brandName: string;
  categoryLabelEn: string;
  hook: { eyebrow: string; headline: string; hashtags: string[] };
  points: Array<{ pointLabel: string; headline: string; subheadline: string }>;
  colorOptions: Array<{ label: string; swatchColor: string }>;
  comparison: {                        // ← 신규. null이면 섹션 생략
    painPoint: string;
    counterClaim: string;
    items: Array<{ label: string; theirValue: string; ourValue: string }>;
  } | null;
  reviews: {                           // ← 신규. 항상 포함
    title: string;
    eyebrow: string;
    items: Array<{ rating: number; text: string }>;
  };
  specs: Array<{ label: string; value: string }>;
  warnings: string[];
  ctaText: string;
}
```

### 5.2 MOBILE_DETAIL_PAGE_SYSTEM_PROMPT JSON 스키마 변경

**brandName 지시어 변경:**
- 기존: `"string (브랜드명, 모르면 빈 문자열)"`
- 변경: `"string (상품명에서 브랜드 단어 추출. 불명확하면 상품명 첫 단어 사용. 절대 빈 문자열 금지)"`

**comparison 필드 추가 (spec 안에):**
```json
"comparison": {
  "painPoint": "string (기존 제품의 불편함을 질문형으로, 20자 이내. 예: '기존 제품은 소음이 심한데 불편하지 않으셨나요?')",
  "counterClaim": "string (이 제품이 해결함을 단호하게 선언, 20자 이내. 예: '이 제품은 그럴 일 없습니다 ✓')",
  "items": [
    { "label": "string (비교 항목, 5자 이내)", "theirValue": "string (기존 제품, 5자 이내)", "ourValue": "string (이 제품, 5자 이내)" }
  ]
} | null  // 명확한 비교 우위가 없으면 null
```

**reviews 필드 추가:**
```json
"reviews": {
  "title": "string (예: '고객님들의 100% 리얼 후기', 20자 이내)",
  "eyebrow": "string (제품+상황 한 줄, 15자 이내. 예: '피치 필통, 연말 선물로도!')",
  "items": [
    { "rating": 5, "text": "string (구어체 리얼 후기 어조, 40자 이내)" }
  ]
}
```

**수량 제약 추가:**
- `comparison.items`: 2개 이상 4개 이하 (null이 아닐 때)
- `reviews.items`: 정확히 2개

### 5.3 parseMobileDetailPageResponse 업데이트

- `comparison` 필드: null 허용, 있으면 items 1개 이상 검증
- `reviews` 필드: items 정확히 2개 검증

### 5.4 brandName 폴백 — API 라우트 레벨

`parseMobileDetailPageResponse`는 `productName`을 받지 않으므로 폴백은 API 라우트에서 처리한다.
파싱 직후:

```typescript
if (!mobileContent.brandName.trim()) {
  const fallback = (productName ?? '').split(/\s+/)[0] || 'Brand';
  mobileContent = { ...mobileContent, brandName: fallback };
}
```

파서 자체에는 변경 없음.

## 6. 섹션 파서 (`src/lib/detail-page/section-parser.ts`)

### 6.1 mobileContentToSections 섹션 순서

```
brand_header (항상 포함 — brandName 폴백 보장)
→ hero
→ point × N
→ comparison (null이면 생략)
→ image_grid (남는 이미지)
→ reviews
→ spec_table
→ warning
→ cta
```

### 6.2 comparison 섹션 생성 규칙

- `content.comparison`이 null이면 섹션 생략
- `attachedImages`: 이미지 풀에서 남는 이미지 최대 2장 배정
  - comparison에 배정할 이미지는 point 이후 leftover 중 첫 2장
  - 이 2장은 image_grid에서 제외

## 7. 렌더러 (`src/lib/detail-page/section-renderer.ts`)

### 7.1 renderMobileHero — 전체폭 이미지 + 상단 텍스트 패널

```
┌──────────────────────────────┐
│ ┌────────────────────────┐   │  ← position:absolute; top:0
│ │ eyebrow (필기체, 18px) │   │     background: rgba(0,0,0,0.35)
│ │ headline (30px, 800)   │   │     backdrop-filter: blur(4px)
│ │ #해시 #태그 #들        │   │     padding: 20px
│ └────────────────────────┘   │
│                              │
│        제품 이미지            │  ← width:100%; display:block
│     (attachedImages[0])      │
└──────────────────────────────┘
```

이미지 없을 때: 기존 텍스트 패딩 박스 스타일 유지 (폴백).

### 7.2 renderComparison — 신규

```
┌──────────────────────────────┐
│  painPoint (회색 소문자)      │  padding: 28px 20px 0
│  counterClaim (accent, 굵음) │
├──────┬───────────┬───────────┤
│ 항목 │  기존     │  이제품 ✓ │  ← 비교표 (3컬럼)
│ 소음 │  있음     │  없음     │    기존: 빨간색
│ 향   │  강함     │  무향     │    이제품: accent 색
├──────┴───────────┴───────────┤
│ [기존이미지] [이제품이미지]    │  ← attachedImages 2장일 때만
└──────────────────────────────┘
```

### 7.3 renderReviews — 신규

```
┌──────────────────────────────┐
│  eyebrow (accent, 소문자)    │  padding: 32px 20px
│  title (굵음, 22px, 2줄)    │
├──────────────────────────────┤
│  ★★★★★                      │  카드 배경: cardBg
│  "후기 본문 텍스트…"          │  border-top: accent 4px
├──────────────────────────────┤
│  ★★★★★                      │
│  "두 번째 후기 텍스트…"        │
└──────────────────────────────┘
```

## 8. 에디터 호환성

- `SectionCard`는 `section.type` switch로 라벨을 표시하므로 `SECTION_LABELS`에 두 타입 추가만 하면 됨
- `createEmptySection`에 `comparison`·`reviews` 케이스 추가 (수동 추가 지원)
- `edit-section` API의 `SECTION_TYPE_HINTS`에 두 타입 힌트 추가

## 9. 테스트 계획

- `section-parser.test.ts`: `mobileContentToSections`에 comparison null/비-null 케이스, reviews 케이스
- `section-renderer.test.ts` (또는 `mobile-section-renderer.test.ts`): renderComparison, renderReviews 스냅샷
- `detail-page.ts` 파서 테스트: brandName 폴백, comparison null 파싱, reviews 2개 검증
- 기존 mobile-section-parser 테스트 회귀 확인
