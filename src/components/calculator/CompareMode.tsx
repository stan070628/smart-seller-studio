'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { getCoupangCategoryNames, getCoupangFeeRateByCategoryName } from '@/lib/calculator/coupang-fees';
import { calcCompareAll, type CompareResult } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, Card } from './shared';
import { loadCalcState, saveCalcState, CALC_SAVE_DEBOUNCE_MS } from './persist';
import { Trophy } from 'lucide-react';

const categories = getCoupangCategoryNames();

const STORAGE_KEY = 'sss_calc_compare';

interface CompareSavedState {
  costPrice: number;
  sellingPrice: number;
  shippingFee: number;
  category: string;
}

interface CompareModeProps {
  initialCostPrice?: number;
}

export default function CompareMode({ initialCostPrice = 0 }: CompareModeProps) {
  // 최초 렌더는 서버 렌더 결과와 동일해야 한다 (sellingPrice가 결과 테이블 표시 여부를
  // 구조적으로 바꾼다). 저장값은 마운트 후 한 번에 복원한다.
  const [costPrice, setCostPrice] = useState(initialCostPrice);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [shippingFee, setShippingFee] = useState(3000);
  const [category, setCategory] = useState(categories[0]);

  useEffect(() => {
    const saved = loadCalcState<CompareSavedState>(STORAGE_KEY);
    if (typeof saved.costPrice === 'number') setCostPrice(saved.costPrice);
    if (typeof saved.sellingPrice === 'number') setSellingPrice(saved.sellingPrice);
    if (typeof saved.shippingFee === 'number') setShippingFee(saved.shippingFee);
    if (saved.category && categories.includes(saved.category)) setCategory(saved.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveCalcState(STORAGE_KEY, { costPrice, sellingPrice, shippingFee, category });
    }, CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [costPrice, sellingPrice, shippingFee, category]);

  const results: CompareResult[] = useMemo(() => {
    if (!sellingPrice) return [];
    return calcCompareAll({ costPrice, sellingPrice, shippingFee, feeRate: getCoupangFeeRateByCategoryName(category), category });
  }, [costPrice, sellingPrice, shippingFee, category]);

  const bestIdx = results.length
    ? results.reduce((best, r, i) => (r.marginRate > results[best].marginRate ? i : best), 0)
    : -1;

  return (
    <div className="flex flex-col gap-4">
      <Card title="공통 입력">
        <div className="grid gap-3 md:grid-cols-2">
          <NumberInput label="원가 (공급가)" value={costPrice} onChange={setCostPrice} />
          <NumberInput label="판매가" value={sellingPrice} onChange={setSellingPrice} />
          <NumberInput label="배송비" value={shippingFee} onChange={setShippingFee} />
          <SelectInput label="카테고리" value={category} onChange={setCategory} options={categories} />
        </div>
      </Card>

      {results.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
          <div className="border-b border-[#f4f4f5] px-4 py-3">
            <h3 className="text-xs font-semibold text-[#71717a]">플랫폼 비교 결과</h3>
          </div>

          {/* 모바일: 카드 리스트 / PC: 테이블 */}
          {/* 모바일 뷰 */}
          <div className="flex flex-col gap-px bg-[#f4f4f5] md:hidden">
            {results.map((r, i) => {
              const isBest = i === bestIdx;
              const isProfit = r.netProfit >= 0;
              return (
                <div
                  key={r.platform}
                  className={`flex items-center justify-between bg-white px-4 py-3 ${isBest ? 'ring-2 ring-inset ring-[#16a34a]/20' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    {isBest && <Trophy size={14} className="text-[#16a34a]" />}
                    <div>
                      <p className={`text-sm font-medium ${isBest ? 'text-[#16a34a]' : 'text-[#18181b]'}`}>
                        {r.platform}
                      </p>
                      <p className="text-[10px] text-[#a1a1aa]">
                        수수료 {r.totalFees.toLocaleString()}원
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${isProfit ? 'text-[#16a34a]' : 'text-[#ef4444]'}`}>
                      {r.netProfit >= 0 ? '+' : ''}{r.netProfit.toLocaleString()}원
                    </p>
                    <p className={`text-xs font-semibold ${isProfit ? 'text-[#16a34a]' : 'text-[#ef4444]'}`}>
                      {r.marginRate.toFixed(1)}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* PC 뷰 */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f4f4f5] text-left text-xs text-[#71717a]">
                  <th className="px-4 py-2.5 font-medium">플랫폼</th>
                  <th className="px-4 py-2.5 text-right font-medium">수수료 합계</th>
                  <th className="px-4 py-2.5 text-right font-medium">배송 수수료</th>
                  <th className="px-4 py-2.5 text-right font-medium">총 비용</th>
                  <th className="px-4 py-2.5 text-right font-medium">순이익</th>
                  <th className="px-4 py-2.5 text-right font-medium">마진율</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const isBest = i === bestIdx;
                  const isProfit = r.netProfit >= 0;
                  return (
                    <tr
                      key={r.platform}
                      className={`border-b border-[#f4f4f5] last:border-0 ${isBest ? 'bg-[#16a34a]/5' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {isBest && <Trophy size={14} className="text-[#16a34a]" />}
                          <span className={`font-medium ${isBest ? 'text-[#16a34a]' : 'text-[#18181b]'}`}>
                            {r.platform}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-[#ef4444]">
                        {r.commissionFee.toLocaleString()}원
                      </td>
                      <td className="px-4 py-3 text-right text-[#71717a]">
                        {r.shippingCommission.toLocaleString()}원
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[#ef4444]">
                        {r.totalFees.toLocaleString()}원
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${isProfit ? 'text-[#16a34a]' : 'text-[#ef4444]'}`}>
                        {r.netProfit >= 0 ? '+' : ''}{r.netProfit.toLocaleString()}원
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${isProfit ? 'text-[#16a34a]' : 'text-[#ef4444]'}`}>
                        {r.marginRate.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
