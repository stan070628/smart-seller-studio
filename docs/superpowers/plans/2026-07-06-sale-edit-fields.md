# 판매 편집 누락 필드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매 내역 편집에서 쿠폰할인·채널을 수정할 수 있게 한다.

**Architecture:** 폼→payload 변환을 순수 헬퍼 `buildSalePayload`로 분리해 테스트하고, `sales/[id]` PATCH가 `coupon_discount`·`channel`을 받도록 확장한다. `SaleEntryPanel`은 편집 행의 "빈 셀"을 쿠폰할인 number input + 채널 select로 채운다.

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL (pg), Vitest.

**설계 문서:** `docs/superpowers/specs/2026-07-06-sale-edit-fields-design.md`

> **테스트 실행 주의:** 인자 없는 `npx vitest run`은 `node_modules.nosync` 라이브러리 테스트까지 돌려 대량 선재 실패한다. **항상 파일 경로를 지정**해 실행한다.

---

## File Structure

- **Create** `src/components/orders/sale-payload.ts` — `buildSalePayload` 순수 헬퍼.
- **Modify** `src/app/api/cost-management/sales/[id]/route.ts` — `coupon_discount`·`channel` 허용.
- **Modify** `src/components/orders/SaleEntryPanel.tsx` — 폼 타입/emptyForm/startEdit/편집행/ save.
- **Create** `src/__tests__/components/sale-payload.test.ts` — 헬퍼 테스트.

---

## Task 1: `buildSalePayload` 헬퍼

