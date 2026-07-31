# 쿠팡 지급 확정 대조 (정산 탭 배너) — 설계

> 작성일: 2026-07-18
> 대상: `/orders` → 정산 탭, `src/app/api/settlement/payout`, `src/lib/listing/coupang-client.ts`
> 계보: 2026-05-21 정산 대시보드 스펙의 "지급 배너"를 정산 탭에 구현(당시 미구현). 일일 정산(2026-07-17) 후속.

## 1. 배경

정산 탭 "매출"은 우리가 임포트한 `sale_records` 기반이라, 쿠팡 Wing의 "로켓그로스 전체 매출 보기" 화면과 **완전히 일치하지 않는다.** 조사 결과(2026-07-18) 이 갭은 API로 해소 불가:
- 그 화면을 그대로 주는 쿠팡 Open API가 **없다**(developers.coupang.com 확인 — 정산 패밀리는 `revenue-history`·`settlement-histories` 2개뿐, 로켓그로스 패밀리엔 매출/정산 엔드포인트 없음).
- `revenue-history`는 우리 윙 `sale_records`의 **원천**이라 대조가 순환이고, 윙 전용·인식일 기준·등록 상품만 커버.
- RG는 독립 매출 API가 없어 `rg/orders`(우리 원천)뿐.

**딱 하나 진짜 독립적인 쿠팡 숫자**: `settlement-histories`(지급내역) = 쿠팡이 **실제로 지급하는 확정 금액**. 우리 임포트와 무관한 "실제 통장에 꽂히는 돈"이다. 이걸 월 단위로 내 장부와 대조한다.

**해결하는 문제:** 이번 달 쿠팡 지급 예정액을 확인하려면 Wing에 직접 들어가야 함(2026-05-21 스펙 §문제 A). 정산 탭에서 "쿠팡이 줄 금액 vs 내 계산"을 바로 본다.

## 2. 구현하지 않는 것 (YAGNI / 불가)

- **일별 쿠팡 매출 대조** — API로 불가(§1). Wing 화면과의 일별 갭은 스크래핑 외 방법 없음. 범위 밖.
- 지급 유형별(주/월정산) 분리, 반품 차감 상세, CSV 내보내기.
- 일별 표·순이익 계산 변경 없음 — **월 단위 정보용 배너만** 추가.

## 3. API 레이어

### 3.1 클라이언트 — `coupang-client.ts`에 `getSettlementHistories` 추가

`GET /v2/providers/marketplace_openapi/apis/api/v1/settlement-histories?revenueRecognitionYearMonth={YYYY-MM}` 호출. provider가 `marketplace_openapi`로 revenue-history(`openapi`)와 다르지만, 기존 `request()` HMAC 서명은 경로 기반이라 그대로 재사용된다.

응답에서 필요한 필드만 매핑(2026-05-21 스펙에서 학습한 구조):
```typescript
interface SettlementHistory {
  finalAmount: number;              // 지급 확정액 (실제 지급 금액)
  settlementTargetAmount: number;   // 정산 대상액
  serviceFee: number;               // 쿠팡 수수료
  settlementDate: string;           // 지급일 YYYY-MM-DD
  status: string;                   // SUBJECT 등
}
```
응답이 배열(지급 주기별 여러 건)이면 **finalAmount를 합산**하고 최근 `settlementDate`를 대표로 쓴다. 자격증명 미설정·API 실패 시 `null` 반환(`settlement-clients.ts:39` try/catch 패턴).

### 3.2 라우트 — 신규 `GET /api/settlement/payout?month=YYYY-MM`

- `month` 검증(`^\d{4}-\d{2}$`), 인증(`getCurrentUser`).
- `getSettlementHistories(month)` 호출.
- 응답:
```json
{ "success": true, "payout": { "finalAmount": 12450000, "settlementDate": "2026-08-03", "status": "SUBJECT" } }
```
- 데이터 없으면 `{ "success": true, "payout": null }` (배너 숨김). 외부 API라 실패해도 500 대신 `payout: null`로 처리(정산 화면 전체가 죽지 않게).

## 4. 화면 — 정산 탭 배너

정산 표 **위**에 한 줄 배너(월 이동 컨트롤 아래).

- **표시**: `쿠팡 지급 확정 {finalAmount}원 (지급일 {settlementDate}) · 내 장부 정산예상 {expected}원 · 차이 {diff}`
- **내 장부 정산예상** `expected = monthTotal.revenue − monthTotal.couponDiscount − monthTotal.platformFee`. 광고·박스·택배(내 비용)는 **빼지 않는다** — 쿠팡이 떼는 게 아니므로 "쿠팡이 정산해줄 금액"과 같은 축.
  - `monthTotal`은 이미 `GET /api/settlement/daily`가 반환하므로 그 값 재사용. `expected`는 프론트에서 계산.
- **차이** `diff = finalAmount − expected`. 음수면 붉게.
- 선택된 월(`ym`)에 연동. `SettlementTab`의 월 이동 시 payout도 재조회.

### 엣지
- `payout === null`(최근 달 미확정, 또는 자격증명 없음): 배너를 **"쿠팡 지급 미확정 — 정산 후 표시됩니다"** 회색 안내로. 오해 소지 있는 0·차이 안 띄움.
- 로딩 중: "쿠팡 지급 조회 중…".

## 5. 정직한 한계 (배너 문구에 반영)

- **월 단위**라 일별 갭(7/4 등)은 못 짚는다.
- 쿠팡 수수료 구조 ≠ 우리 `platform_fee_rate` 추정이라 `diff`가 0으로 딱 안 떨어질 수 있다. "대략 맞나"의 참고용. 배너에 작은 글씨로 "월 단위 참고 대조" 명시.

## 6. 파일

- 수정: `src/lib/listing/coupang-client.ts`(getSettlementHistories 추가)
- 신규: `src/app/api/settlement/payout/route.ts`
- 수정: `src/components/orders/SettlementTab.tsx`(배너 + payout fetch)
- 참고: `src/lib/dashboard/settlement-clients.ts`(try/catch·자격증명 패턴), 2026-05-21 스펙(응답 구조)

## 7. 테스트

- `getSettlementHistories`: 응답 매핑(배열 합산, 단건, 빈 배열→null) 단위 테스트. HMAC/네트워크는 목킹.
- `GET /api/settlement/payout`: pool/client 목킹으로 month 검증(400)·payout 매핑·null 처리.
- 배너: payout 있음/null/로딩 렌더는 tsc + 수동 확인.
- 실행: `npx vitest run src/__tests__/api/settlement-payout.test.ts` 등 경로 지정.

## 8. 검증(엔드투엔드, 수동)

정산 탭에서 지난달로 이동 → 쿠팡 지급 확정액 배너가 뜨고, 내 장부 정산예상과 차이가 표시되는지. 이번 달(미확정)은 "지급 미확정" 안내인지. 자격증명 없으면 배너 숨김.

## 9. 후속 (범위 밖)

- Wing 화면 스크래핑으로 일별 정확 매출(취약 경로, 광고 스크래퍼와 동일 문제).
- 반품 차감·수수료 상세 분해(2026-05-21 스펙 §fee-breakdown).
