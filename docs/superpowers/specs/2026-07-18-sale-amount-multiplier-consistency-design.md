# 매출 축 정합성 (sale_amount) — unit_multiplier 버그 수정 설계

> 작성일: 2026-07-18
> 대상: `sale_records` 스키마, 판매 임포트 6경로, `fifo.ts`, `products/route.ts`, `SaleEntryPanel`
> 선행 관계: `2026-07-17-daily-settlement-design.md`의 **블로킹 선행 의존**(§4.1)

## 1. 배경

`sale_records.selling_price × quantity`가 실매출을 `unit_multiplier`배로 부풀린다. `product_cost_channels.unit_multiplier`(마이그 081, "판매 1건당 소비되는 단품 개수")를 도입하면서 임포트가 `quantity = 주문수량 × multiplier`(단품 축)로 저장하는데, `selling_price`는 **팩 단가** 그대로라서 두 컬럼이 서로 다른 축에 놓였다.

**버그이지 설계가 아니다.** `2026-06-21-channel-unit-multiplier-design.md`는 문제를 전적으로 재고 차감으로 규정했고(§1), 적용 예시(§6)에 매출 라인이 없으며, `selling_price`는 스펙·플랜·마이그레이션 어디에도 언급되지 않는다. 재고 축을 고치며 매출 축이 딸려 망가진 부작용이다.

### 피해 범위 (코드 대조 확인)

- `src/lib/cost-management/fifo.ts:131-143` — `effective_price`(단가)에서 수수료·원가를 빼고 `× quantity`. 매출과 수수료가 multiplier배로 뛰는데 **원가 항(`fifo_cost_per_unit × quantity`, `:110-127`)은 정확**하다. 즉 실현손익이 단순 배수가 아니라 **엉뚱한 값**이 된다.
- `src/app/api/cost-management/products/route.ts:216` — `periodSalesAmount = selling_price × quantity`. 원가 탭 매출과 그룹 합계(`product-grouping.ts:65`)를 부풀린다.
- `src/app/api/roi/route.ts:147-190`는 `sale_records`를 읽지 않고 쿠팡 `revenue-history`를 직접 읽어 **영향 없음**. 그래서 원가 탭과 ROI가 조용히 다른 숫자를 보여줘 왔고 아무도 불일치를 신고하지 않았다.
- 테스트 **전무**. `grep multiplier src/__tests__` → 0건. `fifo.test.ts` 픽스처는 전부 multiplier=1이라 오히려 "selling_price = 단품 단가" 규약을 약하게 고정한다(임포트가 쓰는 것과 반대).

### 현재 실害 상태

**지금은 `unit_multiplier > 1`인 상품이 없다** (사용자 확인, 2026-07-18). 따라서:
- 기존 모든 `sale_records`가 `multiplier = 1` → `selling_price × quantity`가 현재는 정확.
- 버그는 **잠복**해 있다. 2개입 상품을 등록하고 multiplier를 2로 설정하는 순간부터 그 상품 매출이 2배로 뜨기 시작한다.

**따라서 이 스펙의 목적은 "지금 틀린 데이터 교정"이 아니라 "읽기·쓰기 경로를 축-정합하게 만들어 앞으로 안 터지게 하고, 겸사겸사 `sale_amount`를 무손실로 채워둔다"이다.** 백필이 공짜인 지금 해둔다.

## 2. 접근 — 매출을 저장하고, 다시는 곱으로 유도하지 않는다

`sale_records`에 실매출 총액 컬럼 `sale_amount`를 추가한다. 임포트는 쿠팡/네이버가 확정한 금액을 그대로 넣고, 읽는 쪽은 그 값을 읽기만 한다.

세 금액 컬럼이 각각 다른 축의 진실을 하나씩 맡는다:

| 컬럼 | 축 | 의미 |
|---|---|---|
| `sale_amount` | 매출 | 그 판매가 번 돈 (총액) |
| `quantity` | 재고 | 그 판매로 빠진 단품 개수 |
| `selling_price` | 표시 | 팩 표시가격. **계산에 쓰지 않음**, 참고 표시·폴백용 |

**핵심 불변식**: 매출은 저장된 `sale_amount`를 읽는다. `selling_price × quantity` 곱셈은 폴백을 제외하고 코드에서 제거한다. 두 축을 섞어 곱한 것이 버그의 근원이었다.

### 대안 검토

- **A. `selling_price`를 단품 단가로 정규화**(`÷ multiplier` 저장): 읽기 경로 무변경이지만 나누어떨어지지 않으면 **반올림 오차가 영구히 박히고**(3개입 10,000원 → 3,333×3 = 9,999) 실주문가가 소실된다. 정산 대조 재개 시 상시 차이의 원인이 된다 → 기각.
- **C. `order_quantity`(팩수) 컬럼 추가**: 무손실이나 매출을 여전히 곱셈으로 유도. B가 유도 자체를 없애므로 우위.
- **B(채택)**: 쿠팡 `saleAmount`는 부분취소·라인 조정이 반영된 실제 금액일 수 있어, 유도값이 아닌 확정 금액을 보관하면 정산 대조 재개 시 "쿠팡이 말한 그 숫자"가 이미 DB에 있다.

