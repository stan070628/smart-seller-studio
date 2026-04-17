# 코스트코 모바일 소싱 — Phase M-1 요건서

> **작성일:** 2026-04-12  
> **버전:** 1.0  
> **범위:** Phase M-1 (카드 리스트 + 검색 + 등급필터 + 바텀시트)  
> **라우트:** `/m/costco`

---

## 1. 프로젝트 개요

### 1.1 목적

코스트코 매장 현장에서 한 손으로 상품 소싱 판단을 내리는 모바일 전용 UI.  
데스크톱 `CostcoTab.tsx`의 15개 컬럼 테이블을 카드 기반으로 재설계하되, 비즈니스 로직(`costco-pricing.ts`, `costco-scoring.ts`)은 100% 재사용한다.

### 1.2 현재 시스템 구성

| 항목 | 내용 |
|------|------|
| 프레임워크 | Next.js 16.2.1 (App Router) |
| 백엔드 | Supabase (costco_products 테이블) |
| 배포 | Vercel (프론트) + Render (API) |
| 스코어링 | v2 7항목 모델, 110점 캡, S~D 등급 |
| 데스크톱 UI | `/sourcing` → `SourcingDashboard` → `CostcoTab.tsx` |
| 모바일/PWA | 미구현 (Phase M-1에서 신규 생성) |

### 1.3 전체 로드맵 (Phase M 시리즈)

| Phase | 핵심 기능 | 상태 |
|-------|----------|------|
| **M-1** | 카드 리스트 + 검색 + 등급필터 + 바텀시트 | **← 현재** |
| M-2 | 카트 담기 + 카트 목록 + 매입합계 |  |
| M-3 | 쇼핑 리스트 + PWA 오프라인 캐시 |  |
| M-4 | 바코드 스캔, 가격표 OCR |  |

---

## 2. 재사용할 기존 모듈

### 2.1 비즈니스 로직 (변경 없이 import)

| 모듈 | 경로 | 역할 |
|------|------|------|
| `costco-scoring.ts` | `src/lib/sourcing/` | 7항목 스코어링 + S~D 등급 판정 |
| `costco-pricing.ts` | `src/lib/sourcing/` | 채널별 추천가·마진·격차 계산 |
| `costco-constants.ts` | `src/lib/sourcing/` | 11개 카테고리, 포장비(500원), 배송비 테이블 |
| `shared/grade.ts` | `src/lib/sourcing/shared/` | `getGrade(score)` → `GradeInfo` + `GRADE_COLORS` |
| `shared/channel-policy.ts` | `src/lib/sourcing/shared/` | 네이버 6%, 쿠팡 11% 수수료, VAT 10/110 |
| `shared/male-classifier.ts` | `src/lib/sourcing/shared/` | 남성 타겟 분류 (high/mid/neutral/female) |
| `shared/season-bonus.ts` | `src/lib/sourcing/shared/` | 시즌 키워드 매칭 → 0~10점 |

### 2.2 타입 정의 (변경 없이 import)

| 타입 | 경로 | 핵심 필드 |
|------|------|----------|
| `CostcoProductRow` | `src/types/costco.ts` | 전체 상품 데이터 (가격, 스코어, 등급, 재고 등) |
| `CostcoScoreResult` | `src/types/costco.ts` | 7항목 개별점수 + 보너스 + gradeInfo |
| `CostcoPriceResult` | `src/types/costco.ts` | 채널별 추천가·마진율·시장격차 |
| `CostcoSortKey` | `src/types/costco.ts` | 6가지 정렬 키 |

### 2.3 API 엔드포인트 (기존 그대로 호출)

| Method | Endpoint | 용도 |
|--------|----------|------|
| `GET` | `/api/sourcing/costco` | 필터·정렬·페이징 조회 |
| `PUT` | `/api/sourcing/costco/market-price` | 시장최저가 수동 입력 |

---

## 3. Phase M-1 기능 명세

### 3.1 화면 구조

```
┌─────────────────────────────┐
│  🏪 코스트코 소싱            │  ← 헤더 (고정)
├─────────────────────────────┤
│  🔍 검색 ···                │  ← 검색바
│  [S] [A] [B] [전체]  ▼정렬  │  ← 등급필터 + 정렬
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐    │
│  │ [S] 87점  코C 32,900│    │  ← 카드 1
│  │ 커클랜드 올리브오일.. │    │
│  │ 추천 41,200  마진 16%│    │
│  │ 격차 +12%   재고 ●  │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ [A] 72점  코C 15,900│    │  ← 카드 2
│  │ ...                  │    │
│  └─────────────────────┘    │
│                             │
│         (스크롤)            │
│                             │
├─────────────────────────────┤
│  🛒 카트(0)    📋 리스트    │  ← 하단 탭바 (M-2, M-3용 예약)
└─────────────────────────────┘
```

