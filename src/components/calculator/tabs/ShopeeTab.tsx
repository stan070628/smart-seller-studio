'use client';

import React, { useState, useMemo } from 'react';
import {
  SHOPEE_DATA,
  SHOPEE_SERVICE_PROGRAMS,
  type ShopeeCountry,
  type ShopeeProgram,
} from '@/lib/calculator/fees';
import { calcShopee } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, ResultPanel, Card } from '../shared';

const countries = Object.keys(SHOPEE_DATA) as ShopeeCountry[];
const programs = Object.keys(SHOPEE_SERVICE_PROGRAMS) as ShopeeProgram[];

const DEFAULT_RATES: Record<ShopeeCountry, number> = {
  '말레이시아': 310,
  '싱가포르': 990,
  '태국': 38,
};

interface ShopeeTabProps {
  initialCostPrice?: number;
}

export default function ShopeeTab({ initialCostPrice = 0 }: ShopeeTabProps) {
  const [country, setCountry] = useState<ShopeeCountry>('말레이시아');
  const [costPriceKRW, setCostPriceKRW] = useState(initialCostPrice);
  const [exchangeRate, setExchangeRate] = useState(DEFAULT_RATES['말레이시아']);
  const [sellingPriceLocal, setSellingPriceLocal] = useState(0);
  const [category, setCategory] = useState('생활용품');
  const [program, setProgram] = useState<ShopeeProgram>('없음');
  const [affiliateRate, setAffiliateRate] = useState(0);
  const [shippingFeeKRW, setShippingFeeKRW] = useState(0);
  const [adCostKRW, setAdCostKRW] = useState(0);

  const countryData = SHOPEE_DATA[country];
  const categoryOptions = Object.keys(countryData.commission);

  const handleCountryChange = (c: ShopeeCountry) => {
    setCountry(c);
    setExchangeRate(DEFAULT_RATES[c]);
    const cats = Object.keys(SHOPEE_DATA[c].commission);
    if (!cats.includes(category)) setCategory(cats[0]);
  };

  const result = useMemo(() => {
    if (!sellingPriceLocal || !exchangeRate) return null;
    return calcShopee({
      costPriceKRW,
      sellingPriceLocal,
      exchangeRate,
      country,
      category,
      program,
      affiliateRate,
      shippingFeeKRW,
      adCostKRW,
    });
  }, [costPriceKRW, sellingPriceLocal, exchangeRate, country, category, program, affiliateRate, shippingFeeKRW, adCostKRW]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="상품 정보">
        <SelectInput label="판매 국가" value={country} onChange={handleCountryChange} options={countries} />
        <NumberInput label="원가 (공급가 KRW)" value={costPriceKRW} onChange={setCostPriceKRW} />
        <NumberInput
          label={`환율 (1 ${countryData.currency} = ? KRW)`}
          value={exchangeRate}
          onChange={setExchangeRate}
          suffix="원"
        />
        <NumberInput
          label={`판매가 (${countryData.currency})`}
          value={sellingPriceLocal}
          onChange={setSellingPriceLocal}
          suffix={countryData.currency}
        />
        <SelectInput label="카테고리" value={category} onChange={setCategory} options={categoryOptions} />
        <SelectInput label="서비스 프로그램" value={program} onChange={setProgram} options={programs} />
        <NumberInput label="Affiliate 커미션율" value={affiliateRate} onChange={setAffiliateRate} suffix="%" />
        <NumberInput label="배송비 (KRW)" value={shippingFeeKRW} onChange={setShippingFeeKRW} />
        <NumberInput label="광고비 (KRW)" value={adCostKRW} onChange={setAdCostKRW} />
      </Card>

      <div className="flex flex-col gap-4">
        {sellingPriceLocal > 0 && exchangeRate > 0 && (
          <div className="rounded-xl bg-[#fef3c7] px-4 py-3">
            <p className="text-xs text-[#92400e]">
              판매가 환산: <strong>{(sellingPriceLocal * exchangeRate).toLocaleString()}원</strong>
              <span className="ml-1 text-[#b45309]">
                ({sellingPriceLocal.toLocaleString()} {countryData.currency} x {exchangeRate}원)
              </span>
            </p>
          </div>
        )}
        <ResultPanel result={result} />
      </div>
    </div>
  );
}
