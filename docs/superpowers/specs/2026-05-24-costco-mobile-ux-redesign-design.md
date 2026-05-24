# 코스트코 모바일 UX 리디자인 — 상품코드 검색 흐름

> **작성일:** 2026-05-24
> **범위:** `/m/costco` 모바일 앱, 상품코드 검색 모드 추가
> **배경:** 매장 현장에서 사용해보니 기존 DB 목록 탐색 방식은 실제 소싱 흐름과 맞지 않음.
> 실제 흐름은 "상품코드 입력 → 코스트코 온라인 정보 확인 → 오프라인 가격 입력 → 네이버 비교"이므로
> 이 UX를 직접 지원하는 모드를 추가한다.

---

## 1. 결정 사항 요약

| 항목 | 결정 |
|------|------|
| 통합 방식 | 기존 검색창에서 7자리 숫자 감지 시 자동으로 상품코드 검색 모드 전환 |
| 가격 입력 방식 | 인라인 — 제품 카드 바로 아래에 오프라인 가격 입력 필드 |
| 네이버 비교 | DB 캐시값 즉시 표시 + 실시간 Naver API 동시 조회 후 갱신 |
| 기존 목록 | 유지 (카드 아래에 기존 수집 목록 그대로 표시) |

---

## 2. UX 흐름

```
사용자: 검색창에 숫자 7자리 입력 (예: 1234567)
  ↓ 자동 감지 (isProductCode = /^\d{7}$/)
  ↓
코드 검색 모드 전환
  · 검색창 테두리 파란색, "상품코드" 뱃지 표시
  · MobileCodeSearchCard 표시 (기존 목록 위)
  ↓
STEP 1: 코스트코 온라인 정보 표시
  · GET /api/sourcing/costco/lookup?code={code}
  · DB에 있으면 즉시 반환 (market_lowest_price 포함)
  · DB에 없으면 코스트코 OCC API 실시간 조회 (fetchCostcoProduct)
  · 표시: 이미지, 상품명, 카테고리, 온라인가, 별점
  ↓
STEP 2: 오프라인 가격 입력 (인라인, STEP 1과 동시 표시)
  · 숫자 입력 필드 + "비교하기" 버튼
  · 온라인가보다 낮은 경우 힌트 표시
  ↓
[비교하기] 탭
  ↓
STEP 3: 네이버 단위가 비교 + 랜딩
  · 즉시: DB market_lowest_price → 단위가 계산 표시
  · 동시: GET /api/sourcing/costco/naver-prices?code=&title= 호출
  · 응답 오면 최신값으로 갱신
  · 네이버 상품 카드 목록 (탭 → 네이버쇼핑 랜딩)
  ↓
✕ 버튼으로 코드 모드 해제 → 기존 목록으로 복귀
```

---

## 3. 컴포넌트 설계

### 3.1 변경 파일

#### `MobileCostcoList.tsx`

```ts
// 검색어 변경 핸들러에 코드 감지 추가
const isProductCode = /^\d{7}$/.test(search);

// 코드 모드일 때: MobileCodeSearchCard 렌더, 기존 목록은 아래에 유지
// 코드 모드 해제: ✕ 탭 또는 search 변경 시
```

검색창 UI 변경:
- 7자리 숫자 감지 시: 테두리 `#2563eb`, "상품코드" 뱃지 표시, ✕ 아이콘
- 그 외: 기존 스타일 유지

### 3.2 신규 컴포넌트: `MobileCodeSearchCard.tsx`

**Props:**
```ts
interface MobileCodeSearchCardProps {
  code: string;           // 입력된 상품코드
  onClose: () => void;    // ✕ 버튼 콜백
}
```

**내부 상태:**
```ts
type Step = 1 | 2 | 3;  // 2는 1과 동시 표시, 3은 비교 후

interface CardState {
  step: Step;
  product: LookupResult | null;      // /lookup API 응답
  isLoadingProduct: boolean;
  offlinePrice: string;              // 사용자 입력값 (string으로 관리)
  naverResult: NaverCompareResult | null;
  isLoadingNaver: boolean;
}
```

**섹션 구성:**
- **STEP 1:** 이미지(56px) + 상품명 2줄 + 카테고리 + 별점 + 온라인가
- **STEP 2:** 오프라인 가격 입력 필드 + [비교하기] 버튼 (STEP 1과 같은 카드에 구분선으로 분리)
- **STEP 3:** STEP 1+2 접힘(요약 표시) + 단위가 vs/vs 블록 + 네이버 상품 카드 목록

**단위가 계산:**
```ts
// DB 상품의 경우: unit_price는 이미 단위당 가격 (100ml당, 개당 등)
// 오프라인 가격 기반 단위가 = offline_price × (unit_price / online_price)
offlineUnitPrice = offlinePrice * (product.unitPrice / product.onlinePrice)
naverUnitPrice   = naverResult.items[0].unitPrice  // 또는 DB market_unit_price
savingRate       = (naverUnitPrice / offlineUnitPrice - 1) * 100
```