**Files:**
- Create: `src/components/orders/sale-payload.ts`
- Test: `src/__tests__/components/sale-payload.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/components/sale-payload.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildSalePayload } from '@/components/orders/sale-payload';

describe('buildSalePayload', () => {
  it('문자열 폼을 숫자 payload로 변환한다', () => {
    expect(buildSalePayload({
      sold_at: '2026-07-01', quantity: '3', selling_price: '19900',
      shipping_fee: '3500', coupon_discount: '1000', channel: 'coupang',
    })).toEqual({
      sold_at: '2026-07-01', quantity: 3, selling_price: 19900,
      shipping_fee: 3500, coupon_discount: 1000, channel: 'coupang',
    });
  });
  it('배송비·쿠폰할인 음수는 0으로 방어', () => {
    const p = buildSalePayload({
      sold_at: '2026-07-01', quantity: '1', selling_price: '100',
      shipping_fee: '-5', coupon_discount: '-9', channel: 'manual',
    });
    expect(p.shipping_fee).toBe(0);
    expect(p.coupon_discount).toBe(0);
  });
  it('빈 쿠폰할인은 0으로 처리', () => {
    const p = buildSalePayload({
      sold_at: '2026-07-01', quantity: '1', selling_price: '100',
      shipping_fee: '0', coupon_discount: '', channel: 'naver',
    });
    expect(p.coupon_discount).toBe(0);
  });
  it('소수 수량·가격은 반올림', () => {
    const p = buildSalePayload({
      sold_at: '2026-07-01', quantity: '2.4', selling_price: '10000.6',
      shipping_fee: '0', coupon_discount: '0', channel: 'manual',
    });
    expect(p.quantity).toBe(2);
    expect(p.selling_price).toBe(10001);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/sale-payload.test.ts` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/components/orders/sale-payload.ts`

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

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/sale-payload.test.ts` → PASS (4 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/sale-payload.ts src/__tests__/components/sale-payload.test.ts
git commit -m "feat(cost-management): 판매 payload 빌더 buildSalePayload(쿠폰·채널 포함)"
```

---

## Task 2: PATCH API — `coupon_discount`·`channel` 허용

**Files:**
- Modify: `src/app/api/cost-management/sales/[id]/route.ts`

- [ ] **Step 1: 구조분해에 필드 추가** — `:16`
  현재: `const { sold_at, quantity, selling_price, shipping_fee } = body ?? {};`
  변경: `const { sold_at, quantity, selling_price, shipping_fee, coupon_discount, channel } = body ?? {};`

- [ ] **Step 2: 검증 추가** — `shipping_fee` 검증 블록(`:37-42`) 다음에 두 블록 추가:
```ts
  if (coupon_discount !== undefined && (!Number.isInteger(coupon_discount) || coupon_discount < 0)) {
    return NextResponse.json(
      { success: false, error: 'coupon_discount must be non-negative integer' },
      { status: 400 },
    );
  }
  const ALLOWED_CHANNELS = ['manual', 'coupang', 'rocket_growth', 'naver'];
  if (channel !== undefined && !ALLOWED_CHANNELS.includes(channel)) {
    return NextResponse.json(
      { success: false, error: 'invalid channel' },
      { status: 400 },
    );
  }
```

- [ ] **Step 3: "변경 없음" 가드 확장** — `:44`
  현재: `if (sold_at === undefined && quantity === undefined && selling_price === undefined && shipping_fee === undefined) {`
  변경: `if (sold_at === undefined && quantity === undefined && selling_price === undefined && shipping_fee === undefined && coupon_discount === undefined && channel === undefined) {`

- [ ] **Step 4: UPDATE 확장** — `:56-63` 쿼리·파라미터 교체:
  현재:
```ts
      `UPDATE sale_records
       SET sold_at        = COALESCE($1, sold_at),
           quantity       = COALESCE($2, quantity),
           selling_price  = COALESCE($3, selling_price),
           shipping_fee   = COALESCE($4, shipping_fee)
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [sold_at ?? null, quantity ?? null, selling_price ?? null, shipping_fee ?? null, id, user.userId],
```
  변경:
```ts
      `UPDATE sale_records
       SET sold_at         = COALESCE($1, sold_at),
           quantity        = COALESCE($2, quantity),
           selling_price   = COALESCE($3, selling_price),
           shipping_fee    = COALESCE($4, shipping_fee),
           coupon_discount = COALESCE($5, coupon_discount),
           channel         = COALESCE($6, channel)
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [sold_at ?? null, quantity ?? null, selling_price ?? null, shipping_fee ?? null, coupon_discount ?? null, channel ?? null, id, user.userId],
```

- [ ] **Step 5: 타입 확인** — Run: `npx tsc --noEmit` → 신규 에러 없음(무관한 `ImageLabel3x3Editor.tsx` 제외).

- [ ] **Step 6: 커밋**

```bash
git add "src/app/api/cost-management/sales/[id]/route.ts"
git commit -m "feat(cost-management): 판매 PATCH가 coupon_discount·channel 수정 허용"
```

---

## Task 3: SaleEntryPanel — 폼·UI·저장 배선

**Files:**
- Modify: `src/components/orders/SaleEntryPanel.tsx`

- [ ] **Step 1: import 추가** — 상단에: `import { buildSalePayload } from './sale-payload';`

- [ ] **Step 2: SaleForm 타입 확장** — `SaleForm` 인터페이스(현재 `sold_at/quantity/selling_price/shipping_fee: string`)에 두 줄 추가:
```ts
  coupon_discount: string;
  channel: string;
```

- [ ] **Step 3: emptyForm 기본값** — `emptyForm()`의 반환 객체(현재 `sold_at/quantity/selling_price/shipping_fee` 지정)에 추가:
```ts
    coupon_discount: '0',
    channel: 'manual',
```

- [ ] **Step 4: startEdit 폼 채우기** — `startEdit`(`:178`)의 `setForm({ ... })`에 추가:
```ts
      coupon_discount: String(s.coupon_discount ?? 0),
      channel: s.channel ?? 'manual',
```

- [ ] **Step 5: 편집 행 UI** — 편집 행의 "빈 셀"(`:384-386`):
  현재:
```tsx
                  <td colSpan={3} style={{ padding: '4px 6px' }}>
                    {/* 쿠폰할인/채널/사이즈는 편집 불가 — 빈 셀 */}
                  </td>
```
  교체(쿠폰할인 input + 채널 select + 사이즈 빈 셀):
```tsx
                  <td style={{ padding: '4px 6px' }}>
                    <input type="number" min="0" value={form.coupon_discount}
                      onChange={(e) => setForm((f) => ({ ...f, coupon_discount: e.target.value }))}
                      style={{ width: '70px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <select value={form.channel}
                      onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                      style={{ padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }}>
                      <option value="coupang">쿠팡윙</option>
                      <option value="rocket_growth">로켓그로스</option>
                      <option value="naver">네이버</option>
                      <option value="manual">수동</option>
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }} />
```

- [ ] **Step 6: save 배선** — `save()`(`:137`)의 payload 계산부:
  현재(대략):
```ts
    const qty = Math.round(Number(form.quantity));
    const price = Math.round(Number(form.selling_price));
    const shippingFee = Math.max(0, Math.round(Number(form.shipping_fee)));
    if (!form.sold_at || qty <= 0) { alert('판매일과 수량을 입력해 주세요.'); return; }
    ...
      const payload = { sold_at: form.sold_at, quantity: qty, selling_price: price, shipping_fee: shippingFee };
```
  변경(유효성 검사는 유지, payload는 헬퍼로):
```ts
    const payload = buildSalePayload(form);
    if (!form.sold_at || payload.quantity <= 0) { alert('판매일과 수량을 입력해 주세요.'); return; }
    ...
      // payload는 위에서 생성됨 (기존 인라인 payload 변수 제거)
```
  주의: 기존에 `qty`/`price`/`shippingFee` 지역변수를 payload 외 다른 곳에서 쓰면 그 참조도 `payload.quantity` 등으로 바꾼다. `save()` 전체를 읽고 정확히 반영할 것. 최종 fetch body는 `JSON.stringify(payload)`.

- [ ] **Step 7: 타입 확인** — Run: `npx tsc --noEmit` → 신규 에러 없음.

- [ ] **Step 8: 커밋**

```bash
git add src/components/orders/SaleEntryPanel.tsx
git commit -m "feat(cost-management): 판매 편집에 쿠폰할인·채널 필드 추가"
```

---

## Task 4: 전체 검증

- [ ] **Step 1: 관련 테스트**
  Run: `npx vitest run src/__tests__/components/sale-payload.test.ts`
  Expected: PASS (4 passed).

- [ ] **Step 2: tsc** — Run: `npx tsc --noEmit` → 무관한 `ImageLabel3x3Editor.tsx` 에러만.

- [ ] **Step 3: 수동 검증(선택)** — 판매 행 편집 → 쿠폰할인·채널 수정 → 저장 → 실현손익/채널 배지가 반영되는지. (드로어 진입 필요; 생략 가능 — 헬퍼는 단위 테스트로 커버.)

---

## Self-Review 노트

- **스펙 커버리지:** API(§2)=Task 2, 폼/UI/startEdit/save(§3)=Task 3, 헬퍼(§4)=Task 1, 테스트(§5)=Task 1. 커버됨.
- **범위 밖(§7):** 사이즈 편집·새 판매 추가 UI·채널 키 정합성 — 태스크 없음(의도). 편집 행의 사이즈 셀은 빈 `<td/>`로 유지.
- **타입 일관성:** `SaleFormInput`/`SalePayload`(Task 1) ↔ `SaleForm`(Task 3, 필드명 동일 `coupon_discount`/`channel`) ↔ PATCH 필드명(Task 2) 일치. 채널 허용셋 `manual|coupang|rocket_growth|naver`이 API 검증·select 옵션 동일.
- **의존:** Task 3 Step 6은 `save()` 전체를 읽고 기존 `qty/price/shippingFee` 참조를 `payload.*`로 정확히 치환.
