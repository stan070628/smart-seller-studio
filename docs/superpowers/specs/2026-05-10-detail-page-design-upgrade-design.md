# 상세페이지 디자인 업그레이드 설계

**날짜:** 2026-05-10  
**범위:** 상품등록 두 진입점 모두 — Step 3(AI 상품 등록 플로우) + 썸네일·상세만 만들기 탭

---

## 배경

상세페이지 생성/편집은 두 진입점에서 이루어진다.

1. **AI 상품 등록 플로우 Step 3** (`/listing` → AI 상품 등록 탭 → Step 3 등록 정보 입력): URL/이미지로 전체 상품 등록을 자동화하는 흐름의 마지막 단계
2. **썸네일·상세만 만들기 탭** (`/listing?tab=assets`): 상품 등록 없이 URL 입력 또는 이미지 직접 업로드로 썸네일·상세페이지만 빠르게 생성하는 독립 도구

두 진입점 모두 `POST /api/ai/generate-detail-html` API를 공유하며, 결과 HTML 편집 UI도 동일한 컴포넌트(`AssetsResultPanel`, `Step3ReviewRegister`)를 사용한다. 현재는 AI가 HTML을 한 번에 생성하고, 사용자는 프리셋 칩(5개)이나 자유 텍스트로 전체를 일괄 수정하는 구조다. 섹션별 편집이 불가능하고, 디자인은 제품 카테고리/색상과 무관하게 동일한 템플릿이 적용된다.

---

## 목표

1. **편집 UX**: 섹션별 분리 + 섹션마다 AI 지시어 입력 + 드래그로 순서 변경
2. **결과물 디자인**: 제품 이미지/URL 분석 → 색상·레이아웃·섹션 구성 자동 결정
3. **이미지 파이프라인**: 업로드 이미지를 가공(배경제거→합성→텍스트오버레이)해서 섹션에 삽입

---

## 아키텍처

### 데이터 모델 — `DetailPageData`

```typescript
interface DetailSection {
  id: string;                     // uuid
  type: SectionType;
  order: number;
  content: SectionContent;        // 타입별 다른 구조
  attachedImages: AttachedImage[];
  aiInstruction?: string;         // 섹션별 AI 지시어 (마지막 입력값 보존)
}

type SectionType =
  | 'hero'           // 풀블리드 히어로 이미지 + 헤드라인
  | 'selling_points' // 셀링 포인트 리스트 (최대 6개)
  | 'features'       // 특징 상세 (이미지 + 텍스트 페어)
  | 'stats'          // 숫자 통계 강조 (92%, 77% 등)
  | 'spec_table'     // 제품 사양 테이블
  | 'usage_steps'    // 사용법 단계
  | 'warning'        // 주의사항
  | 'cta';           // 구매 유도 마무리

interface AttachedImage {
  url: string;           // Supabase Storage URL
  order: number;
  processingMode: 'original' | 'bg_removed' | 'bg_composed';
}

interface DetailPageTheme {
  palette: 'warm_cream' | 'cool_white' | 'deep_dark' | 'nature_green' | 'tech_navy';
  primaryColor: string;     // hex — AI가 제품 분석해서 결정
  accentColor: string;      // hex
  fontStyle: 'serif' | 'sans' | 'mixed';
  imageLayout: 'fullbleed' | 'composed' | 'split';
}

interface DetailPageData {
  sections: DetailSection[];
  theme: DetailPageTheme;
  generatedHtml: string;    // 최종 렌더링 결과 (캐시)
}
```

---

## 편집 UI — Step 3 왼쪽 패널 재설계

### 현재 vs 개선

| 항목 | 현재 | 개선 |
|------|------|------|
| 미리보기 | iframe 480px 고정 | 섹션 카드 리스트 + 우측 라이브 미리보기 |
| 편집 단위 | 전체 HTML 일괄 수정 | 섹션별 독립 편집 |
| AI 지시어 | 전체 1개 텍스트 | 섹션마다 접이식 지시어 입력창 |
| 이미지 첨부 | 없음 | 섹션별 이미지 업로드 + 순서 지정 |
| 순서 변경 | 없음 | 드래그&드롭 (dnd-kit) |
| 디자인 제어 | 없음 | 팔레트/레이아웃 선택 (AI 추천 + 수동 변경) |