### 3.2 카드 컴포넌트 (`MobileCostcoCard`)

#### 카드에 표시할 핵심 6가지 (3초 판단)

| # | 정보 | 데이터 소스 | 표시 형식 |
|---|------|------------|----------|
| 1 | **등급 + 점수** | `costco_score_total` → `getGrade()` | `[S] 87` 컬러 뱃지 |
| 2 | **매입가** | `price` | `코C 32,900` |
| 3 | **상품명** | `title` | 최대 2줄, 말줄임 |
| 4 | **추천가 + 마진율** | `CostcoPriceResult.recommendedPrice`, `realMarginRate` | `추천 41,200 마진 16%` |
| 5 | **시장격차** | `CostcoPriceResult.vsMarket` | `격차 +12%` (양수=초록, 음수=빨강) |
| 6 | **재고 상태** | `stock_status` | ● 재고 / ⚠ 임박 / ✕ 품절 |

#### 등급 컬러 시스템 (매장 조명 대응)

| 등급 | 점수 범위 | 데스크톱 색상 (grade.ts) | 모바일 배경색 (고대비 변형) | 설명 |
|------|----------|------------------------|--------------------------|------|
| **S** | 80~110 | `#7c3aed` (보라) | `#7c3aed` 배경 + 흰색 텍스트 | 즉시소싱 |
| **A** | 65~79 | `#16a34a` (초록) | `#16a34a` 배경 + 흰색 텍스트 | 추천 |
| **B** | 50~64 | `#2563eb` (파랑) | `#2563eb` 배경 + 흰색 텍스트 | 검토 |
| **C** | 35~49 | `#d97706` (주황) | `#d97706` 배경 + 흰색 텍스트 | 비추 |
| **D** | 0~34 | `#dc2626` (빨강) | `#dc2626` 배경 + 흰색 텍스트 | 탈락 |

> 데스크톱은 텍스트 컬러 + 연한 배경(`rgba 0.08`)이지만, 모바일에서는 매장 형광등 아래 즉시 식별을 위해 **채도 100% 배경 + 흰색 텍스트** 고대비 변형 적용.  
> 기본 팔레트는 `GRADE_COLORS`(shared/grade.ts)를 따르되, 모바일 전용 `MOBILE_GRADE_COLORS`를 별도 정의.

#### 카드 레이아웃 상세

```
┌──────────────────────────────────────────┐
│ ┌──────┐                                 │
│ │[S] 87│  커클랜드 엑스트라버진 올리브오일.. │  ← 1행: 등급뱃지 + 상품명
│ └──────┘  1L × 2 ⭐4.5(128)              │       부제: 규격 + 별점
│──────────────────────────────────────────│
│ 코C 32,900    추천 41,200   마진 16.2%   │  ← 2행: 가격 3종
│ 격차 +12.3%   ● 재고      🧔 남성(mid)  │  ← 3행: 격차 + 재고 + 타겟
└──────────────────────────────────────────┘
```

### 3.3 바텀시트 (`MobileCostcoDetail`)

카드 터치 시 하단에서 올라오는 상세 패널. 화면 높이의 75%까지 확장.

#### 바텀시트 섹션 구성

**섹션 1: 상품 기본 정보**

| 필드 | 소스 |
|------|------|
| 상품 이미지 | `image_url` (없으면 📦 이모지 fallback) |
| 전체 상품명 | `title` (줄임 없이 전체) |
| 브랜드 | `brand` |
| 카테고리 | `category_name` |
| 코스트코 상품코드 | `product_code` |
| 별점·리뷰수 | `average_rating`, `review_count` |

**섹션 2: 스코어 내역 (7항목 바 차트)**

