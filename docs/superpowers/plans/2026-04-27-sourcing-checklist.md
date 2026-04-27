# 1688 입고 체크리스트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SKU별 1688 사입가/수량/규격을 입력하면, 채널 영상 "회송 당합니다" 3편(포장/사이즈/바코드) 기준 체크리스트가 SKU별로 자동 생성되고 브라우저 PDF 인쇄로 저장 가능한 도구를 구현한다.

**Architecture:** 서버사이드 PDF 라이브러리 추가 없이 인쇄 친화적 HTML + `window.print()`로 PDF 생성. 입력 페이지에서 SKU 데이터를 sessionStorage에 저장 후 print 페이지로 라우팅. print CSS로 A4 페이지 분할, SKU당 1페이지. 체크리스트 데이터는 순수 함수로 분리하여 테스트 용이.

**Tech Stack:** Next.js App Router, React Client Components, Tailwind CSS print modifiers, sessionStorage, Vitest
**전략 v2 의존도:** critical (Week 4 시작 전 완료 필수)
**근거 spec:** `docs/superpowers/specs/2026-04-27-seller-strategy-v2-design.md` §6.4

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 신규 | `src/lib/sourcing/inbound-checklist.ts` | 체크리스트 항목 데이터 + SKU 입력 검증 |
| 신규 | `src/lib/sourcing/__tests__/inbound-checklist.test.ts` | 데이터/검증 단위 테스트 |
| 신규 | `src/app/sourcing/inbound-checklist/page.tsx` | 입력 페이지 (서버 컴포넌트) |
| 신규 | `src/components/sourcing/InboundChecklistForm.tsx` | SKU 다중 입력 폼 (클라이언트) |
| 신규 | `src/app/sourcing/inbound-checklist/print/page.tsx` | 인쇄 페이지 (서버 컴포넌트) |
| 신규 | `src/components/sourcing/InboundChecklistDoc.tsx` | 인쇄용 SKU 문서 (클라이언트) |
| 신규 | `src/app/globals-print.css` 또는 기존 globals 확장 | print 미디어쿼리 (A4 / page-break) |

---

## Task 1: 체크리스트 데이터 + 검증 모듈

