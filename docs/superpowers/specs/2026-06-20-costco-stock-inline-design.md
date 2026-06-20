# 코스트코 재고 인라인 확인 설계

**날짜:** 2026-06-20
**상태:** 확정

---

## 목적

내 상품 조회(BrowseMode)에서 소싱 출처가 코스트코 온라인 URL인 상품에 대해 **코스트코 실시간 재고 상태**를 소싱 배지 아래에 인라인으로 표시한다.

---

## UX

### 표시 위치

`SourcingBadge` 컴포넌트 — 기존 소싱 배지 바로 아래에 재고 상태 배지를 추가한다.

```
🌐 코스트코 온라인
✓ 재고있음  · 2시간 전  [🔄]
```

```
🌐 코스트코 온라인
⚠ 코스트코 품절  · 1시간 전  [🔄]
```

- `[🔄]` 버튼: 수동 새로고침 (즉시 재확인 후 DB 업데이트)
- 코스트코 URL이 아닌 소싱 출처는 재고 배지 없음 (변경 없음)

### 상태 표시

| `costco_stock_status` | 배지 텍스트 | 색상 | 행 배경 |
|---|---|---|---|
| `inStock` | ✓ 재고있음 | 초록 | 변경 없음 |
| `lowStock` | ⚡ 재고부족 | 주황 | 변경 없음 |
| `outOfStock` | ⚠ 코스트코 품절 | 빨강 | `#fff5f5` (연한 빨강) |
| `null` (미확인) | — | — | 변경 없음 |

---

## 데이터 모델

### `product_sourcing` 테이블 컬럼 추가

```sql
ALTER TABLE product_sourcing
  ADD COLUMN costco_stock_status TEXT
    CHECK (costco_stock_status IN ('inStock', 'outOfStock', 'lowStock')),
  ADD COLUMN costco_stock_checked_at TIMESTAMPTZ;
```

- 코스트코 URL(`sourcing_value LIKE '%costco.co.kr%'`)인 행에만 값이 채워짐
- 나머지 소싱 출처는 NULL 유지

---

## 데이터 흐름

```
BrowseMode 로드
  → GET /api/listing/sourcing  (기존 배치 조회 API)
       응답에 costco_stock_status + costco_stock_checked_at 포함 (신규 필드)
  → useListingStore.sourcingMap에 stock 상태 저장
  → SourcingBadge 렌더링

       [코스트코 URL + (checked_at 없음 or 6시간 초과)]
         → 백그라운드: POST /api/listing/sourcing/check-costco-stock
              { platform, productId }
              1. product_sourcing에서 sourcing_value(URL) 조회
              2. URL에서 코스트코 상품코드 추출
              3. /api/sourcing/costco/lookup 호출
              4. DB UPDATE costco_stock_status, costco_stock_checked_at
              5. { status, checkedAt } 반환
         → sourcingMap 업데이트 → 배지 즉시 갱신

       [수동 🔄 버튼 클릭]
         → 위 POST와 동일 (6시간 조건 무시하고 즉시 재확인)
```

### 코스트코 상품코드 추출

URL 예시: `https://www.costco.co.kr/p/1234567`

```ts
function extractCostcoCode(url: string): string | null {
  const m = url.match(/costco\.co\.kr\/.*?(\d{6,8})/);
  return m ? m[1] : null;
}
```

코드 추출 실패 시 → `costco_stock_status`를 업데이트하지 않음. 배지에 상태 미표시.

---

## 변경 파일 요약

| 파일 | 종류 | 역할 |
|---|---|---|
| `product_sourcing` 테이블 | DB 마이그레이션 | `costco_stock_status`, `costco_stock_checked_at` 컬럼 추가 |
| `src/app/api/listing/sourcing/route.ts` | 수정 | GET 응답에 `costco_stock_status`, `costco_stock_checked_at` 포함 |
| `src/app/api/listing/sourcing/check-costco-stock/route.ts` | 신규 | 단일 상품 코스트코 재고 확인 + DB 업데이트 |
| `src/store/useListingStore.ts` | 수정 | `sourcingMap` 타입 확장 + `checkCostcoStock` 액션 추가 |
| `src/components/listing/browse/BrowseMode.tsx` | 수정 | `SourcingBadge`에 재고 배지 + 🔄 버튼 + `outOfStock` 행 강조 추가 |
| `src/__tests__/api/listing-sourcing-costco-stock.test.ts` | 신규 | `check-costco-stock` route 단위 테스트 |

---

## 엣지케이스

| 케이스 | 처리 |
|---|---|
| 코스트코 URL이지만 코드 추출 실패 | 상태 미표시, 조용히 무시 |
| `/api/sourcing/costco/lookup` 실패 (5xx, 타임아웃) | DB 업데이트 안 함, 기존 캐시 유지 |
| 동일 상품 동시에 🔄 클릭 | `useListingStore`에서 요청 중 플래그(`checkingIds Set`) 관리, 중복 요청 방지 |
| 소싱 출처가 오프라인 코스트코(`sourcing_type = 'offline'`) | 재고 확인 대상 아님, 배지 없음 |
| 코스트코 API 속도 제한 | 여러 상품이 동시에 체크될 경우 순차 처리 (concurrency 1) |
