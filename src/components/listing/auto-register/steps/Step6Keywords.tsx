'use client';
import { useState } from 'react';

export interface KeywordsValue {
  searchTags: string[];
}

interface RegisterSummary {
  sellerProductName: string;
  displayCategoryCode: number;
  brand: string;
  salePrice: number;
  stockQuantity: number;
  thumbnailUrl: string;
  deliveryChargeType: string;
}

interface Props {
  initialValue: KeywordsValue;
  summary: RegisterSummary;
  isRegistering: boolean;
  registerError: string;
  onNext: (value: KeywordsValue) => void;
  onBack: () => void;
}

export function Step6Keywords({ initialValue, summary, isRegistering, registerError, onNext, onBack }: Props) {
  const [tags, setTags] = useState(initialValue.searchTags);
  const [inputTag, setInputTag] = useState('');

  function addTag() {
    const trimmed = inputTag.trim();
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags([...tags, trimmed]);
      setInputTag('');
    }
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-semibold text-gray-900">검색 태그 · 최종 확인</h3>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">검색 태그 (최대 10개)</label>
        <div className="flex gap-2">
          <input
            value={inputTag}
            onChange={(e) => setInputTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="태그 입력 후 Enter"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button onClick={addTag} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            추가
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">
              {tag}
              <button onClick={() => removeTag(tag)} className="text-blue-400 hover:text-blue-700">×</button>
            </span>
          ))}
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 text-sm flex flex-col gap-2">
        <p className="font-medium text-gray-700">등록 요약</p>
        <div className="grid grid-cols-2 gap-1 text-gray-600">
          <span>상품명</span><span className="font-medium text-gray-900 truncate">{summary.sellerProductName}</span>
          <span>카테고리 코드</span><span>{summary.displayCategoryCode}</span>
          <span>브랜드</span><span>{summary.brand}</span>
          <span>판매가</span><span>{summary.salePrice.toLocaleString()}원</span>
          <span>재고</span><span>{summary.stockQuantity}개</span>
          <span>배송비</span><span>{summary.deliveryChargeType === 'FREE' ? '무료' : '유료'}</span>
        </div>
      </div>

      {registerError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{registerError}</p>
      )}

      <div className="flex gap-3 justify-end mt-2">
        <button onClick={onBack} disabled={isRegistering} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
          이전
        </button>
        <button
          onClick={() => onNext({ searchTags: tags })}
          disabled={isRegistering}
          className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {isRegistering ? '등록 중...' : '쿠팡에 등록하기'}
        </button>
      </div>
    </div>
  );
}