| 항목 | 만점 | 소스 필드 |
|------|------|----------|
| 법적·IP 안전성 | 15 | `costco_score_legal` |
| 가격 경쟁력 | 25 | `costco_score_price` |
| CS 안전성 | 10 | `costco_score_cs` |
| 마진 안전성 | 20 | `costco_score_margin` |
| 수요 신호 | 15 | `costco_score_demand` |
| 재고 회전 | 10 | `costco_score_turnover` |
| 공급 안정성 | 5 | `costco_score_supply` |
| **기본 합계** | **100** | `baseTotal` |
| 남성 보너스 | +5 | `male_bonus` |
| 시즌 보너스 | +10 | `season_bonus` |
| 별표(*) 보너스 | +5 | `asterisk_bonus` |
| **최종 점수** | **110 캡** | `costco_score_total` |

각 항목을 수평 프로그레스 바로 시각화. 만점 대비 달성률을 직관적으로 표시.

**섹션 3: 채널별 추천가**

| 채널 | 추천가 | 단위가 | 마진율 | 시장격차 |
|------|--------|--------|--------|----------|
| 네이버 | `recommendedPrice` | `perUnitPrice` | `realMarginRate` | `vsMarket` |
| 쿠팡 | `recommendedPrice` | `perUnitPrice` | `realMarginRate` | `vsMarket` |

**섹션 4: 원가 구조**

| 항목 | 값 |
|------|-----|
| 매입가 | `price` |
| 배송비 | `getShippingCost(weightKg)` |
| 포장비 | 500원 (고정) |
| 총원가 | `totalCost` |

**섹션 5: 외부 링크**

| 링크 | 동작 |
|------|------|
| 코스트코 상품페이지 | `product_url` → 외부 브라우저 |
| 네이버 검색 | `title` 키워드로 네이버쇼핑 검색 |

**바텀시트 하단 고정 액션 (Phase M-2 예약)**

```
┌──────────────────────────────────────┐
│  [🛒 카트 담기]                       │  ← M-2에서 활성화
└──────────────────────────────────────┘
```

> Phase M-1에서는 비활성(disabled) 상태로 버튼 자리만 확보해둔다.

### 3.4 검색 (`MobileCostcoSearch`)

| 기능 | 상세 |
|------|------|
| 검색 대상 | `title`, `brand`, `product_code` |
| 디바운스 | 300ms |
| 최소 입력 | 2자 이상 |
| 검색 방식 | 기존 API `GET /api/sourcing/costco?search=` 파라미터 활용 |
| UX | 검색 아이콘 터치 → 입력 필드 확장, X 버튼으로 초기화 |

### 3.5 등급 필터 (`MobileCostcoFilter`)

#### 필터 칩 UI

```
[전체] [S 즉시소싱] [A 추천] [B 검토] [C·D]
```

| 칩 | 필터 조건 | 기본값 |
|----|----------|--------|
| 전체 | 등급 무관 | 선택됨 |
| S | `costco_score_total ≥ 80` | |
| A | `65 ≤ costco_score_total < 80` | |
| B | `50 ≤ costco_score_total < 65` | |
| C·D | `costco_score_total < 50` | |

> 복수 선택 가능 (S + A 동시 선택 = 65점 이상).

#### 추가 필터 (접이식)

"▼ 더보기" 터치 시 추가 필터 노출:

| 필터 | 옵션 |
|------|------|
| 재고 상태 | 전체 / 재고있음 / 품절임박 |
| 타겟 성별 | 전체 / 남성(high) / 남성친화(mid) |
| 카테고리 | 11개 코스트코 카테고리 셀렉트 |
| 별표(*) 상품만 | 토글 |
| 시즌 상품만 | 토글 |

### 3.6 정렬

#### 정렬 드롭다운 (기본: 소싱점수 높은순)

| 정렬 옵션 | `CostcoSortKey` | 설명 |
|-----------|-----------------|------|
| 소싱점수순 ↓ | `sourcing_score_desc` | 기본값 |
| 단위절약률순 ↓ | `unit_saving_rate_desc` | 단위가 격차 큰 순 |
| 마진율순 ↓ | `margin_rate_desc` | 마진 높은 순 |
| 가격 낮은순 ↑ | `price_asc` | 매입가 저렴 순 |
| 가격 높은순 ↓ | `price_desc` | 매입가 비싼 순 |
| 리뷰 많은순 ↓ | `review_count_desc` | 수요 검증 순 |
| 최신 수집순 ↓ | `collected_desc` | 최근 수집 순 |

### 3.7 무한 스크롤

