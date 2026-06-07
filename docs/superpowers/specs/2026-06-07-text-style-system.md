# 상세페이지 텍스트 스타일 시스템 설계

## 배경

현재 상세페이지 섹션 텍스트는 팔레트 5개로 전체 색상을 관리하며, 텍스트 자체에 별도 스타일이 없어 모든 섹션이 동일한 인상을 준다. 사용자 요청: "이미지 위에 채워지는 텍스트를 다채롭게 만들고 싶어."

Opus 4.8 검토 결과, gradient/glow/outline 텍스트 효과는 쿠팡 인앱 웹뷰에서 텍스트 증발, WCAG 대비 붕괴, 한글 판독 불가 등의 위험이 있음. 대신 **구조적 위계**로 접근:
- **Inline Highlight** (`**텍스트**`): 숫자·키워드를 accent 색+굵게 강조
- **Highlighter Pen** (`==텍스트==`): 배경 형광펜 효과 (글자 아닌 배경에 반투명색)
- **Eyebrow 레이블**: 섹션 상단 소형 대문자 레이블 ("BEST SELLER", "신상품")

## 변경 범위

### 1. `DetailSection` 타입 확장

**파일:** `src/types/detail-page.ts`

`eyebrow` 필드만 추가. `content: SectionContent` 타입은 변경하지 않음.

```typescript
interface DetailSection {
  // 기존 필드 — 변경 없음
  id: string;
  type: SectionType;
  order: number;
  content: SectionContent;       // discriminated union, 변경 없음
  attachedImages: AttachedImage[];
  aiInstruction?: string;
  // 신규 필드
  eyebrow?: string;              // 섹션 상단 소형 레이블. 예: "BEST SELLER", "신상품", "MD추천"
                                 // analyze-product API가 생성, 사용자가 AI 지시어로 수정 가능
}
```

---

### 2. 인라인 마크업 파서

**파일:** `src/lib/detail-page/inline-markup.ts` (신규 생성)

`SectionContent`의 개별 텍스트 필드(`headline`, `description`, `step` 등)에 경량 마크업 허용:
- `**텍스트**` → accent 색 + font-weight:700 + font-size 110%
- `==텍스트==` → 배경 형광펜 (글자 안전, 배경만 반투명)

**XSS 안전 설계:** 파서는 raw 텍스트를 받아 내부에서 `escapeHtml()`을 처리함.
`editableText()`는 raw 텍스트를 내부 `escapeHtml()`로 이스케이프하므로,
마크업 필드에는 `editableText()` 대신 별도 `editableMarkupText()`를 사용.

```typescript
// raw 텍스트 → 마크업 처리 + XSS 이스케이프된 HTML 반환
// accent: HEX 색상값 (예: "#2563EB")
function renderInlineMarkup(rawText: string, accent: string): string
// 동작:
// 1. **...** / ==...== 마커로 분리
// 2. 각 세그먼트를 개별 escapeHtml() 처리
// 3. 마크업 세그먼트만 span으로 감쌈
//
// **72시간** → <span style="color:{accent};font-weight:700;font-size:110%;">72시간</span>
// ==장벽 강화== → <span style="background:rgba(R,G,B,0.2);padding:0 2px;">장벽 강화</span>
//   ※ rgba()를 사용 — 8자리 hex (#color33)는 구형 웹뷰 미지원 위험

// data-edit-path span으로 감싸는 버전 (마크업 필드 전용)
function editableMarkupText(path: string, rawValue: string, accent: string): string
// → <span data-edit-path="{escapedPath}">{renderInlineMarkup(rawValue, accent)}</span>
```

**마크업 적용 대상 필드** (과도한 중첩 방지를 위해 아래 필드만 적용):

| SectionType | 적용 필드 | 제외 필드 |
|-------------|----------|----------|
| `hero` | `subheadline` | `headline` (32px 대형 — 적용 시 중첩 과함) |
| `selling_points` | `points[].description` | `points[].title` (이미 볼드) |
| `features` | `items[].description` | `items[].title` (이미 볼드) |
| `usage_steps` | `steps[]` | — |
| `warning` | `warnings[]` | — |
| `stats` | 제외 | `stats[].value`는 48px 대형 숫자 — 마크업 불필요 |
| `spec_table` | 제외 | 스펙 표는 구조 데이터 |
| `cta` | 제외 | CTA는 단일 행동 텍스트 |

