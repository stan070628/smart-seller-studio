# 배송비 불일치 수정 설계

> 작성일: 2026-07-05
> 대상: 판매 임포트 6개 경로 + FIFO 엔진 (`src/lib/cost-management/fifo.ts`, `src/app/api/cost-management/**`)
> 선행 문서: [업그레이드 로드맵](./2026-07-05-cost-management-upgrade-roadmap.md) §2.1

## 0. 문제

같은 주문이라도 어떤 경로로 가져왔느냐에 따라 실현손익이 달라진다.

| 경로 | 윙 배송비 | RG 배송비 | 네이버 배송비 |
|---|---|---|---|
| 단건 `coupang-import` | 3,500 (`route.ts:192`) | 0 (`:277`) | 3,500 (`:321`) |
| 일괄 `*-bulk-import` | **없음→0** | **없음→0** | **없음→0** |

일괄 임포트는 INSERT에 `shipping_fee` 컬럼을 아예 넣지 않아 DB 기본값 0으로 저장된다. `fifo.ts:135-139`에서 `sale.shipping_fee`가 실현손익에서 직접 차감되므로, 이 불일치는 표시 숫자를 실제로 왜곡한다.

추가로 발견된 잠복 이슈: `fifo.ts`는 배송비를 **개당**으로 차감(`shipping_fee_per_unit × quantity`)한다. 택배비는 배송 1건당이므로, 수량 2개 주문은 3,500 × 2 = 7,000이 차감되는 과다 차감이 발생한다.

## 1. 목표

- 단건·일괄 모든 임포트가 **동일한 배송비 규칙**을 쓰게 한다.
- 배송비를 **건당(sale_record 1건당)** 차감으로 바로잡는다.
- 배송비 규칙을 한 곳(공용 모듈)에 두어 재발을 막는다.

**성공 기준:** 같은 주문을 단건/일괄 어느 경로로 가져와도 실현손익이 동일하다. 수량 N개 주문의 배송비 차감은 3,500 × 1(건당)이다.

## 2. 공용 배송비 규칙 (신규 모듈)

`src/lib/cost-management/sale-shipping.ts`:

```ts
export const DEFAULT_PARCEL_SHIPPING_FEE = 3500;

export type ShippingSource = 'wing' | 'rg' | 'naver';

// 윙·네이버(판매자 택배) = 기본 택배비, RG(로켓그로스) = 0 (unit_rg_shipping_fee로 별도 반영)
export function resolveSaleShippingFee(source: ShippingSource): number {
  return source === 'rg' ? 0 : DEFAULT_PARCEL_SHIPPING_FEE;
}
```

- 배송비는 저장된 `channel` 문자열이 아니라 **임포트 소스**(각 라우트가 아는 값)로 결정한다. 이유: 단건 임포트에서 윙·RG 모두 `channel`이 'coupang'/'rocket_growth'로 갈리지만, 규칙의 근거는 "판매자 택배인가 RG 물류인가"이므로 소스 enum이 더 명확하다.
- 수동 입력 판매(`SaleEntryPanel`)의 사용자 입력 `shipping_fee`는 대상이 아니다 — 그대로 유지.

## 3. 임포트 6개 경로 통일

모두 `resolveSaleShippingFee`로 배송비를 산정해 INSERT에 포함한다.

**단건 `coupang-import/route.ts`** (값은 동일, 규칙만 일원화):
- Phase1 윙(`:192`): `shipping_fee: 3500` → `resolveSaleShippingFee('wing')`
- Phase2 RG(`:277`): `shipping_fee: 0` → `resolveSaleShippingFee('rg')`
- Phase3 네이버(`:321`): `shipping_fee: 3500` → `resolveSaleShippingFee('naver')`

**일괄 (현재 `shipping_fee` 미포함 → 추가):**
- `wing-bulk-import/route.ts`: INSERT 컬럼 목록과 VALUES에 `shipping_fee` 추가, 값 `resolveSaleShippingFee('wing')`.
- `rg-bulk-import/route.ts`: 동일 구조로 `resolveSaleShippingFee('rg')`(= 0) 추가. (명시적으로 0을 넣어 규칙을 드러낸다.)
- `naver-bulk-import/route.ts`: `resolveSaleShippingFee('naver')` 추가.

INSERT 문 파라미터 인덱스가 하나씩 밀리므로 각 라우트의 `values.push(...)`/플레이스홀더를 함께 수정한다.

> 쿠폰(`coupon_discount`)은 이번 범위 밖(§6). 일괄은 계속 0으로 둔다.

## 4. FIFO 건당 배송비 (`fifo.ts`)

현재(`:127-142`):
```ts
const shipping_fee_per_unit = sale.shipping_fee ?? 0;
const realized_profit_per_unit =
  effective_price - fifo_cost_per_unit - fee_per_unit - shipping_fee_per_unit;
sale_details.push({ saleId, fifo_cost_per_unit, realized_profit_per_unit });
total_realized_profit += realized_profit_per_unit * sale.quantity;
```
문제: 배송비가 개당 차감된 뒤 `× quantity` → 배송비 × 수량.

