'use client';

import React, { useState, useMemo } from 'react';
import { COUPANG_ROCKET_LOGISTICS, type RocketSize } from '@/lib/calculator/fees';
import { COUPANG_FEE_MAP, getCoupangCategoryNames } from '@/lib/calculator/coupang-fees';
import { calcCoupangWing, calcCoupangRocket } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, RadioGroup, ResultPanel, Card } from '../shared';

type Mode = 'wing' | 'rocket';

const categories = getCoupangCategoryNames();
const sizes = Object.keys(COUPANG_ROCKET_LOGISTICS) as RocketSize[];

function feeRateForCategoryName(name: string): number {
  const hit = COUPANG_FEE_MAP.find((e) => e.categoryName === name);
  return hit?.rate ?? 0.108;
}

interface CoupangTabProps {
  initialCostPrice?: number;
  initialShippingFee?: number;
}

export default function CoupangTab({ initialCostPrice = 0, initialShippingFee }: CoupangTabProps) {
  const [mode, setMode] = useState<Mode>('wing');
  const [costPrice, setCostPrice] = useState(initialCostPrice);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [category, setCategory] = useState(categories[0]);
  const [shippingFee, setShippingFee] = useState(initialShippingFee ?? 3000);
  const [adCost, setAdCost] = useState(0);
  const [size, setSize] = useState<RocketSize>('소형');
  const [monthlyQty, setMonthlyQty] = useState(0);

  const result = useMemo(() => {
    if (!sellingPrice) return null;
    const feeRate = feeRateForCategoryName(category);
    if (mode === 'wing') {
      return calcCoupangWing({ costPrice, sellingPrice, feeRate, shippingFee, adCost });
    }
    return calcCoupangRocket({ costPrice, sellingPrice, feeRate, size, monthlyQty, adCost });
  }, [mode, costPrice, sellingPrice, category, shippingFee, adCost, size, monthlyQty]);

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

          <NumberInput label="광고비 (선택)" value={adCost} onChange={setAdCost} />
        </Card>

        {/* 결과 */}
        <div className="flex flex-col gap-4">
          <ResultPanel result={result} />
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