---

### 3. `PaletteColors` 인터페이스 및 팔레트 확장

**파일:** `src/lib/detail-page/palette-config.ts`

인터페이스명: `PaletteColors` (기존 그대로).

신규 필드 2개 추가 — 기존 5개 팔레트 객체에도 모두 채워야 함:

```typescript
interface PaletteColors {
  // 기존 필드 — 값 변경 없음
  bg: string;
  bgAlt: string;
  text: string;
  textSub: string;
  accent: string;
  border: string;
  cardBg: string;
  accentTextColor: string;
  // 신규 필드
  categories: string[];   // AI 추천 Stage 1 카테고리 매핑용
  labelColor: string;     // eyebrow 레이블 텍스트 색상 (accent와 같거나 더 진한 값)
}
```

`PaletteName` 타입에 4개 추가:

```typescript
type PaletteName =
  | 'warm_cream' | 'cool_white' | 'deep_dark' | 'nature_green' | 'tech_navy'  // 기존
  | 'rose_soft' | 'cream_cozy' | 'sunset_warm' | 'fresh_mint';                 // 신규
```

**기존 5개에 신규 필드 추가값:**

| 팔레트 | categories | labelColor |
|--------|------------|------------|
| `warm_cream` | `['홈리빙', '식품', '반려동물', '인테리어']` | `#7A5C10` |
| `cool_white` | `['디지털', '가전', 'B2B', '사무용품']` | `#2563EB` |
| `deep_dark` | `['패션', '뷰티', '주류', '명품']` | `#FFC107` |
| `nature_green` | `['유기농식품', '건강식품', '반려동물', '아웃도어']` | `#2D6A2D` |
| `tech_navy` | `['IT', '디지털', '스포츠', '자동차용품']` | `#38BDF8` |

**신규 팔레트 4개 전체 스펙:**

※ `accent` on `bg` WCAG AA 기준 4.5:1 이상 필수. 아래 값은 구현 시 실측 검증 후 확정.

```typescript
rose_soft: {
  bg: '#fce4ec', bgAlt: '#ffffff',
  text: '#880e4f', textSub: '#ad1457',
  accent: '#880e4f',        // 검증 필요: #880e4f on #fce4ec
  border: '#f48fb1', cardBg: '#fff5f8',
  accentTextColor: '#ffffff',
  categories: ['뷰티', '스킨케어', '여성패션'],
  labelColor: '#880e4f',
},
cream_cozy: {
  bg: '#fdf6e3', bgAlt: '#ffffff',
  text: '#4a3728', textSub: '#6d4c41',
  accent: '#8b5a2b',        // 검증 필요: #8b5a2b on #fdf6e3
  border: '#e8d5b7', cardBg: '#fffdf5',
  accentTextColor: '#ffffff',
  categories: ['홈카페', '식품', '유아', '반려동물'],
  labelColor: '#8b5a2b',
},
sunset_warm: {
  bg: '#fff3e0', bgAlt: '#ffffff',
  text: '#3e2723', textSub: '#5d4037',
  accent: '#bf360c',        // 검증 필요: #bf360c on #fff3e0 (e65100보다 어두운 값 사용)
  border: '#ffcc80', cardBg: '#fffaf5',
  accentTextColor: '#ffffff',
  categories: ['식품', '주방', '라이프스타일', '홈리빙'],
  labelColor: '#bf360c',
},
fresh_mint: {
  bg: '#e8f8f5', bgAlt: '#ffffff',
  text: '#1b5e20', textSub: '#2e7d32',
  accent: '#1b5e20',        // 검증 필요: #1b5e20 on #e8f8f5
  border: '#a5d6a7', cardBg: '#f0faf5',
  accentTextColor: '#ffffff',
  categories: ['헬스케어', '건기식', '유아', '의약외품'],
  labelColor: '#1b5e20',
},
```

---

### 4. 섹션 렌더러 업데이트

**파일:** `src/lib/detail-page/section-renderer.ts`

변경 1 — `renderInlineMarkup` 호출 (마크업 적용 대상 필드만):

```typescript
// 기존 (예: renderHero)
editableText('content.subheadline', content.subheadline)

// 변경 후
editableMarkupText('content.subheadline', content.subheadline, colors.accent)
```