**변경:** 배송비는 sale_record 1건당 한 번만 차감한다.
```ts
const realized_profit_per_unit =
  effective_price - fifo_cost_per_unit - fee_per_unit;           // 배송비 제외 (per-unit)
const shipping_fee = sale.shipping_fee ?? 0;
const realized_profit =
  realized_profit_per_unit * sale.quantity - shipping_fee;       // 건당 배송비 1회 차감
sale_details.push({ saleId, fifo_cost_per_unit, realized_profit_per_unit, realized_profit });
total_realized_profit += realized_profit;
```

**`SaleFifoDetail` 계약 변경:** per-sale `realized_profit` 필드 추가.
```ts
export interface SaleFifoDetail {
  saleId: string;
  fifo_cost_per_unit: number;
  realized_profit_per_unit: number; // 배송비 제외 per-unit (표시용 보존)
  realized_profit: number;          // 건당 배송비 반영한 이 판매의 실현손익 총액
}
```

## 5. 소비처 수정

- **`products/route.ts:212-214`**: 현재 `sum(d.realized_profit_per_unit × quantity)` → `sum(d.realized_profit)`로 교체(기간 필터 유지). 이 값이 배송비 건당 반영된 정확한 실현손익.
- **`fifo-summary/route.ts`**: `result.total_realized_profit`를 그대로 사용(`:61`) → fifo 내부 수정으로 자동 정확. **수정 불필요.**
- 그 외 `realized_profit_per_unit` 소비처 없음(grep 확인). 표시용 필드로만 남는다.

## 6. 범위 밖 (명시)

- **쿠폰 일괄 반영**: 일괄 임포트는 계속 `coupon_discount = 0`. 즉시할인 API(N+1)·정책 적용은 별도 스펙(로드맵 §3.2 연계).
- **택배비 유저별 설정 UI**: 상수 3,500 고정. 설정화는 후속.
- **취소/반품 소급**: 로드맵 §2.2 별도.
- **기존 데이터 소급 보정**: 이번 변경은 임포트/계산 로직만. 이미 0으로 저장된 과거 일괄 임포트 행의 배송비는 재임포트 시 `ON CONFLICT`로 갱신되지 않는다(단건은 `WHERE coupon_discount = 0` 조건, 일괄은 `DO NOTHING`). 과거 행 보정은 범위 밖 — 문서에 한계로 명시.

## 7. 테스트

- **`sale-shipping.ts` 단위 테스트**: `resolveSaleShippingFee('wing'|'naver')===3500`, `('rg')===0`.
- **`fifo.test.ts` / `cost-management-calculations.test.ts`**: 건당 배송비로 기대값 갱신. **신규 케이스**: 수량 2개 + 배송비 3,500 → 배송비 총 차감 3,500(개당 아님) 검증. `realized_profit` 필드 검증 추가.
- **임포트 라우트**: 기존 API 테스트가 있으면 `shipping_fee`가 INSERT에 포함되는지 보강. (없으면 라우트 단위 테스트는 신설하지 않고 로직을 helper로 뽑아 helper만 테스트.)

## 8. 파일 요약

| 파일 | 변경 |
|---|---|
| `src/lib/cost-management/sale-shipping.ts` | 신규 — 상수 + `resolveSaleShippingFee` |
| `src/lib/cost-management/fifo.ts` | `SaleFifoDetail`에 `realized_profit` 추가, 건당 배송비 계산 |
| `src/app/api/cost-management/products/route.ts` | `:214` 합산을 `d.realized_profit`로 |
| `src/app/api/cost-management/products/[id]/coupang-import/route.ts` | 3곳 배송비를 helper로 |
| `src/app/api/cost-management/wing-bulk-import/route.ts` | INSERT에 `shipping_fee` 추가 |
| `src/app/api/cost-management/rg-bulk-import/route.ts` | INSERT에 `shipping_fee` 추가(=0) |
| `src/app/api/cost-management/naver-bulk-import/route.ts` | INSERT에 `shipping_fee` 추가 |
| 테스트 3~4개 | 위 §7 |

## 9. 리스크

| 리스크 | 완화 |
|---|---|
| `realized_profit_per_unit` 의미 변경(배송비 제외)으로 잠재 소비처 오작동 | grep으로 소비처 route.ts 1곳만 확인 — 그 곳을 `realized_profit`로 교체. 표시용 per-unit은 어디서도 손익 재합산에 안 씀 |
| INSERT 파라미터 인덱스 밀림 | 각 bulk 라우트에서 컬럼·플레이스홀더·values 순서를 함께 수정, 테스트로 확인 |
| 기존 fifo 테스트 대량 실패 | 건당 배송비로 기대값을 의도적으로 갱신(회귀 아님, 정정) |
