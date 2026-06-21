# Rich 상세페이지 업그레이드 설계

**작성일:** 2026-06-21  
**담당:** 상품상세 자동만들기 (`/listing/detail-maker`)

---

## 배경 및 목표

현재 상세페이지 자동 생성 기능은 headline/subheadline/sellingPoints/features/specs/usageSteps/warnings/ctaText의 기본 섹션만 생성한다. 레퍼런스 상세페이지(프로틴 음료, 밀착 선패치)를 분석한 결과, 고전환 상세페이지는 다음 6가지 추가 섹션 타입을 활용한다:

- POINT 마커 섹션 (번호별 핵심 특징)
- 수치 강조 배너 (임상·영양 수치 대형 표시)
- 비율 바 차트 (영양·함량 시각화)
- WHY 아이콘 블록 (구매 이유 4종)
- 인증 배지 (신뢰도 클레임)
- 사용법 인포그래픽 (단계별 시각 안내)

또한 AI 모델을 claude-sonnet-4-6에서 claude-opus-4-8로 교체해 카피 품질을 높인다.

---

## 아키텍처

### 접근법: 기존 스키마 확장 (점진적)

기존 `DetailPageContent` 인터페이스에 `richSections?: RichSections` 필드를 추가한다. 기존 섹션(hero, selling_points, features 등)은 그대로 유지하고, `richSections`의 각 항목을 추가 섹션으로 파싱·렌더링한다.

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/types/detail-page.ts` | `RichSections` 타입, 새 `SectionType` 6종 추가 |
| `src/lib/ai/prompts/detail-page.ts` | 시스템 프롬프트에 richSections 생성 규칙 추가, JSON 스키마 확장 |
| `src/app/api/ai/generate-detail-html/route.ts` | 모델 `claude-opus-4-8`, max_tokens 4096으로 변경 |
| `src/lib/detail-page/section-parser.ts` | `contentToSections()`에 richSections 파싱 로직 추가 |
| `src/lib/detail-page/section-renderer.ts` | 6개 새 섹션 타입 렌더러 추가 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 로딩 안내 문구 업데이트 |

### 데이터 흐름

```
이미지(최대 10장) + 상품명 + 카테고리
  → claude-opus-4-8 (이미지 분석 + 카피 + richSections 생성)
  → contentToSections() (기존 섹션 + rich 섹션 → DetailSection[])
  → renderAllSections() (6개 새 렌더러 포함 → HTML)
  → 판매자 섹션별 수정 (기존 edit-section API 재사용)
```

**예상 생성 시간:** 기존 5초 → 20~30초 (Opus 4.8 + 확장된 스키마)  
→ UI의 로딩 안내 문구 업데이트 필요

---

## 타입 설계

### RichSections (신규, `src/types/detail-page.ts`)

```typescript
export interface RichSections {
  // AI가 선택한 섹션 목록 (렌더링 순서 결정)
  selectedSections: ('point' | 'stat' | 'bar_chart' | 'why' | 'cert' | 'steps')[]

  // ① POINT 마커 섹션
  pointSections?: Array<{
    number: number        // 1, 2, 3
    title: string         // 20자 이내
    description: string   // 60자 이내
  }>

  // ② 수치 강조 배너
  statCallouts?: Array<{
    value: string         // "단백질 20g", "93.5%"
    label: string         // "1회 제공량당", "소비자 만족도"
    description: string   // 40자 이내
  }>

  // ③ 바 차트
  barChartItems?: Array<{
    label: string         // "비타민 B1", "단백질"
    percentage: number    // 0~200 (바 너비 계산용)
    displayValue: string  // "150%", "20g" (표시 텍스트)
  }>

  // ④ WHY 아이콘 블록
  whyIcons?: Array<{
    icon: string          // BMP 범위 이모지 1개
    title: string         // 15자 이내
    description: string   // 40자 이내
  }>

  // ⑤ 인증 배지
  certifications?: Array<{
    name: string          // "무균공정 인증", "피부과 임상 테스트"
    description: string   // 40자 이내
  }>

  // ⑥ 사용법 인포그래픽
  infographicSteps?: Array<{
    step: number
    icon: string          // 이모지
    title: string         // 15자 이내
    description: string   // 30자 이내
  }>
}
```

### DetailPageContent 확장 (기존 파일)

```typescript
// 기존 인터페이스에 아래 필드 추가
richSections?: RichSections
```

### 새 SectionType 값 (기존 파일)

```typescript
// 기존 SectionType union에 추가
| 'point_section'
| 'stat_callout'
| 'bar_chart'
| 'why_icons'
| 'certifications'
| 'infographic_steps'
```

---

## 프롬프트 설계

### 모델 변경 (`generate-detail-html/route.ts`)

```typescript
// 이미지 분석
model: 'claude-opus-4-8',
max_tokens: 1024,  // 기존 유지

// 카피 생성
model: 'claude-opus-4-8',
max_tokens: 4096,  // 기존 2048 → 4096
```

### 시스템 프롬프트 추가 (`detail-page.ts`)

기존 `DETAIL_PAGE_SYSTEM_PROMPT` (카테고리 무관 공통 베이스) 끝에 아래 섹션 추가.  
`FASHION_SYSTEM_PROMPT`, `LIVING_SYSTEM_PROMPT` 등 카테고리별 변형 프롬프트에는 추가하지 않음 — 베이스 프롬프트가 카테고리 분기 전에 항상 주입되기 때문이다.

```
## richSections 생성 규칙