### 레이아웃

```
┌──────────────────── 왼쪽 패널 ────────────────────┐
│ 디자인 테마 바  [🎨 팔레트] [레이아웃] [폰트]        │
├──────────────────────────────────────────────────│
│ + 섹션 추가 버튼                                   │
├──────────────────────────────────────────────────│
│ ┌── 섹션 카드 (드래그 핸들 ≡) ──────────────────┐ │
│ │ [HERO] 강력한 먼지 포집, 깔끔한 마무리          │ │
│ │ 📎 이미지 첨부 [+]   [✦ AI 수정] [🗑]         │ │
│ │ ▼ AI 지시어: "배경을 크림색으로..."             │ │
│ └─────────────────────────────────────────────┘ │
│ ┌── 섹션 카드 ────────────────────────────────┐  │
│ │ [SELLING POINTS] 셀링 포인트                  │ │
│ │ • 360° 먼지 포집  • 세탁 가능  • 2배 내구성   │ │
│ │ [✦ AI 수정] [🗑]                             │ │
│ └─────────────────────────────────────────────┘ │
│ ┌── 섹션 카드 ────────────────────────────────┐  │
│ │ [STATS] 통계                                  │ │
│ │ 92% 먼지 포집률  /  70% 더 많은 먼지           │ │
│ │ [✦ AI 수정] [🗑]                             │ │
│ └─────────────────────────────────────────────┘ │
│ ... (추가 섹션들)                                 │
│ [전체 재생성]  [HTML 복사]  [다운로드]  [임시저장]  │
└──────────────────────────────────────────────────┘

┌──────────── 오른쪽: 라이브 미리보기 ──────────────┐
│ (실시간 렌더링 — 섹션 편집시 해당 섹션 하이라이트)   │
└──────────────────────────────────────────────────┘
```

### 섹션 카드 인터랙션

- **드래그 핸들(≡)** 클릭&드래그 → 순서 변경 (dnd-kit `useSortable`)
- **이미지 첨부[+]** → 파일 업로더 열림 → 업로드 후 순서 번호 표시
- **AI 수정** 클릭 → 해당 섹션 아래에 지시어 입력창 펼침 → 전송 시 해당 섹션만 재생성
- **삭제[🗑]** → 확인 없이 즉시 삭제 (되돌리기 버튼 3초 노출)
- **카드 클릭** → 우측 미리보기에서 해당 섹션 스크롤&하이라이트

---

## AI 이미지 처리 파이프라인

### 흐름

```
사용자 이미지 업로드
        ↓
[1] 배경 제거 (remove.bg API or rembg)
        ↓
[2] 배경 합성 (Sharp.js)
    — palette 기반 단색/그라디언트 배경 생성
    — 제품 이미지 중앙 배치 + 그림자 추가
        ↓
[3] 텍스트 오버레이 (Sharp.js)
    — 헤드라인 / 키포인트 레이블 삽입
    — 폰트: Noto Sans KR (본문) + DM Serif Display (숫자/강조)
        ↓
[4] Supabase Storage 저장
        ↓
[5] 섹션 HTML에 img 태그로 삽입
```

### 이미지 배치 3방식

| 방식 | 설명 | 적용 섹션 |
|------|------|----------|
| `fullbleed` | 이미지가 섹션 전체 폭 채움, 텍스트 오버레이 | hero, cta |
| `composed` | 단색/그라디언트 배경 위에 제품 단독 이미지 | features, stats |
| `split` | 좌우 반반 — 한쪽 이미지, 한쪽 텍스트 | features |

---

## AI 제품 분석 → 테마 자동 결정

### 분석 입력

- 업로드된 제품 이미지 (Gemini Vision)
- 상품명 + 카테고리 코드
- 원본 상세페이지 URL (있을 경우)

### 분석 출력 (JSON)

```json
{
  "productCategory": "cleaning",
  "dominantColors": ["#FFC107", "#FFFFFF", "#1A1A1A"],
  "mood": "energetic",
  "recommendedPalette": "warm_cream",
  "recommendedLayout": "fullbleed",
  "suggestedSections": ["hero", "selling_points", "stats", "features", "spec_table", "cta"],
  "accentColor": "#FFC107",
  "targetAudience": "general"
}
```

