'use client';

import type { SkuRoiData } from '@/lib/roi/types';

interface Props {
  sku: SkuRoiData | null;
  onClose: () => void;
}

function CheckRow({ label, value, pass }: { label: string; value: string; pass: boolean }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-zinc-700 last:border-0">
      <span className="flex items-center gap-2 text-sm text-zinc-300">
        <span>{pass ? '✅' : '⬜'}</span>
        {label}
      </span>
      <span className={`text-sm font-medium ${pass ? 'text-green-400' : 'text-zinc-500'}`}>
        {value}
      </span>
    </div>
  );
}

export function SkuDetailPanel({ sku, onClose }: Props) {
  if (!sku) return null;

  const purchaseNetProfit = sku.marginAmount * 1.5 * sku.salesCount - sku.adSpend;

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-zinc-900 border-l border-zinc-700 shadow-2xl z-50 flex flex-col overflow-y-auto">
      <div className="flex justify-between items-start px-4 py-4 border-b border-zinc-700 sticky top-0 bg-zinc-900">
        <p className="text-sm font-medium text-white leading-snug max-w-[220px]">
          {sku.productName}
        </p>
        <button onClick={onClose} className="text-zinc-400 hover:text-white text-lg leading-none">
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase mb-2">위너 판별 기준</h3>
          <div className="rounded-lg bg-zinc-800 px-3 py-2">
            <CheckRow
              label="클릭수 ≥ 100"
              value={`${sku.clicks}회`}
              pass={sku.clicks >= 100}
            />
            <CheckRow
              label="전환율 ≥ 1.5%"
              value={`${sku.conversionRate.toFixed(1)}%`}
              pass={sku.conversionRate >= 1.5}
            />
            <CheckRow
              label="ROAS ≥ 250%"
              value={sku.adjustedRoas === Infinity ? '—' : `${Math.round(sku.adjustedRoas)}%`}
              pass={sku.adjustedRoas >= 250}
            />
            <CheckRow
              label="판매 ≥ 5건"
              value={`${sku.salesCount}건`}
              pass={sku.salesCount >= 5}
            />
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase mb-2">광고비 보정 상세</h3>
          <div className="rounded-lg bg-zinc-800 px-3 py-2 space-y-2 text-sm">
            <div className="flex justify-between text-zinc-300">
              <span>보고서 광고비</span>
              <span>{sku.adSpend.toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-zinc-400 text-xs">
              <span>① 취소 주문 제외 매출</span>
              <span>-{sku.cancelledSales.toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-zinc-400 text-xs">
              <span>② 쿠폰 할인 반영</span>
              <span>-{sku.couponDiscount.toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-white font-medium border-t border-zinc-700 pt-2">
              <span>보정 ROAS</span>
              <span className={sku.adjustedRoas >= sku.breakEvenRoas ? 'text-green-400' : 'text-red-400'}>
                {sku.adjustedRoas === Infinity ? '—' : `${Math.round(sku.adjustedRoas)}%`}
              </span>
            </div>
            <div className="flex justify-between text-zinc-400 text-xs">
              <span>손익분기 ROAS</span>
              <span>{sku.breakEvenRoas === Infinity ? '—' : `${Math.round(sku.breakEvenRoas)}%`}</span>
            </div>
          </div>
        </section>

        {sku.winnerStatus === 'winner' && (
          <section>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase mb-2">사입 전환 시 예상</h3>
            <div className="rounded-lg bg-zinc-800 px-3 py-2 space-y-2 text-sm">
              <div className="flex justify-between text-zinc-300">
                <span>현재 순이익</span>
                <span>{sku.netProfit.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-green-300 font-medium">
                <span>사입 후 예상 순이익</span>
                <span>{purchaseNetProfit.toLocaleString()}원</span>
              </div>
              <p className="text-xs text-zinc-500 pt-1">* 1688 사입 시 원가 50% 절감 가정</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
