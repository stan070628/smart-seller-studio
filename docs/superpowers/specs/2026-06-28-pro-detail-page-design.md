# PRO 상세페이지 자동 생성 파이프라인 — 설계 스펙

> 작성일: 2026-06-28  
> 목표: 참고 상세페이지 스크린샷 업로드 → Gemini OCR + Claude DSL + Replicate FLUX → 전문 상세페이지 자동 생성

---

## 1. 배경 및 목표

### 현재 상태

현재 Claude Layout 시스템은 `badge / heading / subtext / image / stat_row / bullet_list / columns / spacer` 블록으로 섹션을 생성한다. 덴프스NMN 같은 전문 상세페이지와 품질 차이가 나는 이유:

| 항목 | 현재 | 목표 |
|------|------|------|
| 차트/그래프 | stat_row(숫자만) | SVG 막대그래프, 진행바 |
| 인포그래픽 | 없음 | 공정 흐름도, 아이콘 그리드 |
| 이미지 | 누끼 + 배경 합성 | FLUX 라이프스타일 씬 |
| 데이터 입력 | 수동 | OCR 자동 추출 + 검수 |

### 목표

참고 상세페이지 스크린샷(경쟁사/샘플)을 올리면 Gemini가 차트 데이터를 읽고, Claude가 전체 페이지를 설계하고, SVG 차트와 FLUX 이미지가 자동 생성되는 파이프라인을 구축한다.

---

## 2. 사용자 플로우

```
[PRO 모드 진입]
       ↓
[Step 1] 상품 정보 + 참고 스크린샷 업로드 (최대 8장)
       + 제품 누끼 이미지 업로드 (FLUX용)
       ↓
[Step 1.5] OCR 검수 UI ← Opus 지적: 반드시 필요
  Gemini가 추출한 차트 데이터를 사용자가 확인/수정
  임상 수치 오류 방지
       ↓
[Step 2] 생성 (SSE로 진행률 실시간 표시)
  ├── Claude DSL 생성 (전체 페이지 설계)
  ├── SVG 차트 렌더링 (서버에서 직접)
  │     └── PNG fallback 렌더링 (쿠팡/스마트스토어 호환)
  └── Replicate FLUX Kontext Pro (라이프스타일 이미지)
        └── 실패 시 원본 누끼로 자동 fallback
       ↓
[Step 3] 결과 확인 + 수정
  FLUX 이미지 재생성 버튼 제공
       ↓
[완성] → 기존 DetailPageEditor로 전달
```

---

## 3. 새 DSL 블록 (LayoutBlock 확장)

### Phase 1 — 먼저 구현

#### `bar_chart`
```typescript
{
  type: 'bar_chart',
  title?: string,
  unit?: string,           // y축 단위 (nmol/L 등)
  groups: string[],        // 범례 레이블 ['Placebo', 'NMN']
  groupColors: string[],   // 각 그룹 색상 ['#d1d5db', '#c45e3a']
  items: Array<{
    label: string,         // x축 레이블 (주차, 조건 등)
    values: number[],      // groups 순서에 맞춰 값
  }>,
  showLegend?: boolean,
}
```
렌더링: 인라인 SVG + PNG fallback  
참고: NAD+ 혈중 농도 변화 그래프

#### `progress_bar`
```typescript
{
  type: 'progress_bar',
  items: Array<{
    label: string,
    value: number,         // 0-100
    displayValue?: string, // '100%', '16mg NE'
    highlight?: boolean,   // 강조 색상 사용
  }>,
}
```
렌더링: 순수 HTML/CSS (SVG 불필요)  
참고: 나이아신 기준치 100% 비교

#### `process_flow`
```typescript
{
  type: 'process_flow',
  direction?: 'horizontal' | 'vertical',  // 기본 horizontal
  items: Array<{
    label: string,
    sublabel?: string,
    highlight?: boolean,   // 핵심 공정 강조
  }>,
}
```
렌더링: flex + CSS 화살표  
참고: 원재료 → 발효 → 필터링 → 건조 → 원분리 → 농축

#### `icon_grid`
```typescript
{
  type: 'icon_grid',
  cols?: 2 | 3,            // 기본 3열
  items: Array<{
    icon: string,          // 이모지 또는 SVG 아이콘명
    title: string,
    subtitle?: string,
  }>,
}
```
렌더링: CSS grid  
참고: 제품 특징 6개 아이콘 요약

---

### Phase 2 — 이후 구현

#### `radar_chart`
극좌표계 SVG 수학 계산 필요 (구현 최소 1주).
```typescript
{
  type: 'radar_chart',
  axes: Array<{ label: string, value: number, max?: number }>,
  color?: string,
}
```

