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

  const result = useMemo(() => {
    if (!sellingPrice) return null;
    return calcGmarket({ costPrice, sellingPrice, category, shippingFee, couponDiscount, adCost });
  }, [costPrice, sellingPrice, category, shippingFee, couponDiscount, adCost]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="상품 정보">
        <NumberInput label="원가 (공급가)" value={costPrice} onChange={setCostPrice} />
        <NumberInput label="판매가" value={sellingPrice} onChange={setSellingPrice} />
        <SelectInput label="카테고리" value={category} onChange={setCategory} options={categories} />
        <NumberInput label="배송비 (선결제)" value={shippingFee} onChange={setShippingFee} />
        <NumberInput label="쿠폰 할인액 (선택)" value={couponDiscount} onChange={setCouponDiscount} />
        <NumberInput label="광고비 (선택)" value={adCost} onChange={setAdCost} />
      </Card>

      <ResultPanel result={result} />
    </div>
  );
}