| 항목 | 값 |
|------|-----|
| 초기 로딩 | 20개 |
| 추가 로딩 | 20개씩 |
| 트리거 | 바닥에서 200px 이전 |
| 로딩 표시 | 스켈레톤 카드 3개 |
| API | `GET /api/sourcing/costco?page={n}&pageSize=20` |

> 데스크톱은 50개/페이지 페이지네이션이지만, 모바일은 20개씩 무한 스크롤로 전환.

---

## 4. 모바일 UX 원칙

### 4.1 한 손 조작 설계

| 원칙 | 구현 |
|------|------|
| 주요 터치 영역 | 화면 하단 1/3에 집중 |
| 카드 터치 | 전체 카드가 터치 영역 (최소 높이 88px) |
| 바텀시트 닫기 | 아래로 스와이프 or 배경 터치 |
| 필터 칩 | 한 줄 가로 스크롤, 높이 44px |
| 검색 | 상단 고정이지만 키보드 올라오면 자동 스크롤 |

### 4.2 3초 판단 원칙

카드에 핵심 6가지만 노출하여 스크롤하면서 즉시 소싱 여부 판단.

```
눈에 들어오는 순서:
1. 등급 뱃지 컬러 → "S급이네" (0.5초)
2. 매입가 → "3만원대" (0.5초)  
3. 마진율 → "16%면 괜찮다" (0.5초)
4. 시장격차 → "+12% 경쟁력 있다" (0.5초)
5. 재고 상태 → "재고 있다" (0.3초)
6. 상품명 확인 → "올리브오일이구나" (0.7초)
→ 총 3초: "카트에 담자" 또는 "패스"
```

### 4.3 매장 환경 대응

| 환경 이슈 | 대응 |
|----------|------|
| 형광등 반사 | 고대비 컬러, 큰 폰트(16px 이상) |
| 한 손 들기 | 카트 손잡이 잡고 반대 손 엄지 조작 가정 |
| 소음 | 진동 피드백 (카트 담기 시) — M-2에서 구현 |
| 통신 불안정 | 로딩 실패 시 마지막 캐시 표시 (M-3에서 본격 구현) |

---

## 5. 컴포넌트 구조

### 5.1 파일 트리 (Phase M-1)

```
src/
├── app/
│   └── m/
│       └── costco/
│           ├── page.tsx              ← 모바일 코스트코 페이지 (서버 컴포넌트)
│           └── layout.tsx            ← 모바일 전용 레이아웃 (뷰포트 메타, 하단 탭바)
│
├── components/
│   └── mobile/
│       └── costco/
│           ├── MobileCostcoPage.tsx       ← 메인 클라이언트 컴포넌트 (상태 관리)
│           ├── MobileCostcoCard.tsx        ← 카드 컴포넌트
│           ├── MobileCostcoDetail.tsx      ← 바텀시트 상세
│           ├── MobileCostcoSearch.tsx      ← 검색바
│           ├── MobileCostcoFilter.tsx      ← 등급 필터 칩 + 추가 필터
│           ├── MobileCostcoSort.tsx        ← 정렬 드롭다운
│           ├── MobileBottomSheet.tsx       ← 범용 바텀시트 쉘
│           ├── MobileScoreBreakdown.tsx    ← 7항목 프로그레스 바
│           ├── MobileChannelPrice.tsx      ← 채널별 추천가 비교
│           └── MobileBottomTabBar.tsx      ← 하단 탭바 (카트·리스트 탭 비활성)
│
├── hooks/
│   └── mobile/
│       ├── useCostcoMobileList.ts     ← 무한스크롤 + 필터 + 정렬 훅
│       └── useBottomSheet.ts          ← 바텀시트 열기/닫기/스와이프 훅
│
└── lib/
    └── sourcing/                      ← 기존 모듈 (변경 없음)
        ├── costco-scoring.ts
        ├── costco-pricing.ts
        ├── costco-constants.ts
        └── shared/
```

### 5.2 컴포넌트 의존 관계

```
MobileCostcoPage
├── MobileCostcoSearch
├── MobileCostcoFilter
├── MobileCostcoSort
├── MobileCostcoCard[]            ← 무한 스크롤 리스트
│   └── (터치) → MobileCostcoDetail (바텀시트)
│       ├── MobileScoreBreakdown
│       └── MobileChannelPrice
└── MobileBottomTabBar
```

### 5.3 상태 관리

