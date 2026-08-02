'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { GMARKET_CATEGORIES } from '@/lib/calculator/fees';
import { calcGmarket } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, ResultPanel, Card } from '../shared';
import { loadCalcState, saveCalcState, CALC_SAVE_DEBOUNCE_MS } from '../persist';

const categories = Object.keys(GMARKET_CATEGORIES) as string[];

const STORAGE_KEY = 'sss_calc_gmarket';

interface GmarketSavedState {
  costPrice: number;
  sellingPrice: number;
  category: string;
  shippingFee: number;
  couponDiscount: number;
  adCost: number;
  isAdRunning: boolean;
  conversionRate: number;
}

interface GmarketTabProps {
  initialCostPrice?: number;
  initialShippingFee?: number;
}

export default function GmarketTab({ initialCostPrice = 0, initialShippingFee }: GmarketTabProps) {
  // 최초 렌더는 서버 렌더 결과와 동일해야 하므로 기존 기본값 그대로 두고, 저장값은
  // 마운트 후 한 번에 복원한다 (숫자 입력도 result 구조를 바꿔 지연 초기화 시 하이드레이션이 깨진다)
  const [costPrice, setCostPrice] = useState(initialCostPrice);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [category, setCategory] = useState(categories[0]);
  const [shippingFee, setShippingFee] = useState(initialShippingFee ?? 3000);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [adCost, setAdCost] = useState(0);
  const [isAdRunning, setIsAdRunning] = useState(false);
  const [conversionRate, setConversionRate] = useState(3);

  useEffect(() => {
    const saved = loadCalcState<GmarketSavedState>(STORAGE_KEY);
    if (typeof saved.costPrice === 'number') setCostPrice(saved.costPrice);
    if (typeof saved.sellingPrice === 'number') setSellingPrice(saved.sellingPrice);
    if (saved.category && categories.includes(saved.category)) setCategory(saved.category);
    if (typeof saved.shippingFee === 'number') setShippingFee(saved.shippingFee);
    if (typeof saved.couponDiscount === 'number') setCouponDiscount(saved.couponDiscount);
    if (typeof saved.adCost === 'number') setAdCost(saved.adCost);
    if (typeof saved.isAdRunning === 'boolean') setIsAdRunning(saved.isAdRunning);
    if (typeof saved.conversionRate === 'number') setConversionRate(saved.conversionRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveCalcState(STORAGE_KEY, {
        costPrice, sellingPrice, category, shippingFee, couponDiscount, adCost, isAdRunning, conversionRate,
      });
    }, CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [costPrice, sellingPrice, category, shippingFee, couponDiscount, adCost, isAdRunning, conversionRate]);

  const result = useMemo(() => {
    if (!sellingPrice) return null;
    return calcGmarket({
      costPrice,
      sellingPrice,
      category,
      shippingFee,
      couponDiscount,
      adCost: isAdRunning ? adCost : 0,
      conversionRate: isAdRunning ? conversionRate / 100 : 0,
    });
  }, [costPrice, sellingPrice, category, shippingFee, couponDiscount, adCost, isAdRunning, conversionRate]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="상품 정보">
        <NumberInput label="원가 (공급가)" value={costPrice} onChange={setCostPrice} />
        <NumberInput label="판매가" value={sellingPrice} onChange={setSellingPrice} />
        <SelectInput label="카테고리" value={category} onChange={setCategory} options={categories} />
        <NumberInput label="배송비 (선결제)" value={shippingFee} onChange={setShippingFee} />
        <NumberInput label="쿠폰 할인액 (선택)" value={couponDiscount} onChange={setCouponDiscount} />

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

      <ResultPanel result={result} isAdRunning={isAdRunning} />
    </div>
  );
}