#### `timeline`
나이별/단계별 진행 비주얼.
```typescript
{
  type: 'timeline',
  items: Array<{
    stage: string,         // '20대', '30-40대'
    icon?: string,
    value?: string,        // '높음', '낮음'
    highlight?: boolean,
  }>,
}
```

---

## 4. API 설계

### `POST /api/ai/analyze-detail-page`

참고 스크린샷을 Gemini Vision으로 분석해서 구조화된 데이터 반환.

**Request:**
```typescript
{
  images: Array<{ base64: string, mimeType: string }>,  // 최대 8장
  productName: string,
}
```

**Gemini 출력 (Zod 스키마 강제):**
```typescript
const AnalyzedSection = z.object({
  blockType: z.enum(['bar_chart', 'progress_bar', 'process_flow', 'icon_grid', 'stat_row', 'heading_block', 'bullet_list', 'unknown']),
  rawText: z.string(),           // OCR로 읽은 텍스트 전체
  // blockType별 구체적 데이터 (discriminated union)
  extractedData: z.discriminatedUnion('type', [
    z.object({ type: z.literal('bar_chart'), title: z.string(), groups: z.array(z.string()), items: z.array(z.object({ label: z.string(), values: z.array(z.number()) })) }),
    z.object({ type: z.literal('progress_bar'), items: z.array(z.object({ label: z.string(), value: z.number(), displayValue: z.string().optional() })) }),
    z.object({ type: z.literal('process_flow'), items: z.array(z.object({ label: z.string(), highlight: z.boolean().optional() })) }),
    z.object({ type: z.literal('icon_grid'), items: z.array(z.object({ icon: z.string(), title: z.string() })) }),
    z.object({ type: z.literal('stat_row'), items: z.array(z.object({ label: z.string(), value: z.string(), unit: z.string().optional() })) }),
    z.object({ type: z.literal('text'), heading: z.string().optional(), body: z.string().optional() }),
    z.object({ type: z.literal('unknown'), description: z.string() }),
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
  needsReview: z.boolean(),      // confidence가 medium 이하면 true
})
```

**처리 방식:**
- 이미지 최대 8장, 병렬 처리
- Gemini rate limit: 분당 4회 → 큐잉 또는 순차 처리
- 각 이미지당 timeout 30s

**Response:**
```typescript
{
  success: boolean,
  sections: AnalyzedSection[],
  reviewRequired: boolean,  // 하나라도 needsReview이면 true
}
```

---

### `POST /api/ai/generate-pro-layout`

검수된 OCR 데이터 + 상품 정보 → Claude가 전체 DSL 생성.

**Request:**
```typescript
{
  productInfo: {
    name: string,
    points: string[],
    category: string,
  },
  analyzedSections: AnalyzedSection[],  // 검수 완료된 데이터
  imageSlotCount: number,               // 업로드된 제품 이미지 수
}
```

**Claude 시스템 프롬프트 핵심:**
- 기존 `generate-claude-layout-section`의 CLAUDE_SYSTEM 기반
- Phase 1 신규 블록 4종 few-shot 패턴 추가
- `imageSlot` 타입 명시: `flux_lifestyle`(FLUX 생성 필요), `product_nukki`(누끼 원본)

**Response:**
```typescript
{
  success: boolean,
  sections: Array<{
    type: string,
    content: ClaudeLayoutContent,
    imageSlots: Array<{ type: 'flux_lifestyle' | 'product_nukki', promptHint?: string }>,
  }>,
}
```

---

### `POST /api/image/flux-lifestyle`

제품 누끼 이미지 → FLUX Kontext Pro → 라이프스타일 씬.

**Request:**
```typescript
{
  productImageUrl: string,   // Supabase Storage URL (SSRF 검증)
  promptHint: string,        // Claude가 생성한 씬 설명
  sectionContext?: string,   // '추천 섹션', '성분 섹션' 등
}
```

**프롬프트 기본값:**
```
Product photography, [promptHint], clean background, no people, no text overlay, 
premium quality, studio lighting, Korean e-commerce style
```
> 사람 없음(no people) 기본값 — 초상권/저작권 방지

**처리:**
1. FLUX Kontext Pro 호출 (`black-forest-labs/flux-kontext-pro`)
2. 성공: Supabase Storage 업로드 → URL 반환
3. 실패(timeout/에러): `{ success: false, fallback: productImageUrl }` — 원본 누끼 URL 반환

**Rate limit:** 분당 2회 (FLUX 비용 관리)

---

### `GET /api/ai/generate-pro-layout/stream`

SSE 진행률 스트림.

