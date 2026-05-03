'use client';

import React, { useState, useMemo } from 'react';
import { GMARKET_CATEGORIES } from '@/lib/calculator/fees';
import { calcGmarket } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, ResultPanel, Card } from '../shared';

const categories = Object.keys(GMARKET_CATEGORIES) as string[];

interface GmarketTabProps {
  initialCostPrice?: number;
  initialShippingFee?: number;
}

export default function GmarketTab({ initialCostPrice = 0, initialShippingFee }: GmarketTabProps) {
  const [costPrice, setCostPrice] = useState(initialCostPrice);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [category, setCategory] = useState(categories[0]);
  const [shippingFee, setShippingFee] = useState(initialShippingFee ?? 3000);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [adCost, setAdCost] = useState(0);
  const [isAdRunning, setIsAdRunning] = useState(false);
  const [conversionRate, setConversionRate] = useState(3);

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
