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

  const result = useMemo(() => {
    if (!sellingPrice) return null;
    return calcNaver({ costPrice, sellingPrice, shippingFee, grade, inflow, adCost });
  }, [costPrice, sellingPrice, shippingFee, grade, inflow, adCost]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="상품 정보">
        <NumberInput label="원가 (공급가)" value={costPrice} onChange={setCostPrice} />
        <NumberInput label="판매가" value={sellingPrice} onChange={setSellingPrice} />
        <NumberInput label="배송비" value={shippingFee} onChange={setShippingFee} />
        <SelectInput label="매출 등급" value={grade} onChange={setGrade} options={grades} />
        <RadioGroup label="유입 경로" value={inflow} onChange={setInflow} options={inflowOptions} />
        <NumberInput label="광고비 (선택)" value={adCost} onChange={setAdCost} />
      </Card>

      <ResultPanel result={result} />
    </div>
  );
}