```
event: progress
data: {"step": "analyzing", "current": 3, "total": 8, "message": "이미지 분석 중..."}

event: progress  
data: {"step": "generating", "message": "Claude가 레이아웃을 설계하는 중..."}

event: progress
data: {"step": "rendering", "current": 2, "total": 5, "message": "차트 렌더링 중..."}

event: progress
data: {"step": "flux", "current": 1, "total": 3, "message": "라이프스타일 이미지 생성 중..."}

event: complete
data: {"sections": [...]}
```

---

## 5. 렌더러 확장 (`section-renderer.ts`)

### SVG 차트 + PNG fallback

```typescript
function renderBarChart(block: BarChartBlock): string {
  const svg = buildBarChartSVG(block)  // 인라인 SVG 문자열
  const pngBase64 = svgToPngBase64(svg)  // Sharp로 변환
  
  // PNG를 base64 data URL로 embed → 쿠팡 SVG 호환성 문제 해결
  return `<img src="data:image/png;base64,${pngBase64}" style="width:100%;..." />`
}
```

**Sharp SVG→PNG 변환:**
- 출력 크기: 750px width (모바일 상세페이지 기준)
- 해상도: 2x (Retina 대응)
- 포맷: PNG (투명 배경 지원)

---

## 6. 신규 페이지 라우트

### `/app/listing/[id]/detail-maker-pro/page.tsx`

기존 라우팅 구조(`/listing/[id]/...`)에 맞춰 상품 ID 기반으로 진입.

**진입점:**
- 기존 Detail Maker 화면 상단에 "PRO 모드로 만들기" 버튼 추가
- 클릭 → `/listing/[id]/detail-maker-pro`로 이동

**4개 화면 상태:**
1. `upload` — 참고 이미지 + 제품 사진 업로드
2. `review` — OCR 결과 검수 (Step 1.5)
3. `generating` — SSE 진행률 표시
4. `result` — 완성 확인 + FLUX 재생성

---

## 7. 타입 확장 (`types/detail-page.ts`)

```typescript
// LayoutBlock union에 추가
export type LayoutBlock =
  | BadgeBlock
  | HeadingBlock
  | SubtextBlock
  | ImageBlock
  | StatRowBlock
  | BulletListBlock
  | ColumnsBlock
  | DividerBlock
  | SpacerBlock
  // Phase 1 신규
  | BarChartBlock
  | ProgressBarBlock
  | ProcessFlowBlock
  | IconGridBlock
  // Phase 2 (타입 정의만, 렌더러 미구현)
  | RadarChartBlock
  | TimelineBlock
```

---

## 8. 엣지케이스 및 제약

| 케이스 | 처리 |
|--------|------|
| 참고 이미지 없이 시작 | 상품 정보만으로 Claude DSL 생성 (OCR 단계 skip) |
| 제품 누끼 이미지 없음 | FLUX 단계 skip, imageSlot을 `product_nukki`로 고정 |
| OCR confidence 낮음 | `needsReview: true` → Step 1.5 강제 표시 |
| FLUX 실패 | 원본 누끼 이미지로 자동 fallback |
| 전체 timeout (5분 이상) | 완료된 섹션만 부분 반환, 미완료 섹션은 빈 claude_layout으로 |
| 쿠팡 SVG 미지원 | 모든 차트를 PNG base64로 embed (기본값) |

---

## 9. 구현 범위

### Phase 1 (이번 구현)
- [ ] `BarChartBlock`, `ProgressBarBlock`, `ProcessFlowBlock`, `IconGridBlock` 타입 추가
- [ ] `/api/ai/analyze-detail-page` (Gemini OCR, Zod 강제)
- [ ] `/api/ai/generate-pro-layout` + SSE 스트림
- [ ] `/api/image/flux-lifestyle` (FLUX Kontext Pro + fallback)
- [ ] `section-renderer.ts` — 4개 블록 SVG + PNG fallback 렌더링
- [ ] `/app/listing/[id]/detail-maker-pro/page.tsx` — 4개 화면 상태
- [ ] OCR 검수 UI (Step 1.5)
- [ ] FLUX 재생성 버튼

### Phase 2 (이후)
- [ ] `radar_chart` 블록 (극좌표계 SVG)
- [ ] `timeline` 블록
- [ ] 색상 팔레트 추출 및 DSL 반영

### 제외 범위
- 색상 팔레트 자동 추출 → Phase 2
- 박스플롯 차트 → Phase 2 (OCR 신뢰도 낮음)
- 세계지도 인포그래픽 → 별도 검토

---

## 10. 성능 목표

| 단계 | 목표 시간 |
|------|----------|
| Gemini OCR (8장 순차) | < 60s |
| Claude DSL 생성 | < 30s |
| SVG + PNG 렌더링 | < 5s |
| FLUX Kontext (1장) | < 60s |
| **전체 (이미지 2장 기준)** | **< 3분** |

Vercel `maxDuration: 300` 설정 필요.