상품 카테고리와 이미지를 분석하여 아래 중 적합한 섹션만 선택하라.
selectedSections 배열에 선택한 섹션 key를 렌더링 순서대로 명시하라.

카테고리별 권장 섹션:
- 건강기능식품·보충제: ['point', 'stat', 'why', 'bar_chart', 'cert', 'steps']
- 뷰티·스킨케어: ['point', 'stat', 'why', 'cert', 'steps']
- 패션·라이프스타일: ['point', 'why']
- 가전·생활용품: ['why', 'steps', 'point']
- 식품·음료: ['point', 'why', 'stat', 'steps']

⚠️ 수치 정확성 원칙:
- stat, bar_chart 섹션의 수치는 이미지에서 실제 확인된 데이터만 사용
- 이미지에서 수치 확인 불가 시 해당 섹션 생략 (수치 추론·창작 금지)
- certifications도 이미지에서 확인 가능한 인증만 기재
```

### JSON 스키마 확장

기존 `DETAIL_PAGE_CONTENT_SCHEMA`의 required 배열 및 properties에 `richSections` 추가:

```json
"richSections": {
  "type": "object",
  "properties": {
    "selectedSections": {
      "type": "array",
      "items": { "type": "string", "enum": ["point", "stat", "bar_chart", "why", "cert", "steps"] }
    },
    "pointSections": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "number": { "type": "number" },
          "title": { "type": "string" },
          "description": { "type": "string" }
        },
        "required": ["number", "title", "description"]
      }
    },
    "statCallouts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "value": { "type": "string" },
          "label": { "type": "string" },
          "description": { "type": "string" }
        },
        "required": ["value", "label", "description"]
      }
    },
    "barChartItems": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label": { "type": "string" },
          "percentage": { "type": "number" },
          "displayValue": { "type": "string" }
        },
        "required": ["label", "percentage", "displayValue"]
      }
    },
    "whyIcons": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "icon": { "type": "string" },
          "title": { "type": "string" },
          "description": { "type": "string" }
        },
        "required": ["icon", "title", "description"]
      }
    },
    "certifications": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" }
        },
        "required": ["name", "description"]
      }
    },
    "infographicSteps": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "step": { "type": "number" },
          "icon": { "type": "string" },
          "title": { "type": "string" },
          "description": { "type": "string" }
        },
        "required": ["step", "icon", "title", "description"]
      }
    }
  },
  "required": ["selectedSections"]
}
```

---

## HTML 렌더러 설계

### 섹션별 시각 구조 (`section-renderer.ts`)

| 섹션 타입 | 배경 | 레이아웃 | 키 스타일 |
|-----------|------|----------|-----------|
| `point_section` | `#f8fafc` | flex, 좌측 POINT 배지 + 우측 텍스트 | 배지: `#1e293b` 다크, 제목 bold |
| `stat_callout` | 다크 그라디언트 | 3열 그리드, 중앙 정렬 | 수치 대형(28px+), white |
| `bar_chart` | `#f8fafc` | 행별 label + 트랙 + 값 | 바 fill: `#6366f1` 계열 |
| `why_icons` | white | 4열 그리드 | 아이콘 28px, 중앙 정렬 |
| `certifications` | white | flex wrap 뱃지 | 테두리 박스, 아이콘+텍스트 |
| `infographic_steps` | white | flex 수평 단계 | 번호 원형 `#6366f1`, 화살표 연결 |

### `section-parser.ts` 파싱 로직

`contentToSections(content)` 내부에서:
1. `content.richSections?.selectedSections`를 순서대로 순회
2. 각 key에 해당하는 데이터 배열 확인 (없으면 skip)
3. 해당 `DetailSection` 타입으로 변환하여 기존 섹션 배열에 append
4. 최종 섹션 순서: hero → selling_points → rich 섹션들 → features → spec_table → cta → warning

`selectedSections` 단축키 → `SectionType` 매핑:

| selectedSections key | SectionType |
|----------------------|-------------|
| `'point'` | `'point_section'` |
| `'stat'` | `'stat_callout'` |
| `'bar_chart'` | `'bar_chart'` |
| `'why'` | `'why_icons'` |
| `'cert'` | `'certifications'` |
| `'steps'` | `'infographic_steps'` |

---

## UI 업데이트

### 생성 시간 안내 문구 (DetailMakerClient.tsx)

```typescript
// 기존
'AI 편집 중... (30초~1분 소요)'

// 변경
'AI 상세페이지 생성 중... (약 30초 소요)'
```

### 섹션 편집 지원

신규 6개 섹션 타입도 기존 `edit-section` API를 통해 수정 가능. 섹션 클릭 → 텍스트 수정 → 저장 플로우 동일. 별도 편집 UI 추가 불필요.

---

## 검증 시나리오

1. **보충제 상품** 이미지 3장 업로드 → richSections에 stat, bar_chart 포함 여부 확인
2. **뷰티 상품** 이미지 업로드 → POINT, WHY, cert 섹션 생성 확인
3. **일반 생활용품** → bar_chart, stat 섹션 생략 확인 (수치 없으면 AI가 스킵)
4. 생성된 HTML에서 섹션 클릭 후 텍스트 수정 → 저장 동작 확인
5. 생성 소요 시간 20~30초 내 완료 확인