적용 함수·필드: `renderHero`(subheadline), `renderSellingPoints`(description), `renderFeatures`(description), `renderUsageSteps`(steps[]), `renderWarning`(warnings[]).
나머지 필드(`headline`, title류, stats, spec_table, cta)는 기존 `editableText()` 유지.

변경 2 — `eyebrow` 렌더링:

각 섹션 렌더 함수 최상단(섹션 래퍼 `<div>` 안, 콘텐츠 시작 전)에 삽입:

```typescript
// section.eyebrow가 있을 때만 렌더링
${section.eyebrow
  ? `<div style="font-size:10px;letter-spacing:3px;color:${colors.labelColor};
       text-transform:uppercase;font-weight:600;margin-bottom:8px;
       font-family:${fontFamily};">${escapeHtml(section.eyebrow)}</div>`
  : ''}
```

변경 3 — hero headline 반응형 폰트 크기:

```typescript
// 기존: font-size:32px
// 변경: font-size:clamp(20px,4vw,32px)
// 주의: clamp()는 쿠팡 상세 고정폭(~780px)에서 32px로 고정되므로 모바일 외 영향 없음
```

---

### 5. AI 팔레트 추천 2단계 파이프라인

**파일:** `src/app/api/detail-page/analyze-product/route.ts` (기존 파일 수정, 신규 파일 없음)

현재 이 API가 Gemini로 팔레트 추천을 이미 수행함. Stage 1(카테고리 룰)을 앞에 추가하여 정확도를 높임.

**Stage 1 추가: 카테고리 코드 → 후보 팔레트 축소 (결정론적, LLM 아님)**

```typescript
// analyze-product/route.ts 상단에 추가
const CATEGORY_PALETTE_CANDIDATES: Record<string, PaletteName[]> = {
  '뷰티/스킨케어':    ['rose_soft', 'cool_white', 'deep_dark'],
  '식품/홈카페':      ['cream_cozy', 'warm_cream', 'sunset_warm'],
  '건강/헬스케어':    ['fresh_mint', 'nature_green', 'cool_white'],
  'IT/디지털':        ['tech_navy', 'cool_white', 'deep_dark'],
  '패션':             ['deep_dark', 'cool_white', 'rose_soft'],
  '홈리빙':           ['warm_cream', 'cream_cozy', 'cool_white'],
  '반려동물':         ['warm_cream', 'nature_green', 'cream_cozy'],
  '유아/키즈':        ['fresh_mint', 'cream_cozy', 'cool_white'],
  '기타':             ['cool_white', 'warm_cream', 'nature_green'],
};

function getCandidatePalettes(categoryKeyword: string): PaletteName[]
// categoryKeyword: 상품명·설명에서 추출한 카테고리 힌트 (기존 분석 결과 활용)
// 미매핑 시 '기타' 후보 반환
```

**Stage 2 수정: Gemini 프롬프트 + 유효값 Set 갱신**

1. `VALID_PALETTE_NAMES` Set에 신규 4개 추가:
   ```typescript
   'rose_soft', 'cream_cozy', 'sunset_warm', 'fresh_mint'
   ```

2. Gemini 프롬프트(`ANALYZE_SYSTEM_PROMPT`)의 팔레트 설명에 신규 4개 추가:
   ```
   rose_soft: 뷰티, 스킨케어, 여성패션 — 소프트 핑크 계열
   cream_cozy: 홈카페, 식품, 유아 — 따뜻한 크림 계열
   sunset_warm: 식품, 주방 — 웜 오렌지 계열
   fresh_mint: 헬스케어, 건기식, 유아 — 민트 그린 계열
   ```

3. Stage 1에서 축소한 `candidates`를 Gemini 프롬프트 입력에 포함:
   ```
   "다음 후보 팔레트 중에서만 선택하세요: {candidates.join(', ')}"
   ```

4. `dominantColors`를 Gemini에 전달하여 제품 이미지 주조색과의 어울림 반영 (이미 API 응답에 `dominantColors` 있음 — 프롬프트에 활용만 추가).

응답 형식(`recommendedPalette` 필드명) 및 팔레트 검증·fallback 로직은 기존 유지.

---

### 6. `section-parser.ts` — eyebrow 생성

**파일:** `src/lib/detail-page/section-parser.ts`

`contentToSections()` 함수에서 섹션 생성 시 `eyebrow` 필드를 포함:

```typescript
// hero 섹션
{ ..., eyebrow: undefined }   // hero는 eyebrow 없음