### 팔레트별 대비 규칙 (WCAG AA 필수)

| 팔레트 | 배경 | 텍스트 | 포인트 |
|--------|------|--------|--------|
| warm_cream | #F5F0E8 | #1A1A1A | #8B6914 (골드) |
| cool_white | #FFFFFF | #111111 | #2563EB |
| deep_dark | #1A1A1A | #FFFFFF | #FFC107 |
| nature_green | #F0F7F0 | #1A2E1A | #2D6A2D |
| tech_navy | #0F172A | #F8FAFC | #38BDF8 |

**규칙:** 어두운 배경 → 흰색/밝은 텍스트만. 밝은 배경 → 진한 텍스트만. 동일 계열 배경+텍스트 절대 금지.

---

## API 엔드포인트

### 기존 API 수정

- `POST /api/detail-page/generate` — 섹션 배열 + 테마 반환하도록 응답 구조 변경

### 신규 API

| 엔드포인트 | 설명 |
|-----------|------|
| `POST /api/detail-page/analyze-product` | 이미지/URL 분석 → 테마 추천 |
| `POST /api/detail-page/edit-section` | 섹션 하나만 AI 재생성 |
| `POST /api/detail-page/process-image` | 배경제거 + 합성 + 저장 |
| `POST /api/detail-page/render` | sections[] + theme → HTML 렌더링 |

---

## 두 진입점의 차이 및 공통화 전략

| 항목 | AI 상품 등록 Step 3 | 썸네일·상세만 만들기 |
|------|--------------------|--------------------|
| 컴포넌트 | `Step3ReviewRegister.tsx` | `AssetsResultPanel.tsx` |
| 입력 소스 | URL 자동 스크랩 + AI 처리 | URL 스크랩 or 직접 이미지 업로드 |
| 제품 스펙 | `sharedDraft` (자동 추출) | `sharedDraft.productSpecText` (수동 입력 옵션) |
| 등록 연동 | 쿠팡 등록 폼 함께 표시 | 상세페이지만 독립 생성 |
| 편집 UI | 동일하게 적용 | 동일하게 적용 |

**공통화 전략**: 섹션 편집 UI를 `DetailPageEditor` 컴포넌트로 분리하고, 두 진입점에서 모두 import해서 사용한다. 데이터 소스(스펙, 이미지)만 props로 주입.

```
DetailPageEditor (공통 컴포넌트)
├── props: sections, theme, onSectionsChange, onThemeChange
├── 섹션 카드 리스트 (dnd-kit)
├── 테마 선택 바
└── 액션 버튼 (재생성, HTML 복사, 다운로드)

Step3ReviewRegister
└── <DetailPageEditor ... /> + 쿠팡 등록 폼

AssetsResultPanel  
└── <DetailPageEditor ... /> + 저장/다운로드만
```

---

## 구현 순서

### Phase 1 — 데이터 모델 + 섹션 카드 UI (프론트엔드)
- `DetailSection` 타입 정의
- 섹션 카드 컴포넌트 (dnd-kit 드래그 포함)
- 기존 HTML에서 섹션 파싱해서 초기 데이터 구성

### Phase 2 — AI 섹션별 편집 API
- `edit-section` API: 섹션 하나 받아서 AI로 재생성
- 지시어 칩 확장 (섹션 타입별 다른 칩셋)

### Phase 3 — 제품 분석 + 테마 자동화
- `analyze-product` API (Gemini Vision)
- 팔레트 → HTML 렌더링 연결
- 테마 선택 UI (AI 추천 + 수동 변경)

### Phase 4 — 이미지 파이프라인
- 배경제거 연동 (remove.bg or rembg)
- Sharp.js 합성 + 텍스트오버레이
- 섹션 이미지 첨부 UI

---

## 제약사항

- 쿠팡 광고 정책 위반 문구 필터는 기존 `detail-page.ts` 금지어 목록 유지
- 개인정보 제공 고지 이미지 3종은 최종 HTML 하단에 항상 고정 (기존 메모리 규칙)
- 섹션 HTML 렌더링 시 인라인 스타일만 사용 (외부 CSS 불가 — 쿠팡 상세페이지 제약)
- 이미지는 전부 Supabase Storage에 저장 후 절대 URL 사용
