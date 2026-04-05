'use client';

import React, { useState, useMemo } from 'react';
import { ELEVENST_CATEGORIES } from '@/lib/calculator/fees';
import { calcElevenst } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, RadioGroup, ResultPanel, Card } from '../shared';

const categories = Object.keys(ELEVENST_CATEGORIES) as string[];

interface ElevenstTabProps {
  initialCostPrice?: number;
  initialShippingFee?: number;
}

export default function ElevenstTab({ initialCostPrice = 0, initialShippingFee }: ElevenstTabProps) {
  const [costPrice, setCostPrice] = useState(initialCostPrice);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [category, setCategory] = useState(categories[0]);
  const [shippingFee, setShippingFee] = useState(initialShippingFee ?? 3000);
  const [isNewSeller, setIsNewSeller] = useState<'no' | 'yes'>('no');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [adCost, setAdCost] = useState(0);

  const result = useMemo(() => {
    if (!sellingPrice) return null;
    return calcElevenst({
      costPrice,
      sellingPrice,
      category,
      shippingFee,
      couponDiscount,
      isNewSeller: isNewSeller === 'yes',
      adCost,
    });
  }, [costPrice, sellingPrice, category, shippingFee, couponDiscount, isNewSeller, adCost]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="상품 정보">
        <NumberInput label="원가 (공급가)" value={costPrice} onChange={setCostPrice} />
        <NumberInput label="판매가" value={sellingPrice} onChange={setSellingPrice} />
        <SelectInput label="카테고리" value={category} onChange={setCategory} options={categories} />
        <NumberInput label="배송비" value={shippingFee} onChange={setShippingFee} />
        <RadioGroup
          label="신규 셀러 프로모션"
          value={isNewSeller}
          onChange={setIsNewSeller}
          options={[
            { value: 'no', label: '일반' },
            { value: 'yes', label: '신규 (최대 6%)' },
          ]}
        />
        <NumberInput label="쿠폰 할인액 (선택)" value={couponDiscount} onChange={setCouponDiscount} />
        <NumberInput label="광고비 (선택)" value={adCost} onChange={setAdCost} />
      </Card>

      <ResultPanel result={result} />
    </div>
  );
}
