'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { NAVER_ORDER_MGMT_FEE, NAVER_SALES_FEE, type NaverGrade, type NaverInflow } from '@/lib/calculator/fees';
import { calcNaver } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, RadioGroup, ResultPanel, Card } from '../shared';
import { loadCalcState, saveCalcState, CALC_SAVE_DEBOUNCE_MS } from '../persist';

const grades = Object.keys(NAVER_ORDER_MGMT_FEE) as NaverGrade[];
const inflowOptions: { value: NaverInflow; label: string }[] = [
  { value: '네이버쇼핑', label: '네이버쇼핑 (2.73%)' },
  { value: '마케팅링크', label: '마케팅링크 (0.91%)' },
];
const inflowValues = inflowOptions.map((o) => o.value);

const STORAGE_KEY = 'sss_calc_naver';

interface NaverSavedState {
  costPrice: number;
  sellingPrice: number;
  shippingFee: number;
  grade: NaverGrade;
  inflow: NaverInflow;
  adCost: number;
  isAdRunning: boolean;
  conversionRate: number;
}

interface NaverTabProps {
  initialCostPrice?: number;
  initialShippingFee?: number;
}

export default function NaverTab({ initialCostPrice = 0, initialShippingFee }: NaverTabProps) {
  // 최초 렌더는 서버 렌더 결과와 동일한 기존 기본값을 쓴다. 숫자 입력값도 result(계산 결과)의
  // 구조를 바꾸므로(예: 결과 없음 안내 ↔ 결과 패널) 지연 초기화로 즉시 복원하면 하이드레이션이
  // 깨진다 — 마운트 후 한 번에 복원한다.
  const [costPrice, setCostPrice] = useState(initialCostPrice);
  const [sellingPrice, setSellingPrice] = useState(0);
  const [shippingFee, setShippingFee] = useState(initialShippingFee ?? 3000);
  const [grade, setGrade] = useState<NaverGrade>('일반');
  const [inflow, setInflow] = useState<NaverInflow>('네이버쇼핑');
  const [adCost, setAdCost] = useState(0);
  const [isAdRunning, setIsAdRunning] = useState(false);
  const [conversionRate, setConversionRate] = useState(3);

  useEffect(() => {
    const saved = loadCalcState<NaverSavedState>(STORAGE_KEY);
    if (typeof saved.costPrice === 'number') setCostPrice(saved.costPrice);
    if (typeof saved.sellingPrice === 'number') setSellingPrice(saved.sellingPrice);
    if (typeof saved.shippingFee === 'number') setShippingFee(saved.shippingFee);
    if (saved.grade && grades.includes(saved.grade)) setGrade(saved.grade);
    if (saved.inflow && inflowValues.includes(saved.inflow)) setInflow(saved.inflow);
    if (typeof saved.adCost === 'number') setAdCost(saved.adCost);
    if (typeof saved.isAdRunning === 'boolean') setIsAdRunning(saved.isAdRunning);
    if (typeof saved.conversionRate === 'number') setConversionRate(saved.conversionRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveCalcState(STORAGE_KEY, {
        costPrice, sellingPrice, shippingFee, grade, inflow, adCost, isAdRunning, conversionRate,
      });
    }, CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [costPrice, sellingPrice, shippingFee, grade, inflow, adCost, isAdRunning, conversionRate]);

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
