# seller_product_id 필수화 & 2단계 위자드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `product_costs.seller_product_id`를 NOT NULL로 필수화하고, AddProductModal을 2단계 위자드로 재설계한다.

**Architecture:** Migration 080이 sequence DEFAULT → UPDATE NULL → SET NOT NULL 순으로 레이스컨디션 없이 필수화. `product-grouping.ts`에서 음수 가상 ID를 standalone으로 처리. `AddProductModal`을 Step 1(쿠팡 상품 선택) → Step 2(원가 설정)의 선형 위자드로 완전 재작성.

**Tech Stack:** PostgreSQL (Supabase), Next.js App Router, TypeScript, React, Vitest

**전제 조건:** Migration 079(`product_cost_channels`)는 아직 DB에 적용되지 않음. 이 플랜 실행 전 079 + 080을 함께 `supabase db push` 또는 Supabase Studio에서 적용.

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `supabase/migrations/080_seller_product_id_required.sql` | 신규: sequence, DEFAULT, 백필, NOT NULL, 인덱스 |
| `src/lib/cost-management/product-grouping.ts` | 수정: 양수 ID만 그룹화, 타입 변경 |
| `src/__tests__/lib/product-grouping.test.ts` | 수정: 가상 ID 케이스 테스트 추가 |
| `src/components/orders/AddProductModal.tsx` | 재작성: 4탭 → 2단계 위자드 |

---

## Task 1: Migration 080 작성

`product_costs.seller_product_id` NOT NULL 마이그레이션을 안전한 순서로 작성한다.

**Files:**
- Create: `supabase/migrations/080_seller_product_id_required.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
BEGIN;

-- 규약: seller_product_id < 0 은 쿠팡 미연동 가상 ID. 실제 쿠팡 ID는 항상 양수.
CREATE SEQUENCE virtual_seller_product_id_seq
  INCREMENT BY -1
  START WITH -1
  MINVALUE -9223372036854775808
  NO CYCLE;

-- DEFAULT 먼저 설정: 백필 중 들어오는 INSERT도 자동으로 가상 ID를 받음 (레이스컨디션 방지)
ALTER TABLE product_costs
  ALTER COLUMN seller_product_id
  SET DEFAULT nextval('virtual_seller_product_id_seq');

-- 기존 NULL 행 백필 (각 행마다 고유한 음수 ID)
UPDATE product_costs
  SET seller_product_id = nextval('virtual_seller_product_id_seq')
WHERE seller_product_id IS NULL;

-- NOT NULL 제약 추가
ALTER TABLE product_costs
  ALTER COLUMN seller_product_id SET NOT NULL;

-- 기존 partial unique index 교체 → full unique index (user_id 스코프 필수)
DROP INDEX IF EXISTS product_costs_user_seller_product_id_idx;
CREATE UNIQUE INDEX product_costs_user_seller_product_id_uidx
  ON product_costs (user_id, seller_product_id);

COMMENT ON COLUMN product_costs.seller_product_id IS
  '쿠팡 등록상품ID. 양수=실제 쿠팡 ID, 음수=가상 ID(쿠팡 미연동, virtual_seller_product_id_seq로 생성). NOT NULL.';

COMMIT;
```

- [ ] **Step 2: 마이그레이션 전 중복 점검 쿼리 실행 (Supabase Studio 또는 psql)**

```sql
SELECT user_id, seller_product_id, count(*)
FROM product_costs
WHERE seller_product_id IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1;
```