**Files:**
- Create: `src/lib/sourcing/inbound-checklist.ts`
- Test: `src/lib/sourcing/__tests__/inbound-checklist.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sourcing/__tests__/inbound-checklist.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CHECKLIST_SECTIONS,
  validateSkuInput,
  type SkuInput,
} from '../inbound-checklist';

describe('CHECKLIST_SECTIONS — 회송 당합니다 3편 기준', () => {
  it('3개 섹션 (포장/사이즈/바코드) 존재', () => {
    expect(CHECKLIST_SECTIONS).toHaveLength(3);
    expect(CHECKLIST_SECTIONS.map((s) => s.id)).toEqual(['packaging', 'size', 'barcode']);
  });

  it('각 섹션은 최소 4개 항목 보유', () => {
    CHECKLIST_SECTIONS.forEach((section) => {
      expect(section.items.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('항목은 raw text가 아닌 구조 (id + label + caution?)', () => {
    const first = CHECKLIST_SECTIONS[0].items[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.label).toBe('string');
  });
});

describe('validateSkuInput — 사용자 입력 검증', () => {
  function makeInput(overrides: Partial<SkuInput> = {}): SkuInput {
    return {
      title: '스테인리스 텀블러 500ml',
      url1688: 'https://detail.1688.com/offer/123.html',
      unitPriceRmb: 12.5,
      orderQty: 100,
      maxSideCm: 20,
      weightKg: 0.4,
      ...overrides,
    };
  }

  it('정상 입력 → ok', () => {
    expect(validateSkuInput(makeInput()).ok).toBe(true);
  });

  it('빈 제목 → 에러', () => {
    const r = validateSkuInput(makeInput({ title: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('title');
  });

  it('1688 URL 형식 아님 → 에러', () => {
    const r = validateSkuInput(makeInput({ url1688: 'https://google.com' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('url1688');
  });

  it('변 길이 50cm 초과 → 경고 (oversize)', () => {
    const r = validateSkuInput(makeInput({ maxSideCm: 60 }));
    expect(r.warnings).toContain('oversize');
  });

  it('단가 0 이하 → 에러', () => {
    const r = validateSkuInput(makeInput({ unitPriceRmb: 0 }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('unitPriceRmb');
  });

  it('수량 정수 아님 → 에러', () => {
    const r = validateSkuInput(makeInput({ orderQty: 50.5 }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('orderQty');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/inbound-checklist.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: inbound-checklist.ts 구현**

`src/lib/sourcing/inbound-checklist.ts`:

```ts
/**
 * 1688 입고 체크리스트
 *
 * 채널 spec v2 §6.4 — 영상 "회송 당합니다" 3편(포장/사이즈/바코드) 기준
 * SKU별 입고 전 자체 검수 항목.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  caution?: string;
}

export interface ChecklistSection {
  id: 'packaging' | 'size' | 'barcode';
  title: string;
  items: ChecklistItem[];
}

export const CHECKLIST_SECTIONS: readonly ChecklistSection[] = [
  {
    id: 'packaging',
    title: '포장 (회송 1편)',
    items: [
      { id: 'pkg-1', label: '박스 손상 없음 (찢김/구겨짐 검수 완료)' },
      { id: 'pkg-2', label: 'OPP 봉투 또는 비닐 개별포장', caution: '낱개 노출 시 회송' },
      { id: 'pkg-3', label: '완충재 (에어캡/스티로폼) 적정량 충진' },
      { id: 'pkg-4', label: '쿠팡 라벨 부착 위치: 박스 가장 큰 면 상단' },
      { id: 'pkg-5', label: '냄새/이물질 없음 (중국발 곰팡이/담배 냄새 주의)' },
    ],
  },
  {
    id: 'size',
    title: '사이즈 (회송 2편)',
    items: [
      { id: 'sz-1', label: '최장변 ≤ 50cm 확인 (보관료 폭탄 회피)' },
      { id: 'sz-2', label: '무게 ≤ 25kg' },
      { id: 'sz-3', label: '1688 스펙 vs 실측 일치 (오차 ±2cm)' },
      { id: 'sz-4', label: '부피무게 = (가로×세로×높이)÷6000 계산 후 실무게와 비교' },
      { id: 'sz-5', label: '유효박스 단위 분할 시 SKU 분리 라벨 부착' },
    ],
  },
  {
    id: 'barcode',
    title: '바코드 (회송 3편)',
    items: [
      { id: 'bc-1', label: '바코드 종류: CODE128 (쿠팡 권장)' },
      { id: 'bc-2', label: '인쇄 해상도 ≥ 300dpi (긁힘/번짐 없음)' },
      { id: 'bc-3', label: '부착 위치: 박스 측면 (상단·하단 X)' },
      { id: 'bc-4', label: '바코드 크기 ≥ 25mm × 15mm' },
      { id: 'bc-5', label: '쿠팡 윙 등록 SKU 코드와 일치 확인' },
    ],
  },
] as const;

export interface SkuInput {
  title: string;
  url1688: string;
  unitPriceRmb: number;
  orderQty: number;
  maxSideCm: number;
  weightKg: number;
  skuCode?: string;
  notes?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];   // 필드명 (UI에서 강조 표시)
  warnings: string[]; // oversize 등 경고
}

export function validateSkuInput(input: SkuInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.title || input.title.trim().length === 0) errors.push('title');
  if (!/^https?:\/\/.*1688\.com/i.test(input.url1688)) errors.push('url1688');
  if (!Number.isFinite(input.unitPriceRmb) || input.unitPriceRmb <= 0) errors.push('unitPriceRmb');
  if (!Number.isInteger(input.orderQty) || input.orderQty <= 0) errors.push('orderQty');
  if (!Number.isFinite(input.maxSideCm) || input.maxSideCm <= 0) errors.push('maxSideCm');
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) errors.push('weightKg');

  if (input.maxSideCm > 50) warnings.push('oversize');
  if (input.weightKg > 25) warnings.push('overweight');

  return { ok: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/inbound-checklist.test.ts`
Expected: PASS — 9개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/inbound-checklist.ts src/lib/sourcing/__tests__/inbound-checklist.test.ts
git commit -m "feat(sourcing): add 1688 inbound checklist data + SKU input validation"
```

---

## Task 2: 입력 폼 컴포넌트

여러 SKU 행을 추가/삭제 가능한 폼. sessionStorage에 저장 후 print 페이지로 이동.

**Files:**
- Create: `src/components/sourcing/InboundChecklistForm.tsx`

- [ ] **Step 1: 폼 컴포넌트 작성**

`src/components/sourcing/InboundChecklistForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateSkuInput, type SkuInput } from '@/lib/sourcing/inbound-checklist';

const STORAGE_KEY = 'inbound-checklist-skus';

function emptyRow(): SkuInput {
  return {
    title: '',
    url1688: '',
    unitPriceRmb: 0,
    orderQty: 0,
    maxSideCm: 0,
    weightKg: 0,
    skuCode: '',
    notes: '',
  };
}

export default function InboundChecklistForm() {
  const router = useRouter();
  const [rows, setRows] = useState<SkuInput[]>([emptyRow()]);
  const [errors, setErrors] = useState<Record<number, string[]>>({});

  function update(idx: number, patch: Partial<SkuInput>) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((r) => [...r, emptyRow()]);
  }

  function removeRow(idx: number) {
    setRows((r) => r.filter((_, i) => i !== idx));
  }

  function handleGenerate() {
    const allErrors: Record<number, string[]> = {};
    rows.forEach((row, i) => {
      const v = validateSkuInput(row);
      if (!v.ok) allErrors[i] = v.errors;
    });
    setErrors(allErrors);

    if (Object.keys(allErrors).length > 0) return;

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    router.push('/sourcing/inbound-checklist/print');
  }

  return (
    <div className="space-y-4">
      {rows.map((row, i) => {
        const rowErrors = errors[i] ?? [];
        const has = (f: string) => rowErrors.includes(f);
        return (
          <div key={i} className="rounded border border-gray-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">SKU #{i + 1}</span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-sm text-red-600 hover:underline"
                >
                  삭제
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium">상품명 *</span>
                <input
                  type="text"
                  value={row.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  className={`mt-1 w-full rounded border px-2 py-1 text-sm ${has('title') ? 'border-red-400' : 'border-gray-300'}`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">1688 URL *</span>
                <input
                  type="text"
                  value={row.url1688}
                  onChange={(e) => update(i, { url1688: e.target.value })}
                  className={`mt-1 w-full rounded border px-2 py-1 text-sm ${has('url1688') ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="https://detail.1688.com/offer/..."
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">단가 (위안) *</span>
                <input
                  type="number"
                  step="0.01"
                  value={row.unitPriceRmb || ''}
                  onChange={(e) => update(i, { unitPriceRmb: Number(e.target.value) })}
                  className={`mt-1 w-full rounded border px-2 py-1 text-sm ${has('unitPriceRmb') ? 'border-red-400' : 'border-gray-300'}`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">발주수량 *</span>
                <input
                  type="number"
                  step="1"
                  value={row.orderQty || ''}
                  onChange={(e) => update(i, { orderQty: Number(e.target.value) })}
                  className={`mt-1 w-full rounded border px-2 py-1 text-sm ${has('orderQty') ? 'border-red-400' : 'border-gray-300'}`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">최장변 (cm) *</span>
                <input
                  type="number"
                  step="0.1"
                  value={row.maxSideCm || ''}
                  onChange={(e) => update(i, { maxSideCm: Number(e.target.value) })}
                  className={`mt-1 w-full rounded border px-2 py-1 text-sm ${has('maxSideCm') ? 'border-red-400' : 'border-gray-300'}`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">무게 (kg) *</span>
                <input
                  type="number"
                  step="0.01"
                  value={row.weightKg || ''}
                  onChange={(e) => update(i, { weightKg: Number(e.target.value) })}
                  className={`mt-1 w-full rounded border px-2 py-1 text-sm ${has('weightKg') ? 'border-red-400' : 'border-gray-300'}`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">쿠팡 SKU 코드</span>
                <input
                  type="text"
                  value={row.skuCode ?? ''}
                  onChange={(e) => update(i, { skuCode: e.target.value })}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs font-medium">메모</span>
                <textarea
                  value={row.notes ?? ''}
                  onChange={(e) => update(i, { notes: e.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
          </div>
        );
      })}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
        >
          + SKU 추가
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          체크리스트 생성 →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건

- [ ] **Step 3: 커밋**

```bash
git add src/components/sourcing/InboundChecklistForm.tsx
git commit -m "feat(ui): add InboundChecklistForm with multi-SKU input"
```

---

## Task 3: 입력 페이지 라우트

**Files:**
- Create: `src/app/sourcing/inbound-checklist/page.tsx`

- [ ] **Step 1: 페이지 작성**

`src/app/sourcing/inbound-checklist/page.tsx`:

```tsx
import InboundChecklistForm from '@/components/sourcing/InboundChecklistForm';

export const metadata = {
  title: '1688 입고 체크리스트',
  description: '회송 위험을 줄이기 위한 SKU별 입고 전 자체 검수 체크리스트',
};

export default function InboundChecklistPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">1688 입고 체크리스트</h1>
      <p className="mb-6 text-sm text-gray-600">
        SKU 정보를 입력하면 채널 영상 "회송 당합니다" 3편(포장·사이즈·바코드) 기준
        체크리스트가 자동 생성됩니다. 다음 페이지에서 브라우저 인쇄(Cmd+P) → PDF로 저장하세요.
        (전략 v2 §6.4)
      </p>
      <InboundChecklistForm />
    </main>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공

- [ ] **Step 3: 커밋**

```bash
git add src/app/sourcing/inbound-checklist/page.tsx
git commit -m "feat(page): add /sourcing/inbound-checklist input page"
```

---

## Task 4: 인쇄용 문서 컴포넌트

sessionStorage에서 SKU 데이터 읽어 SKU별 페이지로 렌더링.

**Files:**
- Create: `src/components/sourcing/InboundChecklistDoc.tsx`

- [ ] **Step 1: 문서 컴포넌트 작성**

`src/components/sourcing/InboundChecklistDoc.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { CHECKLIST_SECTIONS, type SkuInput } from '@/lib/sourcing/inbound-checklist';

const STORAGE_KEY = 'inbound-checklist-skus';

export default function InboundChecklistDoc() {
  const [skus, setSkus] = useState<SkuInput[] | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setSkus([]);
      return;
    }
    try {
      setSkus(JSON.parse(raw) as SkuInput[]);
    } catch {
      setSkus([]);
    }
  }, []);

  if (skus === null) return <div className="p-8 text-sm text-gray-500">불러오는 중…</div>;
  if (skus.length === 0) {
    return (
      <div className="p-8 text-sm text-gray-500">
        SKU 데이터가 없습니다.{' '}
        <a href="/sourcing/inbound-checklist" className="text-blue-600 underline">
          입력 페이지로 이동
        </a>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="checklist-print">
      <div className="mb-4 flex justify-between print:hidden">
        <a
          href="/sourcing/inbound-checklist"
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
        >
          ← 입력으로
        </a>
        <button
          onClick={() => window.print()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          🖨️ 인쇄 / PDF 저장
        </button>
      </div>

      {skus.map((sku, i) => (
        <article key={i} className="checklist-page mx-auto max-w-[210mm] bg-white p-10 print:p-0">
          <header className="mb-4 border-b border-gray-300 pb-3">
            <h2 className="text-xl font-bold">{sku.title}</h2>
            <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-700">
              <div>SKU #{i + 1} / {skus.length}</div>
              <div>발행일: {today}</div>
              <div>1688 URL: <a href={sku.url1688} className="break-all text-blue-700">{sku.url1688}</a></div>
              <div>쿠팡 SKU: {sku.skuCode || '-'}</div>
              <div>단가: {sku.unitPriceRmb} 위안 × {sku.orderQty}개</div>
              <div>규격: {sku.maxSideCm}cm / {sku.weightKg}kg</div>
            </div>
            {sku.notes && <div className="mt-2 rounded bg-gray-50 p-2 text-sm">메모: {sku.notes}</div>}
          </header>

          {CHECKLIST_SECTIONS.map((section) => (
            <section key={section.id} className="mb-5">
              <h3 className="mb-2 text-base font-semibold">{section.title}</h3>
              <ul className="space-y-2">
                {section.items.map((item) => (
                  <li key={item.id} className="flex gap-3 text-sm">
                    <span className="inline-block h-4 w-4 shrink-0 border border-gray-500 print:h-3 print:w-3" />
                    <div>
                      <div>{item.label}</div>
                      {item.caution && (
                        <div className="text-xs text-red-600">⚠ {item.caution}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <footer className="mt-6 border-t border-gray-300 pt-3 text-xs text-gray-500">
            전략 v2 §6.4 — 채널 spec 기반 자체 검수 도구. 발주 전 모든 항목 점검 필수.
          </footer>
        </article>
      ))}

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white; }
          .checklist-page { page-break-after: always; }
          .checklist-page:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건

- [ ] **Step 3: 커밋**

```bash
git add src/components/sourcing/InboundChecklistDoc.tsx
git commit -m "feat(ui): add InboundChecklistDoc with print-friendly layout"
```

---

## Task 5: 인쇄 페이지 라우트

**Files:**
- Create: `src/app/sourcing/inbound-checklist/print/page.tsx`

- [ ] **Step 1: 페이지 작성**

`src/app/sourcing/inbound-checklist/print/page.tsx`:

```tsx
import InboundChecklistDoc from '@/components/sourcing/InboundChecklistDoc';

export const metadata = {
  title: '1688 입고 체크리스트 (인쇄)',
};

export default function InboundChecklistPrintPage() {
  return (
    <main className="bg-gray-50 py-8 print:bg-white print:py-0">
      <InboundChecklistDoc />
    </main>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공, `/sourcing/inbound-checklist/print` 경로 포함

- [ ] **Step 3: 커밋**

```bash
git add src/app/sourcing/inbound-checklist/print/
git commit -m "feat(page): add /sourcing/inbound-checklist/print route"
```

---

## Task 6: 수동 동작 검증

- [ ] **Step 1: dev 서버 시작**

Run: `npm run dev`
Expected: localhost:3000

- [ ] **Step 2: 입력 페이지 접근**

URL: `http://localhost:3000/sourcing/inbound-checklist`
Expected: SKU #1 행이 표시되는 폼

- [ ] **Step 3: 정상 입력 → 체크리스트 생성**

다음 입력:
- 상품명: `테스트 텀블러 500ml`
- 1688 URL: `https://detail.1688.com/offer/123.html`
- 단가: `12.5`
- 발주수량: `100`
- 최장변: `20`
- 무게: `0.4`

"체크리스트 생성" 클릭 → Expected:
- `/sourcing/inbound-checklist/print` 페이지로 이동
- 헤더에 입력값 표시
- 3개 섹션 (포장/사이즈/바코드) 체크리스트 렌더링

- [ ] **Step 4: 검증 — 잘못된 입력**

다시 `/sourcing/inbound-checklist`로 이동 후 1688 URL을 `https://google.com`으로 변경, 생성 클릭 → Expected:
- 라우팅 차단, URL 입력 필드 빨간 테두리

- [ ] **Step 5: 검증 — 인쇄 미리보기**

print 페이지에서 Cmd+P → Expected:
- A4 사이즈 미리보기
- 체크박스가 인쇄 가능한 형태
- SKU 여러 개 입력 시 각 SKU가 새 페이지에서 시작

- [ ] **Step 6: 검증 — 빈 sessionStorage 직접 접근**

새 탭에서 `http://localhost:3000/sourcing/inbound-checklist/print` 직접 접근 →
Expected: "SKU 데이터가 없습니다" 메시지 + 입력 페이지 링크

- [ ] **Step 7: 검증 결과 메모**

발견된 UX 이슈가 있으면 issue 생성 또는 spec retrospective 노트로 추가.

---

## Self-Review Checklist

**1. Spec coverage** ✅
- §6.4 "회송 당합니다 3편 기준 체크리스트" → Task 1 (CHECKLIST_SECTIONS 3 sections)
- §6.4 "SKU별 입고 전 PDF 자동 생성" → Task 4·5 (인쇄 친화 페이지 + window.print()로 PDF 저장)

**2. Placeholder scan** ✅
- TBD/TODO 0건. 모든 코드 블록 완전.

**3. Type consistency** ✅
- `SkuInput` 인터페이스 — inbound-checklist.ts에서 정의, Form/Doc에서 import
- `STORAGE_KEY` 동일 상수 — Form과 Doc에서 일치 (`'inbound-checklist-skus'`)
- `ChecklistSection['id']` literal type — 'packaging' | 'size' | 'barcode' (Task 1 테스트가 검증)

**4. PDF 생성 방식**
- 외부 라이브러리 없음. `window.print()` + Tailwind print modifiers + `@media print` CSS로 처리.
- 한글 폰트 자동 적용 (시스템 폰트), Vercel/로컬 환경 차이 없음.
- 페이지 분리는 `.checklist-page { page-break-after: always; }`로 처리.

**5. 데이터 흐름**
- Form → sessionStorage → Doc. URL query string은 SKU 다중 + 긴 URL 제약으로 부적합.
- sessionStorage는 같은 탭에서만 유지 → 새 탭 직접 접근 시 안내 메시지 표시.

**6. 회귀 위험**
- 신규 페이지 라우트 + 신규 컴포넌트만 추가 — 기존 기능 영향 0.
- `validateSkuInput` 검증 로직은 외부 미사용. 추후 winner-dashboard 통합 시 import 가능.
