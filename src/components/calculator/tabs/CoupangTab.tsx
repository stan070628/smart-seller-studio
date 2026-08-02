'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { COUPANG_ROCKET_LOGISTICS, type RocketSize } from '@/lib/calculator/fees';
import { getCoupangCategoryNames, getCoupangFeeRateByCategoryName } from '@/lib/calculator/coupang-fees';
import { calcCoupangWing, calcCoupangRocket } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, RadioGroup, ResultPanel, Card } from '../shared';
import { loadCalcState, saveCalcState, CALC_SAVE_DEBOUNCE_MS } from '../persist';

type Mode = 'wing' | 'rocket';

const categories = getCoupangCategoryNames();
const sizes = Object.keys(COUPANG_ROCKET_LOGISTICS) as RocketSize[];

const STORAGE_KEY = 'sss_calc_coupang';

/** localStorage에 저장하는 입력값 모양. 계산 결과·로딩 플래그는 포함하지 않는다 */
interface CoupangSavedState {
  mode: Mode;
  costPrice: number;
  sellingPrice: number;
  category: string;
  shippingFee: number;
  adCost: number;
  size: RocketSize;
  monthlyQty: number;
  isAdRunning: boolean;
  conversionRate: number;
}

interface CoupangTabProps {
  initialCostPrice?: number;
  initialShippingFee?: number;
}

export default function CoupangTab({ initialCostPrice = 0, initialShippingFee }: CoupangTabProps) {
  // 최초 렌더는 항상 기존 기본값과 동일해야 한다 (서버 렌더 결과와 클라이언트 첫 렌더가
  // 달라지면 result(계산 결과)가 구조적으로 다른 트리를 그려 하이드레이션이 깨진다 —
  // 실제로 지연 초기화로 값을 즉시 복원했다가 ResultPanel 트리 불일치를 확인해 이 방식으로 바꿨다).
  // 저장된 값은 마운트가 끝난 뒤 한 번에 복원한다.
  const [mode, setMode] = useState<Mode>('wing');
  const [costPrice, setCostPrice] = useState(initialCostPrice);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [category, setCategory] = useState(categories[0]);
  const [shippingFee, setShippingFee] = useState(initialShippingFee ?? 3000);
  const [adCost, setAdCost] = useState(0);
  const [size, setSize] = useState<RocketSize>('소형');
  const [monthlyQty, setMonthlyQty] = useState(0);
  const [isAdRunning, setIsAdRunning] = useState(false);
  const [conversionRate, setConversionRate] = useState(3);

  useEffect(() => {
    const saved = loadCalcState<CoupangSavedState>(STORAGE_KEY);
    if (saved.mode === 'wing' || saved.mode === 'rocket') setMode(saved.mode);
    if (typeof saved.costPrice === 'number') setCostPrice(saved.costPrice);
    if (typeof saved.sellingPrice === 'number') setSellingPrice(saved.sellingPrice);
    if (saved.category && categories.includes(saved.category)) setCategory(saved.category);
    if (typeof saved.shippingFee === 'number') setShippingFee(saved.shippingFee);
    if (typeof saved.adCost === 'number') setAdCost(saved.adCost);
    if (saved.size && sizes.includes(saved.size)) setSize(saved.size);
    if (typeof saved.monthlyQty === 'number') setMonthlyQty(saved.monthlyQty);
    if (typeof saved.isAdRunning === 'boolean') setIsAdRunning(saved.isAdRunning);
    if (typeof saved.conversionRate === 'number') setConversionRate(saved.conversionRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 입력값이 바뀌면 디바운스 후 저장한다. 계산 결과(result)는 저장 대상이 아니다.
  useEffect(() => {
    const timer = setTimeout(() => {
      saveCalcState(STORAGE_KEY, {
        mode,
        costPrice,
        sellingPrice,
        category,
        shippingFee,
        adCost,
        size,
        monthlyQty,
        isAdRunning,
        conversionRate,
      });
    }, CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [mode, costPrice, sellingPrice, category, shippingFee, adCost, size, monthlyQty, isAdRunning, conversionRate]);

  const result = useMemo(() => {
    if (!sellingPrice) return null;
    const feeRate = getCoupangFeeRateByCategoryName(category);
    if (mode === 'wing') {
      return calcCoupangWing({
        costPrice,
        sellingPrice,
        feeRate,
        shippingFee,
        adCost: isAdRunning ? adCost : 0,
        conversionRate: isAdRunning ? conversionRate / 100 : 0,
      });
    }
    return calcCoupangRocket({
      costPrice,
      sellingPrice,
      feeRate,
      size,
      monthlyQty,
      adCost: isAdRunning ? adCost : 0,
      conversionRate: isAdRunning ? conversionRate / 100 : 0,
    });
  }, [mode, costPrice, sellingPrice, category, shippingFee, adCost, size, monthlyQty, isAdRunning, conversionRate]);

  return (
    <div className="flex flex-col gap-4">
      {/* 판매방식 선택 */}
      <RadioGroup
        label="판매 방식"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'wing', label: '윙 (직접배송)' },
          { value: 'rocket', label: '로켓그로스' },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {/* 입력 */}
        <Card title="상품 정보">
          <NumberInput label="원가 (공급가)" value={costPrice} onChange={setCostPrice} />
          <NumberInput label="판매가" value={sellingPrice} onChange={setSellingPrice} />
          <SelectInput label="카테고리" value={category} onChange={setCategory} options={categories} />

          {mode === 'wing' ? (
            <NumberInput label="배송비 (판매자 부담)" value={shippingFee} onChange={setShippingFee} />
          ) : (
            <>
              <SelectInput label="상품 사이즈" value={size} onChange={setSize} options={sizes} />
              <NumberInput label="월 예상 판매량" value={monthlyQty} onChange={setMonthlyQty} suffix="개" />
            </>
          )}

          {/* 광고 운영 여부 토글 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#52525b]">광고 운영 중</span>
            <button
              type="button"
              onClick={() => setIsAdRunning(!isAdRunning)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                isAdRunning ? 'bg-[#18181b]' : 'bg-[#e5e5e5]'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  isAdRunning ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* 광고 운영 중일 때만 표시 */}
          {isAdRunning && (
            <>
              <NumberInput label="광고비" value={adCost} onChange={setAdCost} />
              <NumberInput label="전환율" value={conversionRate} onChange={setConversionRate} suffix="%" />
            </>
          )}
        </Card>

        {/* 결과 */}
        <div className="flex flex-col gap-4">
          <ResultPanel result={result} isAdRunning={isAdRunning} />
          {mode === 'rocket' && (
            <p className="text-[10px] leading-relaxed text-[#a1a1aa]">
              * 로켓그로스 물류비는 추정값입니다. 정확한 요금은 쿠팡 판매자센터에서 확인하세요.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