## 3. 데이터 모델

### 마이그레이션 (다음 순번, 087 예상)

> 번호 주의: 본 스펙이 선행이므로 다음 순번을 먼저 차지한다. `2026-07-17-daily-settlement`의 `daily_expenses` 마이그레이션과 §4.2 `shipping_fee` 복구 마이그레이션은 그 뒤 번호로 밀린다. 최종 번호는 구현 시 확정.

```sql
ALTER TABLE sale_records ADD COLUMN IF NOT EXISTS sale_amount int;

-- 백필: 현재 전 판매가 multiplier=1이므로 selling_price×quantity가 정확하다.
-- 이 UPDATE가 옳은 것은 "multiplier>1 판매가 존재하지 않는다"는 전제 위에서만 성립한다.
UPDATE sale_records SET sale_amount = selling_price * quantity WHERE sale_amount IS NULL;
```

- **NOT NULL로 하지 않는다.** 백필과 신규 코드 배포 사이의 틈, 레거시 행 안전을 위해 NULL을 허용하고 읽기 경로가 폴백한다(§5).
- `IF NOT EXISTS` — 운영 DB 재적용 무해.
- 주석에 전제("multiplier>1 없음")를 명시해 향후 오해 방지.

## 4. 쓰기 경로 — 임포트가 sale_amount를 채운다

원칙: **우리가 곱하지 않는다. 채널이 알려준 금액을 그대로 넣는다.**

| 경로 | `sale_amount` 소스 |
|---|---|
| `wing-bulk-import/route.ts:128-130` | 응답 inner item의 `saleAmount` (`coupang-client.ts:653`) |
| `rg-bulk-import/route.ts:98-101` | RG 응답 라인 판매금액 |
| `coupang-import/route.ts:184-187` (윙) | `saleAmount` (윙 phase) |
| `coupang-import/route.ts:272` (RG) | RG 라인 판매금액 |
| `coupang-import/route.ts:314` (네이버) | `totalPaymentAmount` (이미 총액) |
| `naver-bulk-import/route.ts:70-74` | `totalPaymentAmount` |

`quantity`(× multiplier)와 `selling_price`(팩 단가)는 **현행 유지** — 재고 축은 이미 옳다.

**윙 `salePrice`가 단가/총액인지 논쟁은 우회된다**: `saleAmount`가 라인 총액으로 응답에 이미 있으므로(`coupang-client.ts:636,653`) `salePrice`를 곱할 필요가 없다.

## 5. 읽기 경로 — sale_amount를 읽고, fifo를 총액 축으로 재구성

모든 매출 계산을 `sale_amount ?? (selling_price × quantity)`로 바꾼다. 폴백은 multiplier=1인 현재·레거시 행에서 항상 정확하며, 배포 순서 안전망이 된다(§6).

### 5.1 `products/route.ts:216`

```
periodSalesAmount = Σ( sale_amount ?? (selling_price × quantity) )
```

### 5.2 `fifo.ts:131-143` — 단가 축 → 총액 축 재구성

현재는 `effective_price`(단가) 기준이라 매출·수수료가 multiplier배로 오염된다. 판매 라인을 총액 기준으로 재구성한다:

```
매출     = sale_amount ?? (selling_price × quantity)
쿠폰     = coupon_discount                         -- 건당 총액 (임포트 저장 단위)
실효매출  = 매출 - 쿠폰
수수료    = round(실효매출 × platformFeeRate)        -- 총액에 한 번
원가     = fifo_cost_per_unit × quantity           -- 기존과 동일, 이미 정확 (:110-127)
실현손익  = 실효매출 - 원가 - 수수료 - shipping_fee    -- shipping_fee는 건당 1회
```

**부수 효과 — 쿠폰 과차감 버그도 함께 고쳐진다.** 현재 `fifo.ts:131`은 `coupon_discount`를 단가에서 빼 수량>1이면 과차감한다(`2026-07-17-daily-settlement-design.md` §4.3). 총액 축으로 바꾸면 건당 총액인 `coupon_discount`를 매출 총액에서 한 번만 빼므로 축이 맞는다. multiplier·쿠폰 두 버그가 같은 재구성으로 정리된다.

- `SaleFifoDetail`의 `fifo_cost_per_unit`, `realized_profit_per_unit` 등 파생 필드 표기는 유지하되, `realized_profit`은 위 총액식으로 계산. per-unit 표시가 필요하면 `실현손익 / quantity`로 유도.
- `bulk 임포트는 coupon_discount=0 고정`(`2026-07-05-shipping-fee-consistency-design.md` §6)이라 대부분 행에서 쿠폰이 0이다. 이는 본 스펙 범위 밖의 별개 한계로 남긴다(§9).

