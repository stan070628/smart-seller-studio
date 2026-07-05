# 수익·원가 테이블 KPI 재편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수익·원가 상품 테이블을 7개 핵심 KPI 열로 축소하고, 나머지 수치·액션은 chevron으로 여는 인라인 상세 패널로 옮기며, 행 렌더를 3개 컴포넌트로 분해한다.

**Architecture:** 백엔드는 `sale_quantity` 필드 추가 + 위너 판정을 실데이터 2축(`determineWinnerStatus`)으로 교체한다. 프론트는 `CostManagementTab.tsx`의 `renderGroupRow`/`renderProductRow` 인라인 함수를 `cost-table/GroupRow.tsx`·`ProductRow.tsx`·`ProductDetailPanel.tsx`로 분해하고, 광고비 편집 state를 상세 패널 로컬로 내려 props를 줄인다. 상세 펼침은 상품명 옆 전용 chevron만 토글(행 클릭 없음)해 전파 충돌을 최소화한다.

**Tech Stack:** Next.js 16.2.1, React 19, TypeScript, Vitest + React Testing Library.

**설계 문서:** `docs/superpowers/specs/2026-07-05-cost-table-kpi-redesign-design.md`

---

## File Structure

- **Modify** `src/lib/roi/calculations.ts` — `determineWinnerStatus()` 순수 함수 추가 (기존 `isWinner`는 보존).
- **Modify** `src/app/api/cost-management/products/route.ts` — 응답에 `sale_quantity` 추가, `winner_status`를 `determineWinnerStatus`로 계산.
- **Modify** `src/components/orders/CostManagementTab.tsx` — `ProductRow` 타입에 `sale_quantity` 추가; `renderGroupRow`/`renderProductRow` 제거하고 신규 컴포넌트 조립; `expandedDetailIds` state; thead 7열; 상단 카드 라벨; 광고비 state 하향; 그룹 숨김 전파 버그 수정.
- **Create** `src/components/orders/cost-table/ProductRow.tsx` — 리프행(KPI 7열 + chevron + ⋯).
- **Create** `src/components/orders/cost-table/ProductDetailPanel.tsx` — 인라인 상세(수치 스트립 + 액션).
- **Create** `src/components/orders/cost-table/GroupRow.tsx` — 그룹 집계행.
- **Create** tests under `src/__tests__/lib/` and `src/__tests__/components/`.

> **테스트 실행 주의:** 이 저장소는 인자 없는 `npx vitest run`이 `node_modules.nosync` 라이브러리 테스트까지 돌려 대량 선재 실패한다. **항상 파일 경로를 지정**해 실행한다.
>
> **`<tr>` 컴포넌트 RTL 주의:** `<tr>`을 반환하는 컴포넌트는 테스트에서 `render(<table><tbody>{...}</tbody></table>)`로 감싼다.

---

## Task 1: `determineWinnerStatus` 순수 함수

**Files:**
- Modify: `src/lib/roi/calculations.ts`
- Test: `src/__tests__/lib/roi-winner-status.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/lib/roi-winner-status.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { determineWinnerStatus } from '@/lib/roi/calculations';

describe('determineWinnerStatus', () => {
  it('판매수량 ≥ 5 이고 광고가 없으면 winner', () => {
    expect(determineWinnerStatus(5, 0, 300)).toBe('winner');
  });
  it('판매수량 ≥ 5 이고 ROAS ≥ 손익분기면 winner', () => {
    expect(determineWinnerStatus(10, 350, 300)).toBe('winner');
  });
  it('판매수량 ≥ 5 이지만 ROAS < 손익분기면 watch', () => {
    expect(determineWinnerStatus(10, 200, 300)).toBe('watch');
  });
  it('판매수량 적어도(1+) 광고 효율이 손익분기 이상이면 watch', () => {
    expect(determineWinnerStatus(2, 350, 300)).toBe('watch');
  });
  it('판매수량 4 이하이고 광고도 없으면 normal', () => {
    expect(determineWinnerStatus(4, 0, 300)).toBe('normal');
  });
  it('판매수량 0이면 normal', () => {
    expect(determineWinnerStatus(0, 500, 300)).toBe('normal');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/lib/roi-winner-status.test.ts` → FAIL (`determineWinnerStatus` 미정의).

- [ ] **Step 3: 구현** — `src/lib/roi/calculations.ts`의 `isWinner` 함수 정의 바로 아래(41행 이후)에 추가:

```ts
// 광고 클릭/전환율 데이터 연동 전, 사용 가능한 2축(판매수량 + ROAS vs 손익분기)으로 판정
const WINNER_MIN_QTY = 5;

export function determineWinnerStatus(
  qtySold: number,
  adRoas: number,
  breakevenRoas: number,
): 'winner' | 'watch' | 'normal' {
  const hasAds = adRoas > 0;
  const adEfficient = !hasAds || adRoas >= breakevenRoas; // 광고 없으면 효율 조건 통과로 간주
  if (qtySold >= WINNER_MIN_QTY && adEfficient) return 'winner';
  if (qtySold >= WINNER_MIN_QTY) return 'watch';
  if (qtySold >= 1 && hasAds && adEfficient) return 'watch';
  return 'normal';
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/lib/roi-winner-status.test.ts` → PASS (6 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/roi/calculations.ts src/__tests__/lib/roi-winner-status.test.ts
git commit -m "feat(cost-management): 위너 판정 determineWinnerStatus(판매수량+ROAS 2축) 추가"
```

---

## Task 2: 백엔드 `sale_quantity` + 위너 판정 교체

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`
- Modify: `src/components/orders/CostManagementTab.tsx` (타입만)

- [ ] **Step 1: import 교체** — `products/route.ts` 상단에서 `isWinner` import를 `determineWinnerStatus`로 변경. 현재 `calcBreakevenRoas`, `isWinner`를 `@/lib/roi/calculations`에서 가져오는 import 라인을 찾아 `isWinner` → `determineWinnerStatus`로 교체(다른 import는 유지).

- [ ] **Step 2: winner_status 계산 교체** — `products/route.ts:227`
  현재: `const winnerStatus = isWinner(0, 0, adRoas, totalQtySold);`
  변경: `const winnerStatus = determineWinnerStatus(totalQtySold, adRoas, breakevenRoas);`

- [ ] **Step 3: 응답에 sale_quantity 추가** — `products/route.ts:241`의 `sale_count: pFilteredSales.length,` 바로 아래 줄에 추가:

```ts
        sale_quantity: totalQtySold,
```

- [ ] **Step 4: ProductRow 타입에 필드 추가** — `CostManagementTab.tsx:35`의 `sale_count: number;` 바로 아래에 추가:

```ts
  sale_quantity: number;
```

- [ ] **Step 5: 타입/빌드 확인** — Run: `npx tsc --noEmit`
  Expected: 신규 에러 없음(기존 무관 에러 `ImageLabel3x3Editor.tsx`는 제외). `isWinner` 미사용 경고가 route.ts에 없어야 함(import 교체 확인).

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts src/components/orders/CostManagementTab.tsx
git commit -m "feat(cost-management): products API에 sale_quantity 추가 + 위너 판정 2축 교체"
```

---

## Task 3: `ProductDetailPanel` 컴포넌트

행 아래에 펼쳐지는 인라인 상세. 읽기 전용 수치 스트립 + [입고·판매 관리]·[광고비] 액션. 광고비 편집 state는 이 컴포넌트 로컬로 관리.

**Files:**
- Create: `src/components/orders/cost-table/ProductDetailPanel.tsx`
- Test: `src/__tests__/components/cost-table-detail-panel.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/components/cost-table-detail-panel.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductDetailPanel from '@/components/orders/cost-table/ProductDetailPanel';

const base = {
  id: 'p1', product_name: '테스트상품', platform_fee_rate: 0.108,
  weighted_avg_cost: 3000, weighted_avg_shipping: 500, weighted_avg_rg_shipping: 0,
  current_stock: 12, stock_value: 36000, ad_spend: 0, entry_count: 1,
} as any;

function renderInTable(ui: React.ReactNode) {
  return render(<table><tbody>{ui}</tbody></table>);
}

describe('ProductDetailPanel', () => {
  it('수치 스트립에 재고·재고가치·원가·수수료율을 표시한다', () => {
    renderInTable(
      <ProductDetailPanel product={base} colSpan={7} isEditablePeriod={false}
        onOpenDrawer={vi.fn()} onSaveAdSpend={vi.fn()} channelFilter="all" rgInventory={new Map()} />,
    );
    expect(screen.getByText(/12개/)).toBeInTheDocument();
    expect(screen.getByText(/36,000/)).toBeInTheDocument();
    expect(screen.getByText(/3,000/)).toBeInTheDocument();
    expect(screen.getByText(/10\.8%/)).toBeInTheDocument();
  });

  it('[입고·판매 관리] 클릭 시 onOpenDrawer(product.id)를 호출한다', () => {
    const onOpen = vi.fn();
    renderInTable(
      <ProductDetailPanel product={base} colSpan={7} isEditablePeriod={false}
        onOpenDrawer={onOpen} onSaveAdSpend={vi.fn()} channelFilter="all" rgInventory={new Map()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /입고·판매 관리/ }));
    expect(onOpen).toHaveBeenCalledWith('p1');
  });

  it('단일 월 기간이면 광고비를 편집해 onSaveAdSpend를 호출한다', () => {
    const onSave = vi.fn();
    renderInTable(
      <ProductDetailPanel product={{ ...base, ad_spend: 0 }} colSpan={7} isEditablePeriod={true}
        onOpenDrawer={vi.fn()} onSaveAdSpend={onSave} channelFilter="all" rgInventory={new Map()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /광고비/ }));
    const input = screen.getByLabelText('광고비 입력');
    fireEvent.change(input, { target: { value: '50000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('p1', '50000');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/cost-table-detail-panel.test.tsx` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/components/orders/cost-table/ProductDetailPanel.tsx`

```tsx
'use client';

import React, { useState } from 'react';

interface DetailProduct {
  id: string;
  platform_fee_rate: number;
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  weighted_avg_rg_shipping: number;
  current_stock: number;
  stock_value: number;
  ad_spend: number;
  entry_count: number;
  [key: string]: unknown;
}

interface Props {
  product: DetailProduct;
  colSpan: number;
  isEditablePeriod: boolean;
  onOpenDrawer: (productId: string) => void;
  onSaveAdSpend: (productId: string, value: string) => void;
  channelFilter: 'all' | 'rg' | 'wing' | 'naver';
  rgInventory: Map<string, number | null>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function ProductDetailPanel({
  product, colSpan, isEditablePeriod, onOpenDrawer, onSaveAdSpend, channelFilter, rgInventory,
}: Props) {
  const [editingAd, setEditingAd] = useState(false);
  const [adValue, setAdValue] = useState('');

  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#a1a1aa' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#3f3f46' }}>{value}</span>
    </div>
  );

  return (
    <tr>
      <td colSpan={colSpan} style={{ background: '#fafafa', padding: '14px 20px', borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-end' }}>
          {stat('원가(가중평균)', product.entry_count === 0 ? '—' : `${fmt(product.weighted_avg_cost)}원`)}
          {stat('배송비', product.entry_count === 0 ? '—' : `${fmt(product.weighted_avg_shipping)}원`)}
          {stat('RG배송비', product.weighted_avg_rg_shipping > 0 ? `${fmt(product.weighted_avg_rg_shipping)}원` : '—')}
          {stat('재고', `${fmt(product.current_stock)}개`)}
          {stat('재고가치', product.current_stock > 0 ? `${fmt(product.stock_value)}원` : '—')}
          {stat('수수료율', `${(product.platform_fee_rate * 100).toFixed(1)}%`)}
          {channelFilter === 'rg' && stat('RG실재고', (() => {
            const v = rgInventory.get(product.id);
            return v === null || v === undefined ? '—' : `${fmt(v)}개`;
          })())}

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button
              onClick={() => onOpenDrawer(product.id)}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#3f3f46' }}
            >
              입고·판매 관리
            </button>
            {!editingAd ? (
              <button
                onClick={() => { if (!isEditablePeriod) return; setEditingAd(true); setAdValue(product.ad_spend > 0 ? String(product.ad_spend) : ''); }}
                title={!isEditablePeriod ? '단일 월을 선택하면 편집할 수 있습니다' : undefined}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', fontSize: 12, cursor: isEditablePeriod ? 'pointer' : 'default', color: product.ad_spend > 0 ? '#7c3aed' : '#a1a1aa' }}
              >
                광고비 {product.ad_spend > 0 ? fmt(product.ad_spend) : '입력'}
              </button>
            ) : (
              <input
                autoFocus
                aria-label="광고비 입력"
                type="number"
                min="0"
                value={adValue}
                onChange={(e) => setAdValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onSaveAdSpend(product.id, adValue); setEditingAd(false); }
                  if (e.key === 'Escape') setEditingAd(false);
                }}
                onBlur={() => { onSaveAdSpend(product.id, adValue); setEditingAd(false); }}
                style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid #7c3aed', fontSize: 12 }}
              />
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/cost-table-detail-panel.test.tsx` → PASS (3 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/cost-table/ProductDetailPanel.tsx src/__tests__/components/cost-table-detail-panel.test.tsx
git commit -m "feat(cost-management): 인라인 상세 패널 ProductDetailPanel 컴포넌트"
```

---

## Task 4: `ProductRow` 컴포넌트 (리프행)

7개 KPI 열 + 상품명 옆 chevron + ⋯ 메뉴. 채널 셀은 전파 차단. chevron만 상세 토글.

**Files:**
- Create: `src/components/orders/cost-table/ProductRow.tsx`
- Test: `src/__tests__/components/cost-table-product-row.test.tsx`

**참고:** 채널 셀은 기존 `ChannelCell`(`src/components/orders/ChannelCell.tsx`)을 그대로 사용. 시그니처는 `<ChannelCell product={p} onEditChannel={(anchorEl)=>...} onProductUpdate={(updates)=>...} />` (원본 `CostManagementTab.tsx:716-722` 참조). 위너 배지는 `import { WinnerBadge } from '@/components/ui'`.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/components/cost-table-product-row.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductRow from '@/components/orders/cost-table/ProductRow';

vi.mock('@/components/orders/ChannelCell', () => ({
  default: ({ onEditChannel }: any) => (
    <button onClick={() => onEditChannel(document.body)}>채널셀스텁</button>
  ),
}));

const product = {
  id: 'p1', product_name: '무선이어폰', seller_product_id: 100,
  total_sales_amount: 2290000, sale_quantity: 136, sale_count: 40,
  total_realized_profit: 380000, margin_rate: 0.166, ad_roas: 420, breakeven_roas: 300,
  winner_status: 'winner', hidden: false, entry_count: 1, channels: [],
} as any;

function renderRow(props = {}) {
  const defaults = {
    product, isChild: false, expanded: false, colCount: 7,
    onToggleDetail: vi.fn(), onOpenDrawer: vi.fn(), onSaveAdSpend: vi.fn(),
    onHide: vi.fn(), onDelete: vi.fn(), onEditChannel: vi.fn(), onProductUpdate: vi.fn(),
    isEditablePeriod: false, channelFilter: 'all', rgInventory: new Map(),
  };
  return render(<table><tbody><ProductRow {...defaults} {...props} /></tbody></table>);
}

describe('ProductRow', () => {
  it('KPI 열(매출/수량/실현손익/마진율/ROAS)과 위너 배지를 렌더한다', () => {
    renderRow();
    expect(screen.getByText('무선이어폰')).toBeInTheDocument();
    expect(screen.getByText(/136/)).toBeInTheDocument();
    expect(screen.getByText(/380,000/)).toBeInTheDocument();
    expect(screen.getByText(/16\.6%/)).toBeInTheDocument();
    expect(screen.getByText(/420%/)).toBeInTheDocument();
    expect(screen.getByText('위너')).toBeInTheDocument();
  });

  it('chevron 클릭 시 onToggleDetail(product.id)를 호출한다', () => {
    const onToggle = vi.fn();
    renderRow({ onToggleDetail: onToggle });
    fireEvent.click(screen.getByLabelText('상세 펼치기'));
    expect(onToggle).toHaveBeenCalledWith('p1');
  });

  it('채널 셀 클릭은 상세 토글을 유발하지 않는다(전파 차단)', () => {
    const onToggle = vi.fn();
    renderRow({ onToggleDetail: onToggle });
    fireEvent.click(screen.getByText('채널셀스텁'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('⋯ 메뉴에서 삭제를 호출한다', () => {
    const onDelete = vi.fn();
    renderRow({ onDelete });
    fireEvent.click(screen.getByLabelText('행 메뉴'));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(onDelete).toHaveBeenCalledWith(product);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/cost-table-product-row.test.tsx` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/components/orders/cost-table/ProductRow.tsx`

```tsx
'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronDown, MoreHorizontal } from 'lucide-react';
import { WinnerBadge } from '@/components/ui';
import ChannelCell from '../ChannelCell';

interface RowProduct {
  id: string;
  product_name: string;
  total_sales_amount: number;
  sale_quantity: number;
  total_realized_profit: number;
  sale_count: number;
  margin_rate: number;
  ad_roas: number;
  breakeven_roas: number;
  winner_status: 'winner' | 'watch' | 'normal';
  hidden: boolean;
  [key: string]: unknown;
}

interface Props {
  product: RowProduct;
  isChild: boolean;
  expanded: boolean;
  colCount: number;
  onToggleDetail: (productId: string) => void;
  onOpenDrawer: (productId: string) => void;
  onSaveAdSpend: (productId: string, value: string) => void;
  onHide: (product: RowProduct) => void;
  onDelete: (product: RowProduct) => void;
  onEditChannel: (product: RowProduct, anchorEl: HTMLElement) => void;
  onProductUpdate: (productId: string, updates: Record<string, unknown>) => void;
  isEditablePeriod: boolean;
  channelFilter: 'all' | 'rg' | 'wing' | 'naver';
  rgInventory: Map<string, number | null>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function ProductRow(props: Props) {
  const { product: p, isChild, expanded, onToggleDetail, onHide, onDelete, onEditChannel, onProductUpdate } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const firstPadLeft = isChild ? '22px' : '12px';

  return (
    <tr style={{ borderBottom: '1px solid #f0f0f0', background: p.hidden ? '#f9fafb' : '#fff', opacity: p.hidden ? 0.55 : 1 }}>
      {/* 1: 채널 — 전파 차단 */}
      <td style={{ padding: `10px ${firstPadLeft}`, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        <ChannelCell
          product={p}
          onEditChannel={(anchorEl: HTMLElement) => onEditChannel(p, anchorEl)}
          onProductUpdate={(updates: Record<string, unknown>) => onProductUpdate(p.id, updates)}
        />
      </td>
      {/* 2: 상품명 + 위너 배지 + chevron */}
      <td style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            aria-label={expanded ? '상세 접기' : '상세 펼치기'}
            onClick={() => onToggleDetail(p.id)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#a1a1aa' }}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span style={{ fontWeight: 500, color: p.entry_count === 0 ? '#999' : '#18181b' }}>{p.product_name}</span>
          <WinnerBadge status={p.winner_status} />
        </div>
      </td>
      {/* 3: 매출(수량) */}
      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
        <div style={{ fontSize: 12, color: '#18181b' }}>{p.sale_count === 0 ? '—' : `${fmt(p.total_sales_amount)}원`}</div>
        {p.sale_count > 0 && <div style={{ fontSize: 10, color: '#a1a1aa' }}>{fmt(p.sale_quantity)}개 판매</div>}
      </td>
      {/* 4: 실현손익 */}
      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: p.total_realized_profit >= 0 ? '#16a34a' : '#ef4444' }}>
        {p.sale_count === 0 ? <span style={{ color: '#ccc' }}>—</span> : `${fmt(p.total_realized_profit)}원`}
      </td>
      {/* 5: 마진율 */}
      <td style={{ padding: '10px 12px', textAlign: 'right', color: p.margin_rate > 0 ? '#2563eb' : '#ccc' }}>
        {p.margin_rate > 0 ? `${(p.margin_rate * 100).toFixed(1)}%` : '—'}
      </td>
      {/* 6: ROAS */}
      <td style={{ padding: '10px 12px', textAlign: 'right', color: p.ad_roas > 0 ? (p.ad_roas >= p.breakeven_roas ? '#16a34a' : '#ef4444') : '#ccc' }}>
        {p.ad_roas > 0 ? `${Math.round(p.ad_roas)}%` : '—'}
      </td>
      {/* 7: ⋯ 메뉴 */}
      <td style={{ padding: '10px 8px', textAlign: 'right', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
        <button
          aria-label="행 메뉴"
          onClick={() => setMenuOpen((v) => !v)}
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: '#71717a' }}
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div style={{ position: 'absolute', right: 8, top: '100%', zIndex: 50, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 100 }}>
            <button onClick={() => { setMenuOpen(false); onHide(p); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#3f3f46' }}>
              {p.hidden ? '복원' : '숨기기'}
            </button>
            <button onClick={() => { setMenuOpen(false); onDelete(p); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#ef4444' }}>
              삭제
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/cost-table-product-row.test.tsx` → PASS (4 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/cost-table/ProductRow.tsx src/__tests__/components/cost-table-product-row.test.tsx
git commit -m "feat(cost-management): 리프행 ProductRow 컴포넌트(7열 KPI + chevron + ⋯)"
```

---

## Task 5: `GroupRow` 컴포넌트 (그룹 집계행)

그룹 집계 KPI + 옵션 펼침 토글 + 그룹 ⋯(전체 숨기기). 그룹 숨김 버튼 전파 버그 수정 포함.

**Files:**
- Create: `src/components/orders/cost-table/GroupRow.tsx`
- Test: `src/__tests__/components/cost-table-group-row.test.tsx`

**참고:** `GroupRow<ProductRow>` 타입은 `@/lib/cost-management/product-grouping`의 `GroupRow` 인터페이스(`sellerProductId`, `productName`, `children`, `totalStock`, `totalProfit`, `totalSalesAmount`, `groupMarginRate` 등). 컴포넌트 이름 충돌을 피하려고 타입은 `GroupRowData`로 alias import한다. 판매수량 합계는 `group.children`의 `sale_quantity` 합으로 계산.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/components/cost-table-group-row.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupRow from '@/components/orders/cost-table/GroupRow';

const group = {
  kind: 'group', sellerProductId: '100', productName: '무선이어폰',
  children: [
    { id: 'a', sale_quantity: 100, hidden: false },
    { id: 'b', sale_quantity: 36, hidden: false },
  ],
  totalStock: 120, totalStockValue: 360000, totalProfit: 380000,
  totalSalesAmount: 2290000, avgCost: 3000, groupMarginRate: 16.6,
} as any;

function renderGroup(props = {}) {
  const defaults = { group, expanded: false, colCount: 7, onToggleGroup: vi.fn(), onToggleGroupHide: vi.fn() };
  return render(<table><tbody><GroupRow {...defaults} {...props} /></tbody></table>);
}

describe('GroupRow', () => {
  it('집계 매출·실현손익·마진율과 옵션 수를 표시한다', () => {
    renderGroup();
    expect(screen.getByText('무선이어폰')).toBeInTheDocument();
    expect(screen.getByText(/380,000/)).toBeInTheDocument();
    expect(screen.getByText(/16\.6%/)).toBeInTheDocument();
    expect(screen.getByText(/옵션 2개/)).toBeInTheDocument();
  });

  it('행 클릭 시 옵션 펼침(onToggleGroup)을 호출한다', () => {
    const onToggle = vi.fn();
    renderGroup({ onToggleGroup: onToggle });
    fireEvent.click(screen.getByText('무선이어폰'));
    expect(onToggle).toHaveBeenCalledWith('100');
  });

  it('그룹 숨김 버튼은 그룹 토글을 유발하지 않는다(전파 차단)', () => {
    const onToggle = vi.fn();
    const onHide = vi.fn();
    renderGroup({ onToggleGroup: onToggle, onToggleGroupHide: onHide });
    fireEvent.click(screen.getByLabelText(/그룹.*숨기기|그룹 복원/));
    expect(onHide).toHaveBeenCalledWith(group);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/cost-table-group-row.test.tsx` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/components/orders/cost-table/GroupRow.tsx`

```tsx
'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { GroupRow as GroupRowData, GroupableProduct } from '@/lib/cost-management/product-grouping';

interface Props<T extends GroupableProduct> {
  group: GroupRowData<T>;
  expanded: boolean;
  colCount: number;
  onToggleGroup: (sellerProductId: string) => void;
  onToggleGroupHide: (group: GroupRowData<T>) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function GroupRow<T extends GroupableProduct>({ group, expanded, colCount, onToggleGroup, onToggleGroupHide }: Props<T>) {
  const allHidden = group.children.every((c) => (c as { hidden?: boolean }).hidden);
  const totalQty = group.children.reduce((s, c) => s + ((c as { sale_quantity?: number }).sale_quantity ?? 0), 0);

  return (
    <tr
      style={{ background: '#fff7f7', cursor: 'pointer', borderLeft: '3px solid #be0014', borderBottom: expanded ? 'none' : '2px solid #fca5a5' }}
      onClick={() => onToggleGroup(group.sellerProductId)}
    >
      {/* 1: 채널/식별 */}
      <td style={{ padding: '8px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
        <span style={{ background: '#fef2f2', color: '#be0014', padding: '1px 5px', borderRadius: 3, fontSize: 8, fontWeight: 700 }}>쿠팡</span>
      </td>
      {/* 2: 상품명 + 옵션 수 */}
      <td style={{ padding: '8px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b' }}>{group.productName}</div>
        <div style={{ fontSize: 10, color: '#a1a1aa' }}>{expanded ? '▴' : '▾'} 옵션 {group.children.length}개</div>
      </td>
      {/* 3: 매출(수량) */}
      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
        <div style={{ fontSize: 12, color: '#18181b' }}>{fmt(Math.round(group.totalSalesAmount))}원</div>
        {totalQty > 0 && <div style={{ fontSize: 8, color: '#a1a1aa' }}>{fmt(totalQty)}개 · 합계</div>}
      </td>
      {/* 4: 실현손익 */}
      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: group.totalProfit >= 0 ? '#16a34a' : '#ef4444' }}>
        {fmt(Math.round(group.totalProfit))}원
      </td>
      {/* 5: 마진율 */}
      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#2563eb' }}>{group.groupMarginRate.toFixed(1)}%</td>
      {/* 6: ROAS — 그룹 빈칸 */}
      <td style={{ padding: '8px 12px' }} />
      {/* 7: 그룹 ⋯ (전체 숨기기) — 전파 차단 */}
      <td style={{ padding: '8px 8px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
        <button
          aria-label={allHidden ? '그룹 복원' : '그룹 전체 숨기기'}
          onClick={() => onToggleGroupHide(group)}
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, opacity: 0.5 }}
        >
          {allHidden ? <EyeOff size={13} color="#71717a" /> : <Eye size={13} color="#71717a" />}
        </button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/cost-table-group-row.test.tsx` → PASS (3 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/cost-table/GroupRow.tsx src/__tests__/components/cost-table-group-row.test.tsx
git commit -m "feat(cost-management): 그룹 집계행 GroupRow 컴포넌트(전파 버그 수정 포함)"
```

---

## Task 6: `CostManagementTab` 통합

thead를 7열로 교체, 신규 컴포넌트 조립, `expandedDetailIds` state, 상단 카드 라벨. 이 태스크는 대형 파일 통합이라 격리 단위 테스트 대신 `tsc` + 기존 테스트 스모크 + 수동 검증(Task 7)으로 검증.

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: import 추가** — 상단 import 블록에 추가:

```ts
import GroupRow from './cost-table/GroupRow';
import ProductRow from './cost-table/ProductRow';
import ProductDetailPanel from './cost-table/ProductDetailPanel';
```

- [ ] **Step 2: 상세 펼침 state 추가** — `expandedGroups` state 선언 근처(`CostManagementTab.tsx:208`)에 추가:

```ts
  const [expandedDetailIds, setExpandedDetailIds] = useState<Set<string>>(new Set());
  const toggleDetail = (id: string) =>
    setExpandedDetailIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
```

- [ ] **Step 3: 광고비 편집용 콜백 헬퍼 확보** — 기존 `saveAdSpend(productId, value)` 함수(`CostManagementTab.tsx:~558`)를 그대로 재사용한다. 상세 패널·행에 콜백으로 넘긴다. 기존 인라인 편집 state(`editingAdSpendId`, `editingAdSpendValue`, `saveTriggeredByKey`)와 그 UI는 Step 6에서 제거되므로, `saveAdSpend`가 이 state에 의존하면 의존 라인을 제거해 순수 `(id, value) => fetch...` 형태로 남긴다(반환 후 `setProducts`만 유지).

- [ ] **Step 4: thead 7열로 교체** — 현재 `<thead>`의 컬럼 정의(원본 주석 `CostManagementTab.tsx:588-590` 참조: 채널|상품명|원가|배송비|RG배송비|재고|재고가치|실현손익|마진율|광고비|ROAS|위너|입고|판매|내역|[RG실재고]|삭제)를 다음 7열로 교체:

```tsx
<thead>
  <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e5e5' }}>
    <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: '#71717a', fontWeight: 600 }}>채널</th>
    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#71717a', fontWeight: 600 }}>상품명</th>
    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}>매출(수량)</th>
    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}>실현손익</th>
    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}>마진율</th>
    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}>ROAS</th>
    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}></th>
  </tr>
</thead>
```

콜스팬 상수로 `const COL_COUNT = 7;`를 컴포넌트 상단(렌더 직전)에 선언.

- [ ] **Step 5: tbody 렌더 로직 교체** — 기존 tbody는 `tableItems`(검색 필터 적용 후 `buildTableItems`로 만든 memo, `CostManagementTab.tsx:516-519`, 순회부 `:1159`)를 순회한다. 이 순회의 `renderGroupRow`/`renderProductRow` 호출부를 신규 컴포넌트 조립으로 교체(변수 `tableItems` 그대로 사용):

```tsx
{tableItems.map((item) => {
  if (item.kind === 'group') {
    const isGroupExpanded = expandedGroups.has(item.sellerProductId);
    return (
      <React.Fragment key={`group-${item.sellerProductId}`}>
        <GroupRow
          group={item}
          expanded={isGroupExpanded}
          colCount={COL_COUNT}
          onToggleGroup={toggleGroup}
          onToggleGroupHide={toggleGroupHide}
        />
        {isGroupExpanded && item.children.map((child) => (
          <React.Fragment key={child.id}>
            <ProductRow
              product={child}
              isChild
              expanded={expandedDetailIds.has(child.id)}
              colCount={COL_COUNT}
              onToggleDetail={toggleDetail}
              onOpenDrawer={setDrawerProductId}
              onSaveAdSpend={saveAdSpend}
              onHide={toggleHide}
              onDelete={(prod) => deleteProduct(prod.id, prod.product_name)}
              onEditChannel={(p, anchorEl) => setChannelEditTarget({ product: p, anchorEl })}
              onProductUpdate={handleProductUpdate}
              isEditablePeriod={isEditablePeriod}
              channelFilter={channelFilter}
              rgInventory={rgInventory}
            />
            {expandedDetailIds.has(child.id) && (
              <ProductDetailPanel
                product={child}
                colSpan={COL_COUNT}
                isEditablePeriod={isEditablePeriod}
                onOpenDrawer={setDrawerProductId}
                onSaveAdSpend={saveAdSpend}
                channelFilter={channelFilter}
                rgInventory={rgInventory}
              />
            )}
          </React.Fragment>
        ))}
      </React.Fragment>
    );
  }
  const p = item.product;
  return (
    <React.Fragment key={p.id}>
      <ProductRow
        product={p}
        isChild={false}
        expanded={expandedDetailIds.has(p.id)}
        colCount={COL_COUNT}
        onToggleDetail={toggleDetail}
        onOpenDrawer={setDrawerProductId}
        onSaveAdSpend={saveAdSpend}
        onHide={toggleHide}
        onDelete={(prod) => deleteProduct(prod.id, prod.product_name)}
        onEditChannel={(prod, anchorEl) => setChannelEditTarget({ product: prod, anchorEl })}
        onProductUpdate={handleProductUpdate}
        isEditablePeriod={isEditablePeriod}
        channelFilter={channelFilter}
        rgInventory={rgInventory}
      />
      {expandedDetailIds.has(p.id) && (
        <ProductDetailPanel
          product={p}
          colSpan={COL_COUNT}
          isEditablePeriod={isEditablePeriod}
          onOpenDrawer={setDrawerProductId}
          onSaveAdSpend={saveAdSpend}
          channelFilter={channelFilter}
          rgInventory={rgInventory}
        />
      )}
    </React.Fragment>
  );
})}
```

> **확인된 상위 함수/state 명칭(원본 기준):** `toggleGroup`(`:545`), `toggleGroupHide`(`:470`), `setDrawerProductId`, `saveAdSpend`(`:558`), `toggleHide(p: ProductRow)`(`:446`), `deleteProduct(id: string, name: string)`(`:507` — 2개 인자라 위처럼 `(prod) => deleteProduct(prod.id, prod.product_name)`로 배선), `setChannelEditTarget`, `handleProductUpdate`(`:554`), `isEditablePeriod`(`:522`), `channelFilter`, `rgInventory`, 순회 대상 `tableItems`(`:516-519, :1159`). 그대로 사용.

- [ ] **Step 6: 죽은 코드 제거** — 이제 사용하지 않는 `renderGroupRow`, `renderProductRow` 함수 정의 전체와, 리프행에 있던 광고비 인라인 편집 state(`editingAdSpendId`, `editingAdSpendValue`, `setEditingAdSpendId`, `setEditingAdSpendValue`, `saveTriggeredByKey` ref)를 제거한다. `saveAdSpend`는 유지하되 이 state 참조를 제거(Step 3). 제거 후 미사용 import(예: 광고비 셀에서만 쓰던 아이콘)가 있으면 함께 정리.

- [ ] **Step 7: 상단 카드 라벨 변경** — 두 섹션 헤더 텍스트 교체:
  - `CostManagementTab.tsx:951-953` 영역의 `실제 매출 <span ...>(쿠팡 + 네이버 + 로켓그로스 API · 취소/반품 제외)</span>` → 헤더 문구를 `실제 매출 · 플랫폼 확정 <span style={{ fontWeight: 400 }}>(쿠팡 + 네이버 + 로켓그로스 API 집계)</span>`
  - `:1010-1012` 영역의 `원가·수익 <span ...>(수동 입력 기반)</span>` → `관리 손익 · 내 입력 기반 <span style={{ fontWeight: 400 }}>(입고·판매 수동 관리)</span>`
  - 섹션 A와 B 사이(구분선 `:1009` 근처)에 한 줄 안내 추가:

```tsx
<div style={{ fontSize: 11, color: '#a1a1aa', margin: '0 0 8px' }}>
  실제 매출은 플랫폼 API 실시간 집계, 관리 손익은 입력한 원가·판매 기반 계산이라 값이 다를 수 있습니다.
</div>
```

- [ ] **Step 8: 타입/빌드 확인** — Run: `npx tsc --noEmit`
  Expected: 신규 에러 없음(무관한 기존 `ImageLabel3x3Editor.tsx` 에러 제외). 미사용 변수/함수 에러가 있으면 Step 6 정리 누락이므로 제거.

- [ ] **Step 9: 기존 테스트 스모크** — Run:
  `npx vitest run src/__tests__/components/cost-table-detail-panel.test.tsx src/__tests__/components/cost-table-product-row.test.tsx src/__tests__/components/cost-table-group-row.test.tsx src/__tests__/lib/roi-winner-status.test.ts src/__tests__/components/import-summary.test.ts src/__tests__/components/orders-client-tabs.test.tsx`
  Expected: 전부 PASS.

- [ ] **Step 10: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat(cost-management): 테이블 7열 KPI 재편 + chevron 상세 패널 통합 + 상단 카드 라벨"
```

---

## Task 7: 수동 검증 (dev 서버)

- [ ] **Step 1: dev 서버에서 확인** — `/orders?tab=cost` 진입 후:
  1. 테이블이 7열(채널·상품명·매출(수량)·실현손익·마진율·ROAS·⋯)로 표시된다.
  2. 상품명 옆 chevron 클릭 → 아래로 상세 패널(원가·배송비·재고·재고가치·수수료율 + [입고·판매 관리]·[광고비]) 펼쳐짐.
  3. [입고·판매 관리] 클릭 → 기존 CostEntryDrawer(좌:입고/우:판매) 열림.
  4. 채널 셀·⋯ 클릭은 상세를 열지 않는다. ⋯ → 숨기기/삭제 동작.
  5. 그룹행 클릭 → 옵션 펼침. 그룹 숨김 아이콘 클릭 시 그룹이 접히지 않는다(전파 버그 수정).
  6. 판매 있는 상품에 위너/관찰 배지가 조건에 맞게 뜬다.
  7. 상단에 "실제 매출 · 플랫폼 확정" / "관리 손익 · 내 입력 기반" 라벨과 안내 문구.

- [ ] **Step 2: 결과 기록** — 문제 없으면 완료. 있으면 해당 Task로 돌아가 수정.

---

## Self-Review 노트

- **스펙 커버리지:** 7열(§1)=Task 6, 상세 패널(§2)=Task 3, chevron 인터랙션(§3)=Task 4·6, 위너 간이판정(§4)=Task 1·2, 판매수량(§5)=Task 2, 카드 라벨(§6)=Task 6, 파일 분해(§7)=Task 3·4·5·6, 테스트(§8)=각 Task. 그룹 숨김 전파 버그(§3)=Task 5. 커버됨.
- **범위 밖(스펙 §9 일치):** 카드 구조 재설계·정식 위너 판정·열 커스터마이즈·성능은 제외.
- **타입 일관성:** `sale_quantity`(Task 2 정의 → Task 4·5 사용), `determineWinnerStatus(qty, roas, breakeven)`(Task 1 → Task 2), 컴포넌트 props 명칭이 Task 6 조립부와 일치. `GroupRow` 타입은 `GroupRowData`로 alias(Task 5)해 컴포넌트명과 충돌 회피.
- **의존 확인 필요:** Task 6 Step 5의 상위 함수/변수 실제 명칭은 원본에서 확인 후 연결(플랜에 명시).
