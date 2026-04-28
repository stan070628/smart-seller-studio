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