`unit_price_label` (`/100ml`, `/개` 등)은 DB 값 그대로 사용.
DB에 없는 신규 상품(OCC API 조회)의 경우: `unit_price`가 null이면 단위가 비교 생략, 총액 비교만 표시.

**네이버 상품 카드 (STEP 3):**
- 썸네일 + 상품명 + 가격 + [N 이동] 버튼
- 탭 시 `window.open(naverUrl, '_blank')` 으로 네이버쇼핑 랜딩
- 최대 3개 표시

---

## 4. API 설계

### 4.1 신규: `GET /api/sourcing/costco/lookup`

**파라미터:** `?code={string}`

**응답 타입:**
```ts
interface LookupResult {
  source: 'db' | 'api';          // 데이터 출처
  productCode: string;
  title: string;
  imageUrl: string | null;
  categoryName: string | null;
  onlinePrice: number;           // 코스트코 온라인몰 가격
  averageRating: number | null;
  reviewCount: number;
  unitPriceLabel: string | null; // "/L", "/개" 등
  unitCount: number | null;      // 패키지 내 수량 (단위가 계산용)
  marketLowestPrice: number | null;  // DB 캐시값 (즉시 비교용)
  marketUnitPrice: number | null;
  productUrl: string;
}
```

**처리 로직:**
```
1. Supabase에서 product_code = code 조회
2. 있으면 → CostcoProductRow → LookupResult 매핑 후 반환 (source: 'db')
3. 없으면 → fetchCostcoProduct(code) 호출
4. OCC 응답 → LookupResult 매핑 후 반환 (source: 'api', market* 필드는 null)
5. 코드 미존재(OCC도 404) → 404 반환
```

### 4.2 신규: `GET /api/sourcing/costco/naver-compare`

기존 `naver-prices` 라우트는 POST 배치 크론용이라 직접 재사용 불가.
단일 상품 실시간 조회를 위한 별도 GET 엔드포인트를 추가한다.

**파라미터:** `?code={string}&title={string}`

**처리 로직:**
```
1. code가 있으면 DB에서 unit 정보(unit_type, total_quantity, unit_price_label 등) 조회
2. searchNaverUnitPrice(title, costcoUnit) 호출 (기존 naver-shopping 라이브러리 재사용)
3. 단위 정보 없으면 searchNaverLowestPrice(title) fallback
4. 상위 3개 상품 반환: { title, price, unitPrice, imageUrl, productUrl }
```

**응답 타입:**
```ts
interface NaverCompareResult {
  items: {
    title: string;
    totalPrice: number;
    unitPrice: number | null;
    unitPriceLabel: string | null;
    imageUrl: string | null;
    productUrl: string;
  }[];
  source: 'unit' | 'total';   // 단위가 검색 vs 총액 fallback
}
```

---

## 5. 검색창 상태 관리

`MobileCostcoList.tsx` 내 기존 `search` 상태 그대로 사용.
코드 감지는 파생 값으로 처리 (별도 상태 없음):

```ts
const isProductCode = /^\d{7}$/.test(search);
```

- `isProductCode === true`: `MobileCodeSearchCard` 렌더 (기존 목록 위)
- `isProductCode === false`: 기존 텍스트 검색 필터 동작

X 버튼: `setSearch('')` → 코드 모드 자동 해제.

---

## 6. 에러 처리

| 상황 | 처리 |
|------|------|
| lookup API 404 | "해당 상품코드를 찾을 수 없습니다" 메시지 + X 버튼 |
| lookup API 500 | "조회 중 오류가 발생했습니다. 다시 시도해주세요" + 재시도 버튼 |
| Naver API 실패 | DB 캐시값만 표시, "실시간 조회 실패" 작은 안내 |
| 이미지 로딩 실패 | 📦 이모지 fallback (기존 동일) |
| unit_count null | 단위가 계산 생략, 총액 비교만 표시 |
| offlinePrice = 0 또는 미입력 | [비교하기] 버튼 disabled |

---

## 7. 변경 범위 요약

| 파일 | 변경 종류 | 내용 |
|------|-----------|------|
| `src/components/sourcing/mobile/MobileCostcoList.tsx` | 수정 | 검색창 코드 감지 + MobileCodeSearchCard 조건 렌더 |
| `src/components/sourcing/mobile/MobileCodeSearchCard.tsx` | 신규 | 3단계 분석 카드 컴포넌트 |
| `src/app/api/sourcing/costco/lookup/route.ts` | 신규 | DB + OCC API 상품 단일 조회 라우트 |
| `src/app/api/sourcing/costco/naver-compare/route.ts` | 신규 | 단일 상품 실시간 Naver 비교 라우트 |

기존 파일 변경 없음:
- `costco-client.ts` (fetchCostcoProduct 재사용)
- `costco-pricing.ts`, `unit-parser.ts`
- `naver-shopping.ts` (searchNaverUnitPrice, searchNaverLowestPrice 재사용)
- `MobileCostcoDetail.tsx`, `MobileBottomSheet.tsx`
- 기존 목록/필터/정렬 전체