중복 결과가 있으면 마이그레이션을 중단하고 수동으로 데이터를 정리한다. 중복이 없으면 계속.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/080_seller_product_id_required.sql
git commit -m "migration: seller_product_id NOT NULL with virtual negative ID backfill"
```

---

## Task 2: product-grouping.ts 업데이트

가상 음수 ID를 가진 상품은 항상 standalone으로 처리하도록 그룹화 조건을 변경한다.

**Files:**
- Modify: `src/lib/cost-management/product-grouping.ts`
- Modify: `src/__tests__/lib/product-grouping.test.ts`

- [ ] **Step 1: 테스트 먼저 작성 — 가상 ID 케이스 추가**

`src/__tests__/lib/product-grouping.test.ts`에 아래 케이스를 추가:

```typescript
describe('buildTableItems — 가상 ID (음수)', () => {
  it('seller_product_id < 0 인 상품은 항상 standalone으로 처리', () => {
    const products = [
      makeProduct({ id: 'a', seller_product_id: -1, product_name: '가상상품A' }),
      makeProduct({ id: 'b', seller_product_id: -2, product_name: '가상상품B' }),
    ];
    const result = buildTableItems(products);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.kind === 'standalone')).toBe(true);
  });

  it('가상 ID 상품 2개가 같은 음수 ID여도 그룹화되지 않음 (실제로는 고유 ID이지만 방어적 테스트)', () => {
    // 실제 DB에서는 unique 제약으로 동일 음수 ID가 불가능하지만, 로직 자체를 검증
    const products = [
      makeProduct({ id: 'a', seller_product_id: -5, product_name: '가상상품' }),
      makeProduct({ id: 'b', seller_product_id: -5, product_name: '가상상품' }),
    ];
    const result = buildTableItems(products);
    // 음수 ID는 그룹화 제외 → standalone 2개
    expect(result.every((r) => r.kind === 'standalone')).toBe(true);
  });

  it('양수 seller_product_id는 여전히 그룹화됨', () => {
    const products = [
      makeProduct({ id: 'a', seller_product_id: 100, product_name: '쿠팡상품 옵션A' }),
      makeProduct({ id: 'b', seller_product_id: 100, product_name: '쿠팡상품 옵션B' }),
    ];
    const result = buildTableItems(products);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('group');
  });
});
```

`makeProduct` 헬퍼가 기존에 있다면 `seller_product_id`를 `number`(양수/음수)로 받도록 타입을 확인한다.

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/__tests__/lib/product-grouping.test.ts 2>&1 | tail -20
```

가상 ID 케이스가 FAIL이어야 한다.

- [ ] **Step 3: product-grouping.ts 수정**

`src/lib/cost-management/product-grouping.ts`:

1. `GroupableProduct.seller_product_id` 타입 변경:
```typescript
// 변경 전
seller_product_id: number | null;

// 변경 후
// 양수=쿠팡 실제 ID, 음수=가상 ID(쿠팡 미연동)
seller_product_id: number;
```

2. `buildTableItems()` 그룹화 조건 변경:
```typescript
// 변경 전
if (p.seller_product_id != null) {
  const key = String(p.seller_product_id);
  ...
} else {
  standalone.push(p);
}

// 변경 후
// seller_product_id < 0 = 가상 ID → standalone 처리
if (p.seller_product_id > 0) {
  const key = String(p.seller_product_id);
  ...
} else {
  standalone.push(p);
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/product-grouping.test.ts 2>&1 | tail -20
```

모든 테스트 PASS.

- [ ] **Step 5: TypeScript 검사**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"
```

에러 0개 확인. `seller_product_id` 사용처에서 `| null` 타입 관련 에러가 있으면 `product-grouping.ts`의 `GroupableProduct`를 인터페이스로 확장하는 다른 파일을 확인하고 타입 수정.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/cost-management/product-grouping.ts src/__tests__/lib/product-grouping.test.ts
git commit -m "feat(grouping): virtual negative seller_product_id always standalone"
```

---

## Task 3: AddProductModal 2단계 위자드 재작성

기존 4탭(533줄) → 2단계 위자드로 완전 재작성. Step 1에서 쿠팡 등록상품 선택, Step 2에서 원가 단위 설정.

**Files:**
- Modify (rewrite): `src/components/orders/AddProductModal.tsx`

- [ ] **Step 1: 기존 코드 구조 파악**

`src/components/orders/AddProductModal.tsx` 전체 확인. 재작성이므로 파일 전체를 대체한다.

- [ ] **Step 2: 위자드 재작성**

`src/components/orders/AddProductModal.tsx`를 아래로 완전 교체:

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { X, Package, ChevronLeft } from 'lucide-react';

interface CoupangProduct {
  seller_product_id: number;
  seller_product_name: string;
}

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

type Step = 1 | 2;

