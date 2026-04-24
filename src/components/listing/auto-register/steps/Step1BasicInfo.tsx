'use client';
import { useState } from 'react';

export interface BasicInfoValue {
  sellerProductName: string;
  displayCategoryCode: number;
  brand: string;
}

interface Props {
  initialValue: Partial<BasicInfoValue>;
  confidences?: Partial<Record<keyof BasicInfoValue, number>>;
  onNext: (value: BasicInfoValue) => void;
  onBack: () => void;
}

export function Step1BasicInfo({ initialValue, confidences, onNext, onBack }: Props) {
  const [name, setName] = useState(initialValue.sellerProductName ?? '');
  const [categoryCode, setCategoryCode] = useState(
    initialValue.displayCategoryCode ? String(initialValue.displayCategoryCode) : '',
  );
  const [brand, setBrand] = useState(initialValue.brand ?? '기타');

  function handleNext() {
    onNext({
      sellerProductName: name,
      displayCategoryCode: Number(categoryCode) || 0,
      brand,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">기본 정보 확인</h3>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          상품명
          {confidences?.sellerProductName !== undefined && (
            <span className="ml-2 text-xs text-gray-400">
              AI 신뢰도 {Math.round((confidences.sellerProductName ?? 0) * 100)}%
            </span>
          )}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          카테고리 코드
          {confidences?.displayCategoryCode !== undefined &&
            (confidences.displayCategoryCode ?? 0) < 0.5 && (
              <span className="ml-2 text-xs text-orange-500">AI 신뢰도 낮음 — 직접 확인 필요</span>
            )}
        </label>
        <input
          value={categoryCode}
          onChange={(e) => setCategoryCode(e.target.value)}
          placeholder="예: 56137"
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-400">쿠팡 카테고리 코드 (날개에서 확인 가능)</p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">브랜드</label>
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
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
          onClick={handleNext}
          disabled={!name || !categoryCode}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          다음
        </button>
      </div>
    </div>
  );
}
