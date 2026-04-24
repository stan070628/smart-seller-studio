'use client';
import { useState } from 'react';
import { calcCoupangWing } from '@/lib/calculator/calculate';

export interface PriceStockValue {
  salePrice: number;
  originalPrice: number;
  stockQuantity: number;
}

interface Props {
  initialValue: Partial<PriceStockValue>;
  costPrice: number;
  confidences?: Partial<Record<keyof PriceStockValue, number>>;
  onNext: (value: PriceStockValue) => void;
  onBack: () => void;
}

export function Step2PriceStock({ initialValue, costPrice, onNext, onBack }: Props) {
  const [salePrice, setSalePrice] = useState(initialValue.salePrice ?? 0);
  const [originalPrice, setOriginalPrice] = useState(initialValue.originalPrice ?? 0);
  const [stock, setStock] = useState(initialValue.stockQuantity ?? 100);

  // calcCoupangWing 반환: { netProfit, marginRate(이미 % 값), ... }
  const calc = calcCoupangWing({
    costPrice,
    sellingPrice: salePrice,
    category: '기타',
    shippingFee: 0,
    adCost: 0,
  });

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">가격 · 재고 확인</h3>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm font-medium text-gray-700">판매가 (원)</label>
          <input
            type="number"
            value={salePrice}
            onChange={(e) => setSalePrice(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm font-medium text-gray-700">정가 (원)</label>
          <input
            type="number"
            value={originalPrice}
            onChange={(e) => setOriginalPrice(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      {salePrice > 0 && (
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <p className="text-gray-600">
            예상 마진:{' '}
            <span className="font-medium text-gray-900">
              {calc.netProfit.toLocaleString()}원
            </span>
          </p>
          <p className="text-gray-600">
            마진율:{' '}
            <span className="font-medium text-gray-900">
              {calc.marginRate.toFixed(1)}%
            </span>
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1 w-32">
        <label className="text-sm font-medium text-gray-700">재고 수량</label>
        <input
          type="number"
          value={stock}
          onChange={(e) => setStock(Number(e.target.value))}
          min={1}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-3 justify-end mt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          이전
        </button>
        <button
          onClick={() => onNext({ salePrice, originalPrice, stockQuantity: stock })}
          disabled={salePrice <= 0}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          다음
        </button>
      </div>
    </div>
  );
}
