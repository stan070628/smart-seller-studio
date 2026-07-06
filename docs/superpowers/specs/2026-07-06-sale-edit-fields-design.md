# 판매 편집 누락 필드 설계

> 작성일: 2026-07-06
> 대상: `SaleEntryPanel` + `sales/[id]` PATCH API
> 선행 문서: [업그레이드 로드맵](./2026-07-05-cost-management-upgrade-roadmap.md) §1.3 (C)

## 0. 문제

판매 내역 인라인 편집(`SaleEntryPanel`)에서 **쿠폰할인·채널을 수정할 수 없다**. `SaleForm`(`:25-28`)은 `sold_at/quantity/selling_price/shipping_fee`만 담고, 편집 행(`:385`)엔 "쿠폰할인/채널/사이즈는 편집 불가 — 빈 셀" 주석이 있으며, `save()`(`:144`)와 PATCH API(`sales/[id]/route.ts:16`)도 이 4개 필드만 처리한다. 쿠폰할인은 실현손익(`effective_price = selling_price - coupon_discount`)에 직접 영향하는데도 수정 수단이 없다.

## 1. 목표

- 판매 편집에서 **쿠폰할인**과 **채널**을 수정할 수 있게 한다.

**성공 기준:** 판매 행 편집 시 쿠폰할인(숫자)·채널(선택)을 바꿔 저장하면 DB·실현손익에 반영된다.

## 2. API PATCH (`sales/[id]/route.ts`)

- 허용 필드에 `coupon_discount`, `channel` 추가.
- 검증:
  - `coupon_discount`: `undefined` 또는 음수 아닌 정수.
  - `channel`: `undefined` 또는 `'manual' | 'coupang' | 'rocket_growth' | 'naver'` 중 하나.
- "변경 없음" 가드(`:44`)에 두 필드 포함.
- `UPDATE`에 `coupon_discount = COALESCE($5, coupon_discount)`, `channel = COALESCE($6, channel)` 추가(파라미터 인덱스 확장).

## 3. 프론트 (`SaleEntryPanel.tsx`)

**SaleForm 타입 + emptyForm**: `coupon_discount: string`, `channel: string` 추가. `emptyForm()` 기본값 `coupon_discount: '0'`, `channel: 'manual'`.

**startEdit**(`:178`): 폼 채우기에 추가:
```ts
      coupon_discount: String(s.coupon_discount ?? 0),
      channel: s.channel ?? 'manual',
```

**편집 행 UI**(`:385` "빈 셀" 2개 셀 교체):
- 쿠폰할인: `<input type="number" min="0">` (form.coupon_discount).
- 채널: `<select>` 옵션 쿠팡윙(`coupang`)/로켓그로스(`rocket_growth`)/네이버(`naver`)/수동(`manual`).

**save payload**: §4의 `buildSalePayload(form)` 사용.

> 새 판매 추가 모드(`:462` "자동 지정")는 현행 유지 — 이 스펙은 **편집**만 보강. 단 `buildSalePayload`는 추가/편집 공통으로 써도 무방(추가 시 coupon 0·channel manual 기본값이 그대로 전송).

## 4. 순수 헬퍼 `buildSalePayload`

`src/components/orders/sale-payload.ts` (신규):
```ts
export interface SaleFormInput {
  sold_at: string;
  quantity: string;
  selling_price: string;
  shipping_fee: string;
  coupon_discount: string;
  channel: string;
}
export interface SalePayload {
  sold_at: string;
  quantity: number;
  selling_price: number;
  shipping_fee: number;
  coupon_discount: number;
  channel: string;
}
export function buildSalePayload(form: SaleFormInput): SalePayload {
  return {
    sold_at: form.sold_at,
    quantity: Math.round(Number(form.quantity)),
    selling_price: Math.round(Number(form.selling_price)),
    shipping_fee: Math.max(0, Math.round(Number(form.shipping_fee))),
    coupon_discount: Math.max(0, Math.round(Number(form.coupon_discount))),
    channel: form.channel,
  };
}
```
`save()`는 이 헬퍼로 payload를 만든다(기존 인라인 계산 대체). 유효성(`sold_at`·`quantity>0`)은 기존대로 `save()`에서 검사.

## 5. 테스트

- **`buildSalePayload` 단위 테스트**: 숫자 반올림, `shipping_fee`/`coupon_discount` 음수 방어(max 0), `channel` 통과, 빈 문자열 → NaN 방어(빈 값은 `save()` 유효성에서 걸러지므로 헬퍼는 반올림만).
- API PATCH 검증·`UPDATE` 확장, 편집 UI 배선은 리뷰 + 수동 검증(편집→저장→실현손익 반영).

## 6. 파일 요약

| 파일 | 변경 |
|---|---|
| `src/app/api/cost-management/sales/[id]/route.ts` | `coupon_discount`·`channel` 허용·검증·UPDATE |
| `src/components/orders/sale-payload.ts` | 신규 — `buildSalePayload` |
| `src/components/orders/SaleEntryPanel.tsx` | SaleForm/emptyForm/startEdit/편집행 UI/save |
| `src/__tests__/components/sale-payload.test.ts` | 헬퍼 단위 테스트 |

## 7. 범위 밖

- 사이즈(`variant_name`) 편집 — 별도 옵션 관리 흐름(`ChannelCell` variant-name).
- 새 판매 추가 시 쿠폰/채널 수동 지정 UI — 편집만 보강.
- 채널 변경 시 `coupang_order_item_id` 키 정합성 — 수동 편집이라 키는 그대로 두며, dedup 영향 없음(임포트 키와 무관).

## 8. 리스크

| 리스크 | 완화 |
|---|---|
| PATCH 파라미터 인덱스 밀림 | UPDATE의 `$5`/`$6`와 파라미터 배열 순서를 함께 수정, 리뷰 확인 |
| 잘못된 channel 값 저장 | API에서 허용셋 검증, 프론트는 select라 임의값 불가 |
| 빈 coupon_discount 입력 | `Number('')`은 0이라 `Math.round(Math.max(0, ...))`가 0으로 안전 처리 |