### 5.3 기타 읽기 경로 — 변경 없음 확인

- `variant-stock/route.ts:34-36` — `quantity`만 합산. 재고 축이라 정확, 무변경.
- `roi/route.ts` — `sale_records` 미참조, 무변경.

## 6. 배포 순서

폴백(`sale_amount ?? …`)이 각 단계를 독립적으로 안전하게 만든다:

1. **마이그레이션 087** (컬럼 + 백필) — 읽기 코드는 아직 구버전이나 `selling_price × quantity`를 계속 쓰므로 정상.
2. **쓰기 경로 배포** — 신규 임포트가 `sale_amount`를 채우기 시작. 구·신규 행 혼재.
3. **읽기 경로 배포** — 폴백이 `sale_amount` 유무를 흡수해 혼재 상태에서도 정확.

어느 단계에서 멈춰도 숫자가 깨지지 않는다.

## 7. 수동 입력 (SaleEntryPanel)

**정정 사항**: `SaleEntryPanel`은 상품(`productId`) 단위로 열리고 채널을 `manual/coupang/rocket_growth/naver` select로만 고른다. **옵션ID(`external_id`)를 특정하지 않으므로 `unit_multiplier`를 자동 적용할 수 없다** (multiplier는 옵션ID 단위 설정). 초안의 "채널 설정에서 자동 적용"은 성립 불가.

따라서 수동 입력은 **단품 축으로 받는다** — `2026-06-21` 스펙 §8("사용자가 직접 소비 개수를 입력")의 정신과 일치:

- 입력: `판매가` = **단품 1개 가격**, `수량` = **단품 개수**
- 저장: `sale_amount = 판매가 × 수량`, `quantity = 수량`, `selling_price = 판매가`
- `SaleEntryPanel.tsx:366,387,477`의 `판매가` 입력에 **"단품 1개 가격" 힌트** 추가로 현재의 모호함 제거.

수동 입력에서 2개입을 팔 일이 있으면 사용자가 단품 수량으로 환산해 넣는다(예: 2개입 3팩 → 수량 6). 이는 임포트가 자동으로 하는 일을 수동으로 하는 것이며, multiplier 정보가 없는 경로에서 택할 수 있는 유일하게 정합한 규약이다.

## 8. 테스트 (선행 회귀 방어 → TDD)

**수정 전에 회귀 테스트를 먼저 깐다.** 현재 전무하므로 이 수정을 지켜줄 그물이 없다.

`src/lib/cost-management/__tests__/fifo.test.ts`:
- **multiplier=2 판매**(`sale_amount`=팩가×팩수, `quantity`=팩수×2)에서 매출·수수료·실현손익이 팩 기준으로 정확 — **현재 코드에서 실패, 수정 후 통과**. 이 스펙의 핵심 증거.
- `sale_amount = NULL` 레거시 행이 폴백으로 옛 결과와 동일 (회귀 없음 증거).
- 쿠폰이 총액에서 1회만 차감 (수량>1 과차감 방지).
- 기존 multiplier=1 픽스처 전부 그대로 통과 (폴백 경로).

`products/route.ts`:
- `sale_amount` 합산이 원가 탭 매출·그룹 합계와 일치.

수동 입력:
- 단품가·단품수량 입력이 `sale_amount = 판매가 × 수량`으로 저장.

**실행**: `npx vitest run src/lib/cost-management/__tests__ src/__tests__` (해당 경로만; 인자 없이 돌리면 무관한 실패 다수).

## 9. 범위 밖 (후속)

- **`coupon_discount` 단위 통일 및 bulk 임포트 쿠폰 0 고정 해소** — 본 스펙은 fifo를 총액 축으로 맞춰 *과차감*만 제거한다. 임포트가 쿠폰을 아예 0으로 저장하는 문제는 별개.
- **정산 대조 재개** — 본 스펙이 `sale_amount`를 확정 금액으로 보관해 재개의 토대를 놓지만, 윙 판매의 독립 소스 임포트가 여전히 선행 필요(`2026-07-17-daily-settlement-design.md` §3, §9-4).
- **윙 단건/일괄 키 불일치**(`2026-07-06` 스펙 §8) — 중복 행 문제. 무관.
- 기존 운영 DB의 과거 multiplier>1 오염 데이터 교정 — **해당 없음**(현재 그런 상품 없음). 향후 도입 시엔 도입 전 이 스펙이 이미 배포돼 있어야 함.

## 10. 구현 순서

1. `fifo.test.ts`·`products` 회귀 테스트 선작성 (multiplier=2 케이스가 현재 실패함을 확인)
2. 마이그레이션 087 (컬럼 + 백필)
3. 쓰기 경로 6곳 `sale_amount` 채우기
4. 읽기 경로: `products/route.ts:216`, `fifo.ts:131-143` 총액 축 재구성
5. `SaleEntryPanel` 단품가 힌트 + 저장 로직
6. 테스트 전부 통과 확인 (multiplier=2 통과, 기존 픽스처 회귀 없음)