```typescript
// useCostcoMobileList.ts
interface MobileListState {
  products: CostcoProductRow[];
  page: number;
  hasMore: boolean;
  isLoading: boolean;
  
  // 필터
  search: string;
  gradeFilter: ('S' | 'A' | 'B' | 'CD')[];
  stockFilter: 'all' | 'inStock' | 'lowStock';
  genderFilter: 'all' | 'high' | 'mid';
  categoryFilter: string | null;
  asteriskOnly: boolean;
  seasonOnly: boolean;
  
  // 정렬
  sort: CostcoSortKey;
  
  // 바텀시트
  selectedProduct: CostcoProductRow | null;
  isDetailOpen: boolean;
}
```

---

## 6. 기술 요구사항

### 6.1 라우팅

| 항목 | 값 |
|------|-----|
| 경로 | `/m/costco` |
| 레이아웃 | `src/app/m/costco/layout.tsx` (모바일 전용, 데스크톱 레이아웃과 분리) |
| 접근 제어 | 데스크톱에서 `/m/costco` 접근 시 → `/sourcing`로 리다이렉트 (User-Agent 기반) |
| 모바일에서 `/sourcing` 접근 시 | → `/m/costco`로 리다이렉트 |

### 6.2 뷰포트 설정

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta name="theme-color" content="#1F2937" />
```

### 6.3 반응형 기준

| 구분 | 너비 | 동작 |
|------|------|------|
| 모바일 | ≤ 768px | 카드 리스트 (Phase M-1) |
| 태블릿 | 769~1024px | 카드 2열 그리드 (선택적) |
| 데스크톱 | > 1024px | 기존 테이블 UI로 리다이렉트 |

### 6.4 성능 목표

| 지표 | 목표 |
|------|------|
| FCP (First Contentful Paint) | < 1.5초 |
| 카드 20개 렌더링 | < 500ms |
| 바텀시트 오픈 애니메이션 | 300ms ease-out |
| 검색 디바운스 후 결과 | < 800ms |
| 이미지 로딩 | lazy loading, 36×36 → 원본 프로그레시브 |

### 6.5 접근성

| 항목 | 구현 |
|------|------|
| 최소 터치 영역 | 44×44px (Apple HIG 기준) |
| 카드 최소 높이 | 88px |
| 폰트 최소 크기 | 14px (가격·마진 등 핵심 수치는 16px+) |
| 색상 대비 | WCAG AA 기준 4.5:1 이상 |
| 스크린 리더 | 등급·점수에 aria-label 제공 |

---

## 7. API 연동

### 7.1 목록 조회 (기존 API 활용)

```
GET /api/sourcing/costco
  ?search={검색어}
  &category={카테고리코드}
  &grade={S|A|B|CD}          ← 신규 파라미터 (서버 필터 추가 필요)
  &stockStatus={inStock|lowStock}
  &genderFilter={high|mid}
  &asteriskOnly={true}
  &seasonOnly={true}
  &sort={CostcoSortKey}
  &page={number}
  &pageSize=20
