# 상세페이지 텍스트 스타일 시스템 설계

## 배경

현재 상세페이지 섹션 텍스트는 팔레트 5개로 전체 색상을 관리하며, 텍스트 자체에 별도 스타일이 없어 모든 섹션이 동일한 인상을 준다. 사용자 요청: "이미지 위에 채워지는 텍스트를 다채롭게 만들고 싶어."

Opus 4.8 검토 결과, gradient/glow/outline 텍스트 효과는 쿠팡 인앱 웹뷰에서 텍스트 증발, WCAG 대비 붕괴, 한글 판독 불가 등의 위험이 있음. 대신 **구조적 위계**로 접근: 부분 강조(inline highlight), 형광펜(highlighter), Eyebrow 레이블이 실제 전환율에 기여하는 패턴.

## 변경 범위

### 1. `DetailSection` 타입 확장

**파일:** `src/types/detail-page.ts`

```typescript
interface DetailSection {
  // 기존 필드 유지
  id: string;
  type: SectionType;
  order: number;
  content: string;           // **text** 와 ==text== 마크업 허용
  attachedImages: AttachedImage[];
  aiInstruction?: string;
  // 신규 필드
  eyebrow?: string;          // 섹션 상단 소형 레이블 ("BEST SELLER", "신상품" 등)
}
```

`content` 문자열에 두 가지 인라인 마크업 허용:
- `**텍스트**` → accent 색 + font-weight:700 + font-size 110% (숫자·키워드 강조)
- `==텍스트==` → 배경 형광펜 효과 (글자 아닌 배경에 반투명 그라디언트)

### 2. `PaletteConfig` 타입 및 팔레트 확장

**파일:** `src/lib/detail-page/palette-config.ts`

```typescript
interface PaletteConfig {
  // 기존 필드 유지 (수정 없음)
  bg: string;
  text: string;
  textSub: string;
  accent: string;
  accentTextColor: string;
  cardBg: string;
  border: string;
  bgAlt: string;
  // 신규 필드
  categories: string[];      // AI 추천 매핑용. 예: ['뷰티', '스킨케어', '여성패션']
  labelColor: string;        // eyebrow 레이블 텍스트 색상
  fontStyle: 'serif' | 'sans';  // 팔레트별 기본 폰트. DetailPageTheme.fontStyle이 설정되면 그것이 우선, 없으면 이 값 사용
}
```

`PaletteName` 타입에 4개 추가:
```typescript
type PaletteName =
  | 'warm_cream' | 'cool_white' | 'deep_dark' | 'nature_green' | 'tech_navy'  // 기존
  | 'rose_soft' | 'cream_cozy' | 'sunset_warm' | 'fresh_mint';                 // 신규
```

**신규 팔레트 4개 스펙** (WCAG AA 검증 필수 — 신규 팔레트 추가 시 `accentTextColor` 대비율 4.5:1 이상 확인):

| 팔레트 | bg | text | accent | categories |
|--------|-----|------|--------|------------|
| rose_soft | #fce4ec | #880e4f | #e91e8c | 뷰티, 스킨케어, 여성패션 |
| cream_cozy | #fdf6e3 | #4a3728 | #8b5a2b | 홈카페, 식품, 유아 |
| sunset_warm | #fff3e0 | #3e2723 | #e65100 | 식품, 주방, 라이프스타일 |
| fresh_mint | #e8f8f5 | #1b5e20 | #27ae60 | 헬스케어, 건기식, 유아 |

**카테고리 태그 매핑 (기존 5개에도 추가):**

| 팔레트 | categories |
|--------|------------|
| warm_cream | 홈리빙, 식품, 반려동물, 인테리어 |
| cool_white | 디지털, 가전, B2B, 사무용품 |
| deep_dark | 패션, 뷰티(프리미엄), 주류, 명품 |
| nature_green | 유기농식품, 건강식품, 반려동물, 아웃도어 |
| tech_navy | IT, 디지털, 스포츠, 자동차용품 |

### 3. 마크업 파서 유틸 함수

**파일:** `src/lib/detail-page/inline-markup.ts` (신규 생성)

