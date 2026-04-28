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
