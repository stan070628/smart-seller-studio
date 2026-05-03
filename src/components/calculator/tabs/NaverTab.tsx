'use client';

import React, { useState, useMemo } from 'react';
import { NAVER_ORDER_MGMT_FEE, NAVER_SALES_FEE, type NaverGrade, type NaverInflow } from '@/lib/calculator/fees';
import { calcNaver } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, RadioGroup, ResultPanel, Card } from '../shared';

const grades = Object.keys(NAVER_ORDER_MGMT_FEE) as NaverGrade[];
const inflowOptions: { value: NaverInflow; label: string }[] = [
  { value: '네이버쇼핑', label: '네이버쇼핑 (2.73%)' },
  { value: '마케팅링크', label: '마케팅링크 (0.91%)' },
];

interface NaverTabProps {
  initialCostPrice?: number;
  initialShippingFee?: number;
}

export default function NaverTab({ initialCostPrice = 0, initialShippingFee }: NaverTabProps) {
  const [costPrice, setCostPrice] = useState(initialCostPrice);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [shippingFee, setShippingFee] = useState(initialShippingFee ?? 3000);
  const [grade, setGrade] = useState<NaverGrade>('일반');
  const [inflow, setInflow] = useState<NaverInflow>('네이버쇼핑');
  const [adCost, setAdCost] = useState(0);
  const [isAdRunning, setIsAdRunning] = useState(false);
  const [conversionRate, setConversionRate] = useState(3);

  const result = useMemo(() => {
    if (!sellingPrice) return null;
    return calcNaver({
      costPrice,
      sellingPrice,
      shippingFee,
      grade,
      inflow,
      adCost: isAdRunning ? adCost : 0,
      conversionRate: isAdRunning ? conversionRate / 100 : 0,
    });
  }, [costPrice, sellingPrice, shippingFee, grade, inflow, adCost, isAdRunning, conversionRate]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="상품 정보">
        <NumberInput label="원가 (공급가)" value={costPrice} onChange={setCostPrice} />
        <NumberInput label="판매가" value={sellingPrice} onChange={setSellingPrice} />
        <NumberInput label="배송비" value={shippingFee} onChange={setShippingFee} />
        <SelectInput label="매출 등급" value={grade} onChange={setGrade} options={grades} />
        <RadioGroup label="유입 경로" value={inflow} onChange={setInflow} options={inflowOptions} />

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