```typescript
// content 문자열의 **...** 와 ==...== 를 인라인 HTML span으로 변환
function renderInlineMarkup(text: string, accent: string): string

// 예시 출력:
// **72시간** → <span style="color:{accent};font-weight:700;font-size:110%;">72시간</span>
// ==장벽 강화== → <span style="background:linear-gradient(transparent 55%,{accent}33 55%);padding:0 2px;">장벽 강화</span>
```

이 함수는 `section-renderer.ts`의 모든 `content` 렌더링 경로에서 호출.

### 4. 섹션 렌더러 업데이트

**파일:** `src/lib/detail-page/section-renderer.ts`

변경 사항:
1. `renderInlineMarkup()` 호출 — 모든 섹션 type에서 `content` 렌더 전 적용
2. `eyebrow` 필드 렌더링 — 섹션 상단에 소형 대문자 레이블 추가:
   ```html
   <!-- eyebrow 있을 때 섹션 최상단에 삽입 -->
   <div style="font-size:10px;letter-spacing:3px;color:{labelColor};text-transform:uppercase;
               font-weight:600;margin-bottom:8px;">{eyebrow}</div>
   ```
3. `clean` textEffect의 한글 최적화: `font-weight:300` → `font-weight:400`, `letter-spacing:2px` → `letter-spacing:-0.02em`
4. 반응형 폰트: hero headline `font-size:32px` → `font-size:clamp(20px,4vw,32px)`

### 5. AI 팔레트 추천 2단계 파이프라인

**파일:** `src/lib/detail-page/palette-recommender.ts` (신규 생성)

```typescript
// Stage 1: 카테고리 코드 → 후보 팔레트 2~3개 (결정론적, LLM 아님)
function getCandidatePalettes(categoryCode: string): PaletteName[]

// Stage 2: Gemini가 후보 + 이미지 주조색으로 최종 1개 선택
async function recommendPalette(
  candidates: PaletteName[],
  dominantColors: string[],   // 상품 이미지 주조색 HEX 배열
  productSummary: string      // headline + category
): Promise<PaletteName>
```

**Stage 1 카테고리 룰 예시:**
```
뷰티/스킨케어 → [rose_soft, cool_white, deep_dark]
식품/홈카페   → [cream_cozy, warm_cream, sunset_warm]
건강/헬스케어 → [fresh_mint, nature_green, cool_white]
IT/디지털     → [tech_navy, cool_white, deep_dark]
패션          → [deep_dark, cool_white, rose_soft]
기타          → [cool_white, warm_cream, nature_green]
```

**Stage 2 Gemini 프롬프트:** 후보 팔레트 ID + 각 팔레트의 `bg`/`accent` HEX + 상품 이미지 주조색을 주고, 무드명 없이 팔레트 ID만 출력. fallback: `cool_white`.

**호출 위치:** `src/app/api/listing/assets/generate/route.ts` — `generateDetailHtml` 완료 직후 실행, `recommendedPalette` 를 응답에 포함. 프론트에서 `detailPageTheme.palette` 자동 적용.

### 6. `ThemeBar` UI 업데이트

**파일:** `src/components/listing/detail-editor/ThemeBar.tsx`

- 팔레트 선택 버튼 5개 → 9개로 확장
- 각 버튼에 `categories` 툴팁 표시 (hover 시)
- 자동 추천된 팔레트에 "AI 추천" 뱃지 표시 (처음 한 번만)

## 변경하지 않는 것

- `ai-html-builder.ts` — 초기 HTML 빌드 로직은 건드리지 않음
- 기존 5개 팔레트의 HEX 값 및 `accentTextColor` — WCAG AA 자산 보존
- `buildAiDetailPageHtml`, `appendPrivacyFooter` — 범위 외
- `DetailPageTheme.fontStyle`, `imageLayout` — 그대로 유지

## 검증

1. `**숫자**`, `==핵심어==` 마크업이 포함된 content로 섹션 렌더링 → HTML 확인
2. `eyebrow` 필드가 있는 섹션이 레이블을 정상 표시하는지 확인
3. 신규 팔레트 4개 accent 색상의 WCAG AA 대비율 계산 (기준: 4.5:1)
4. AI 추천 흐름: 뷰티 상품 → rose_soft, IT 상품 → tech_navy 추천 확인
5. ThemeBar에서 9개 팔레트 선택 후 미리보기 반영 확인
6. 기존 5개 팔레트 렌더링 회귀 없음 확인
