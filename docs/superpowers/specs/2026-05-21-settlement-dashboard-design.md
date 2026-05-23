# 정산 대시보드 — 비용 관리 탭 통합 설계

## 배경

쿠팡 OpenAPI로 학습한 `revenue-history`(상품별 매출/수수료)와 `settlement-histories`(월별 지급 내역)를 활용해, 기존 비용 관리 탭에 정산 가시성을 추가한다.

**해결하는 문제:**
- A. 이번 달 지급 예정액을 WING에 직접 들어가서 확인해야 함
- B. 상품별 실효 수수료율이 달라 실 정산액 계산이 어려움
- C. 반품 차감이 어디서 빠지는지 불투명
- D. 쿠폰/할인이 정산에서 얼마나 나가는지 불분명

**구현하지 않는 것:** 쿠폰 생성/관리, 지급 유형별(주/월정산) 분리 표시, CSV 내보내기

---

## 접근 방식

기존 CostManagementTab 레이아웃을 최소 변경하는 "섹션 확장 + 드릴다운" 방식. 기존 실제 매출 카드 5개 뒤에 카드 3개를 추가하고, 상단에 지급 배너를 추가한다.

---

## API 레이어

### 신규 1: `GET /api/cost-management/settlement-summary`

**Query:** `month=2026-05` (yyyy-MM)

**내부 동작:**
- `settlement-histories?revenueRecognitionYearMonth={month}` 호출
- 응답 배열 중 가장 최근 항목 반환

**응답:**
```json
{
  "month": "2026-05",
  "totalSale": 15000000,
  "serviceFee": 1500000,
  "settlementTargetAmount": 13500000,
  "finalAmount": 12450000,
  "settlementDate": "2026-06-03",
  "status": "SUBJECT"
}
```

**엣지:** 데이터 없으면 `null` 반환 (배너 숨김).

---

### 신규 2: `GET /api/cost-management/fee-breakdown`

**Query:** `from=2026-05-01&to=2026-05-31`

**내부 동작:**
1. `recognitionDateTo`를 min(to, 어제) 로 조정 (당일 조회 불가 제약)
2. 31일 초과 시 `splitInto30DayChunks`로 분할 후 병렬 호출
3. `vendorItemId` 기준으로 결과 집계

**응답:**
```json
{
  "summary": {
    "totalFee": 1480000,
    "totalCoupon": 320000,
    "totalSettlement": 11200000
  },
  "items": [
    {
      "vendorItemId": 5307184135,
      "vendorItemName": "상품명, 옵션",
      "saleAmount": 1200000,
      "serviceFeeRatio": 10.5,
      "serviceFee": 126000,
      "couponDeduction": 15000,
      "settlementAmount": 1059000
    }
  ]
}
```

**엣지:** 전체 기간(`preset=all`) 선택 시 호출 생략.

---

## UI 컴포넌트

### ① 지급 상태 배너

위치: 기간 필터와 섹션 A(실제 매출) 사이.

표시 조건: 단일 월이 선택된 경우만 (이번 달, 지난 달, 직접 입력으로 1개월 범위일 때).

```
💰 2026년 5월 지급 예정액  12,450,000원  ·  6월 3일 입금 예정   [SUBJECT 배지]
✅ 2026년 4월 최종 지급    11,820,000원  ·  5월 8일 완료         [DONE 배지]
```

- SUBJECT: 노란 배지, DONE: 초록 배지
- `settlement-summary` 로딩 중 스켈레톤 표시
- 데이터 없으면 배너 미표시

---

### ② 수수료/정산 카드 3개

기존 5개 카드 (`실제 총 매출`, `쿠팡`, `네이버`, `RG`, `전기대비`) 뒤에 추가.

| 카드 | 표시 값 | 색상 | 클릭 동작 |
|------|---------|------|---------|
| 서비스 수수료 | `totalFee`원 | 빨간 계열 | 드릴다운 패널 오픈 |
| 쿠폰 차감 | `totalCoupon`원 | 주황 계열 | 드릴다운 패널 오픈 |
| 예상 정산액 | `totalSettlement`원 | 초록 계열 | 통합 요약 패널 오픈 |

카드 스타일: 기존 카드와 동일한 padding/border/border-radius 유지.

`fee-breakdown` 로딩 중: 카드 3개만 스켈레톤, 기존 5개 카드는 영향 없음.

---

### ③ 드릴다운 사이드 패널

기존 `CostEntryDrawer` 슬라이드 패턴 재사용. 우측에서 슬라이드 인.

**테이블 컬럼:**

| 상품명/옵션 | 매출금액 | 수수료율 | 수수료액 | 쿠폰차감 | 정산액 |
|------------|---------|---------|---------|---------|--------|

- `vendorItemId` 기준 집계 (productId 제외 — 머지/분리로 변경 가능)
- 기본 정렬: 수수료율 높은 순
- 마지막 행: 전체 합계 고정

빈 상태: "해당 기간 정산 내역 없음" 안내.

---

## 데이터 흐름

```
기간 필터 변경
  ├─ 기존 (유지): 주문 API + RG API → 실제 매출 카드 5개
  ├─ 신규: fee-breakdown API → 카드 3개 + 드릴다운 데이터
  │         └─ 31일 초과 → 청크 분할 병렬 호출 → 합산
  └─ 신규: settlement-summary API → 지급 배너
            └─ 선택 기간에서 월 추출 (단일 월만 표시)
```

---

## 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| 기간 필터 "전체" | fee-breakdown 생략, 배너 숨김, 기존 안내 문구 재사용 |
| 기간 31일 초과 | 31일 청크 병렬 호출 후 합산 |
| `recognitionDateTo` = 오늘 | 자동으로 어제 날짜 조정 |
| settlement 해당 월 없음 | 배너 미표시 |
| fee-breakdown 로딩 | 카드 3개만 스켈레톤 |
| 드릴다운 0건 | 빈 상태 안내 |

---

## 구현 파일 목록

| 파일 | 변경 유형 |
|------|---------|
| `src/app/api/cost-management/settlement-summary/route.ts` | 신규 |
| `src/app/api/cost-management/fee-breakdown/route.ts` | 신규 |
| `src/components/orders/CostManagementTab.tsx` | 수정 — 배너, 카드 3개, 드릴다운 패널 추가 |
| `src/lib/listing/coupang-client.ts` | 수정 — `getSettlementSummary()` 추가 |