export default function AddProductModal({ onClose, onAdded }: Props) {
  const [step, setStep] = useState<Step>(1);

  // Step 1 상태
  const [coupangProducts, setCoupangProducts] = useState<CoupangProduct[]>([]);
  const [loadingCoupang, setLoadingCoupang] = useState(true);
  const [coupangError, setCoupangError] = useState<string | null>(null);
  // null = "쿠팡 없이 등록" 선택, 값이 있으면 선택된 쿠팡 상품
  const [selectedCoupang, setSelectedCoupang] = useState<CoupangProduct | null | undefined>(undefined);

  // Step 2 상태
  const [productName, setProductName] = useState('');
  const [feeRate, setFeeRate] = useState('10.8');
  const [subdivisionUnit, setSubdivisionUnit] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/cost-management/coupang-products')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setCoupangProducts(j.data);
        else setCoupangError(j.error ?? '상품 목록을 불러오지 못했습니다.');
      })
      .catch(() => setCoupangError('네트워크 오류가 발생했습니다.'))
      .finally(() => setLoadingCoupang(false));
  }, []);

  function goToStep2(coupang: CoupangProduct | null) {
    setSelectedCoupang(coupang);
    setProductName(coupang?.seller_product_name ?? '');
    setFeeRate(coupang ? '10.8' : '');
    setStep(2);
  }

  async function add() {
    if (!productName.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        product_name: productName.trim(),
        ...(feeRate.trim() !== '' && { platform_fee_rate: Number(feeRate) / 100 }),
        ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
        // selectedCoupang이 null이면 seller_product_id 생략 → DB DEFAULT(가상 음수 ID) 자동 부여
        ...(selectedCoupang != null && { seller_product_id: selectedCoupang.seller_product_id }),
      };

      const res = await fetch('/api/cost-management/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        onAdded();
        onClose();
      } else {
        alert(json.error ?? '상품 추가에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  const canSave = productName.trim().length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '420px', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>

        {/* 헤더 */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px', color: '#52525b', display: 'flex', alignItems: 'center' }}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Package size={15} color="#be0014" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#18181b' }}>
              {step === 1 ? '상품 추가' : (
                selectedCoupang
                  ? `${selectedCoupang.seller_product_name}`
                  : '쿠팡 없이 등록'
              )}
            </div>
            <div style={{ fontSize: '11px', color: '#52525b' }}>
              {step === 1
                ? '쿠팡 등록상품을 선택하세요'
                : `${step === 1 ? '' : '원가 단위 설정'}`}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
            <X size={16} color="#52525b" />
          </button>
        </div>

        <div style={{ padding: '16px 24px 20px' }}>

          {/* ── Step 1: 쿠팡 등록상품 선택 ── */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '8px' }}>
                쿠팡 등록상품 선택
              </div>
              <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #d4d4d8', borderRadius: '8px', marginBottom: '12px' }}>
                {loadingCoupang ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>로딩 중...</div>
                ) : coupangError ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px' }}>
                    <div style={{ color: '#ef4444', marginBottom: '6px' }}>상품 목록 로드 실패</div>
                    <div style={{ color: '#52525b', fontSize: '11px' }}>{coupangError}</div>
                  </div>
                ) : coupangProducts.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>연동 가능한 상품이 없습니다</div>
                ) : coupangProducts.map((p) => {
                  const isSelected = selectedCoupang?.seller_product_id === p.seller_product_id;
                  return (
                    <div
                      key={p.seller_product_id}
                      onClick={() => setSelectedCoupang(p)}
                      style={{
                        padding: '10px 14px', cursor: 'pointer', fontSize: '12px',
                        borderBottom: '1px solid #f0f0f0',
                        background: isSelected ? '#fef2f2' : '#fff',
                        color: isSelected ? '#be0014' : '#18181b',
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      {p.seller_product_name}
                      <span style={{ fontSize: '10px', color: '#71717a', marginLeft: '8px' }}>
                        #{p.seller_product_id}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 쿠팡 없이 등록 링크 */}
              <div style={{ fontSize: '11px', color: '#71717a', textAlign: 'center', marginBottom: '16px' }}>
                또는{' '}
                <button
                  onClick={() => goToStep2(null)}
                  style={{ color: '#52525b', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                >
                  쿠팡 없이 등록 (가상 ID 자동 부여)
                </button>
              </div>

              <button
                onClick={() => selectedCoupang && goToStep2(selectedCoupang)}
                disabled={!selectedCoupang}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                  background: selectedCoupang ? '#be0014' : '#d4d4d4',
                  color: selectedCoupang ? '#fff' : '#525252',
                  fontSize: '13px', fontWeight: 600,
                  cursor: selectedCoupang ? 'pointer' : 'not-allowed',
                }}
              >
                다음 →
              </button>
            </div>
          )}

          {/* ── Step 2: 원가 단위 설정 ── */}
          {step === 2 && (
            <div>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>상품명</div>
                <input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="상품명을 입력하세요"
                  autoFocus
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>
                  플랫폼 수수료율 (%)
                </div>
                <input
                  type="number"
                  value={feeRate}
                  onChange={(e) => setFeeRate(e.target.value)}
                  step="0.1"
                  min="0"
                  max="50"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }}
                />
                <div style={{ fontSize: '10px', color: '#52525b', marginTop: '4px' }}>
                  {selectedCoupang
                    ? '로켓그로스 기본 10.8% — 필요 시 수정하세요'
                    : '플랫폼 수수료율을 입력하세요'}
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>소분 갯수 (선택)</div>
                <input
                  type="number"
                  value={subdivisionUnit}
                  onChange={(e) => setSubdivisionUnit(e.target.value)}
                  step="1"
                  min="2"
                  placeholder="비워두면 소분 없음"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }}
                />
                <div style={{ fontSize: '10px', color: '#52525b', marginTop: '4px' }}>
                  입력하면 입고 시 개당 원가를 자동 계산합니다
                </div>
              </div>

              <button
                onClick={add}
                disabled={saving || !canSave}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                  background: canSave ? '#be0014' : '#d4d4d4',
                  color: canSave ? '#fff' : '#525252',
                  fontSize: '13px', fontWeight: 600,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                }}
              >
                {saving ? '추가 중...' : '추가'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript 검사**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"
```

에러 0개 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/orders/AddProductModal.tsx
git commit -m "feat(modal): 2단계 위자드로 재설계 — 쿠팡 등록상품 선택 → 원가 단위 설정"
```

---

## Task 4: API 응답 null 가드 정리 (경량 작업)

`seller_product_id`가 이제 항상 non-null이므로, 클라이언트 코드의 관련 null 가드를 정리한다.

**Files:**
- Modify: `src/lib/cost-management/product-grouping.ts` (GroupableProduct 타입 — Task 2에서 이미 처리)
- Scan: `src/components/orders/CostManagementTab.tsx` (null 가드 잔재 확인)

- [ ] **Step 1: CostManagementTab에서 seller_product_id null 가드 스캔**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
grep -n "seller_product_id.*null\|seller_product_id != null\|seller_product_id == null\|seller_product_id === null" \
  src/components/orders/CostManagementTab.tsx
```

결과가 있으면 각 줄 확인:
- `ProductRow` 타입 정의에서 `seller_product_id: number | null` → `number`로 변경
- 실제 null 비교 가드는 제거

- [ ] **Step 2: TypeScript 검사**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"
```

에러 0개 확인.

- [ ] **Step 3: 커밋 (변경 사항이 있을 때만)**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "chore: seller_product_id null 가드 제거 (NOT NULL 필수화 이후)"
```

---

## 검증

### 마이그레이션 적용

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio

# 로컬 Supabase에 079 + 080 적용
supabase db push
# 또는 Supabase Studio에서 SQL 직접 실행
```

### 자동 테스트

```bash
npx vitest run src/__tests__/lib/product-grouping.test.ts
```

### 수동 테스트 체크리스트

1. **기존 데이터 확인**: 기존 NULL이었던 상품들이 음수 seller_product_id를 갖고 StandaloneRow로 표시됨
2. **2단계 위자드 — 쿠팡 경로**: 등록상품 선택 → "다음" → 상품명(자동채움) + 수수료 입력 → "추가" → 테이블에 seller_product_id가 해당 양수 ID인 상품 표시
3. **2단계 위자드 — "쿠팡 없이 등록"**: 링크 클릭 → Step 2 이동(상품명 비어있음) → 상품명 입력 → "추가" → 테이블에 StandaloneRow로 표시, seller_product_id가 음수
4. **그룹화**: 같은 양수 seller_product_id로 2개↑ 상품 등록 → GroupRow로 그룹화 표시
5. **음수 ID는 그룹화 안 됨**: "쿠팡 없이 등록"으로 여러 상품 추가 → 각각 독립 StandaloneRow