```

#### API 변경 사항 (최소)

| 변경 | 내용 |
|------|------|
| `grade` 파라미터 추가 | 등급별 필터 (점수 범위로 변환) |
| `pageSize` 기본값 | 데스크톱 50 → 모바일 요청 시 20 허용 |
| 응답 필드 | 변경 없음 (기존 `CostcoProductRow` 전체 반환) |

### 7.2 시장가 수정 (기존 API 활용)

```
PUT /api/sourcing/costco/market-price
Body: {
  productCode: string,
  marketPrice: number,
  source: 'manual'
}
```

> 바텀시트 내에서 시장최저가 수정 기능 제공 (데스크톱의 인라인 편집을 모달 입력으로 대체).

---

## 8. 에러 처리 & 엣지 케이스

| 상황 | 처리 |
|------|------|
| API 에러 (500) | "데이터를 불러올 수 없습니다. 다시 시도해주세요" + 재시도 버튼 |
| 네트워크 오프라인 | "오프라인 상태입니다" 배너 (M-3에서 캐시 대응) |
| 검색 결과 0건 | "'{검색어}'에 대한 결과가 없습니다" + 필터 초기화 버튼 |
| 이미지 로딩 실패 | 📦 이모지 대체 (기존 데스크톱과 동일) |
| 스코어 미계산 상품 | `costco_score_total = null` → "미산정" 회색 뱃지 |
| 무한 스크롤 끝 | "모든 상품을 확인했습니다" 메시지 |

---

## 9. Phase M-1 작업 항목 (구현 순서)

### Step 1: 라우트 & 레이아웃 세팅
- [ ] `src/app/m/costco/layout.tsx` — 모바일 전용 레이아웃 (뷰포트 메타, 하단 탭바 슬롯)
- [ ] `src/app/m/costco/page.tsx` — 서버 컴포넌트 (초기 데이터 fetch + MobileCostcoPage 렌더)
- [ ] 모바일↔데스크톱 리다이렉트 미들웨어

### Step 2: 핵심 컴포넌트
- [ ] `MobileBottomSheet.tsx` — 범용 바텀시트 (스와이프 닫기, 75% 높이)
- [ ] `MobileCostcoCard.tsx` — 핵심 6가지 정보 카드
- [ ] `MobileCostcoDetail.tsx` — 바텀시트 상세 (스코어 내역 + 채널별 가격)
- [ ] `MobileScoreBreakdown.tsx` — 7항목 수평 프로그레스 바
- [ ] `MobileChannelPrice.tsx` — 네이버·쿠팡 추천가 비교

### Step 3: 검색 & 필터 & 정렬
- [ ] `MobileCostcoSearch.tsx` — 디바운스 검색
- [ ] `MobileCostcoFilter.tsx` — 등급 칩 + 접이식 추가 필터
- [ ] `MobileCostcoSort.tsx` — 정렬 드롭다운

### Step 4: 데이터 연동
- [ ] `useCostcoMobileList.ts` — 무한 스크롤 + 필터 + 정렬 통합 훅
- [ ] `useBottomSheet.ts` — 바텀시트 상태 관리 훅
- [ ] API `grade` 파라미터 추가 (서버 사이드)

### Step 5: 통합 & 마무리
- [ ] `MobileCostcoPage.tsx` — 전체 조립
- [ ] `MobileBottomTabBar.tsx` — 하단 탭바 (M-2/M-3 탭 비활성)
- [ ] 반응형 리다이렉트 테스트
- [ ] 성능 테스트 (FCP, 카드 렌더링)
- [ ] 실기기 테스트 (iOS Safari, Android Chrome)

---

## 10. Phase M-2/M-3 연동 포인트 (미리 설계)

Phase M-1에서 미리 자리를 잡아둘 항목들:

| 항목 | M-1 에서의 준비 | 활성화 시점 |
|------|----------------|------------|
| 카트 담기 버튼 | 바텀시트 하단에 disabled 상태로 배치 | M-2 |
| 하단 탭바 | 3탭 구조 (소싱/카트/리스트), 카트·리스트 비활성 | M-2, M-3 |
| 로컬 캐시 구조 | `useCostcoMobileList`에 캐시 레이어 인터페이스만 정의 | M-3 |
| PWA manifest | layout.tsx에 link 태그 자리만 확보 | M-3 |

---

## 부록 A: 스코어링 모델 요약

```
기본 점수 (100점 만점)
├── 법적·IP 안전성    15점  ← legalStatus + ipRiskLevel
├── 가격 경쟁력       25점  ← vsMarket (시장가 대비 %)
├── CS 안전성         10점  ← 카테고리 기반 CS 리스크
├── 마진 안전성       20점  ← realMarginRate
├── 수요 신호         15점  ← weeklySales + dailyAvg
├── 재고 회전 속도    10점  ← daysToSell
└── 공급 안정성        5점  ← stockStatus

보너스 (110점 캡)
├── 남성 타겟 보너스   +5점  ← male_tier (high=5, mid=3)
├── 시즌 보너스       +10점  ← 시즌 키워드 매칭
└── 별표(*) 보너스     +5점  ← has_asterisk (희귀/단종)
```

## 부록 B: 채널별 수수료 & 마진 구조

```
매출 구조:
  판매가 (recommendedPrice)
  - 채널 수수료: 네이버 6% / 쿠팡 11%
  - 부가세: 10/110 ≈ 9.09%
  - 매입가 (price)
  - 배송비: 2kg 미만 3,500 / 5kg 미만 4,500 / 10kg 미만 7,000 / 10kg+ 9,000
  - 포장비: 500원
  ─────────
  = 순이익 (netProfit)
  = 실질마진율 (realMarginRate) = netProfit / recommendedPrice × 100

카테고리별 목표 마진율:
  식품 13% / 생활용품 15% / 건강·뷰티 20% / 의류·패션 25% / 가구·침구 18%
```