// selling_points 섹션
{ ..., eyebrow: undefined }   // 기본 undefined, AI 지시어로 사용자가 추가

// cta 섹션
{ ..., eyebrow: undefined }
```

`eyebrow`는 `analyze-product` API 응답에서 채워지거나, 사용자가 섹션 AI 지시어("상단에 'BEST SELLER' 레이블 추가")로 설정. `contentToSections()` 자체는 항상 `undefined`로 초기화.

---

### 7. `ThemeBar` UI 업데이트

**파일:** `src/components/listing/detail-editor/ThemeBar.tsx`

- `PALETTE_NAMES` 배열, `PALETTE_LABELS`, `PALETTES` 참조 세 곳 모두 9개로 갱신
- 팔레트 버튼 hover 시 `categories` 툴팁 표시
- `analyze-product` API가 추천한 팔레트에 "AI 추천" 뱃지 표시 (첫 생성 시, Zustand `assetsDraft.recommendedPalette` 로 상태 관리)

---

### 8. `edit-section` API — eyebrow 보존

**파일:** `src/app/api/detail-page/edit-section/route.ts`

AI 재생성 시 기존 `eyebrow` 값을 보존:

```typescript
const updatedSection: DetailSection = {
  ...existingSection,
  content: parsedContent,
  eyebrow: existingSection.eyebrow,  // AI 재생성 후에도 eyebrow 유지
};
```

---

## 변경 파일 목록

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `src/types/detail-page.ts` | 수정 | `DetailSection`에 `eyebrow?: string` 추가, `PaletteName` 4개 추가 |
| `src/lib/detail-page/inline-markup.ts` | 신규 | `renderInlineMarkup()`, `editableMarkupText()` |
| `src/lib/detail-page/palette-config.ts` | 수정 | `PaletteColors` 신규 필드 2개, 팔레트 9개, WCAG 검증 |
| `src/lib/detail-page/section-renderer.ts` | 수정 | `editableMarkupText` 호출, eyebrow 렌더링, hero font clamp |
| `src/lib/detail-page/section-parser.ts` | 수정 | `eyebrow: undefined` 초기화 명시 |
| `src/app/api/detail-page/analyze-product/route.ts` | 수정 | Stage 1 카테고리 룰, 신규 팔레트 4개 enum·프롬프트 추가 |
| `src/app/api/detail-page/edit-section/route.ts` | 수정 | eyebrow 보존 로직 |
| `src/components/listing/detail-editor/ThemeBar.tsx` | 수정 | 팔레트 9개, AI 추천 뱃지 |
| `src/__tests__/lib/detail-page/section-renderer.test.ts` | 수정 | font-size/마크업 변경으로 인한 회귀 테스트 갱신 |
| `src/__tests__/api/detail-page/analyze-product.test.ts` | 수정 | 신규 팔레트 enum 테스트 갱신 |

## 변경하지 않는 것

- `ai-html-builder.ts` — 초기 HTML 빌드 로직
- 기존 5개 팔레트의 `bg`/`text`/`accent`/`accentTextColor` HEX 값 — WCAG AA 자산 보존
- `DetailPageTheme` 인터페이스 — `fontStyle`, `imageLayout`, `palette` 필드 변경 없음
- `buildAiDetailPageHtml`, `appendPrivacyFooter`

## 검증

1. `**72시간**` 마크업이 포함된 content로 렌더링 → accent 색 볼드 텍스트 확인
2. `==핵심어==` 마크업 → 배경 형광펜, 글자 색 정상 유지 확인
3. `eyebrow: 'BEST SELLER'`가 있는 섹션 → 소형 레이블 상단 표시 확인
4. 신규 팔레트 4개 `accent` on `bg` WCAG AA 대비율 실측 (기준: 4.5:1)
5. 기존 5개 팔레트 렌더링 회귀 없음 확인 (`section-renderer.test.ts` 전체 통과)
6. `analyze-product` API: 뷰티 상품 → `rose_soft` 추천 확인
7. `editableMarkupText`에 `<script>alert(1)</script>` 입력 → 이스케이프 확인 (XSS 방지)
