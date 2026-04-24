'use client';
import { useState } from 'react';

export interface DetailPageValue {
  detailHtml: string;
}

interface Props {
  initialValue: DetailPageValue;
  onNext: (value: DetailPageValue) => void;
  onBack: () => void;
}

// generate-detail-html route는 { images, productName, price } 스키마로
// currentHtml/instruction 기반 편집을 지원하지 않음.
// Step4는 생성된 HTML을 수동 확인·편집하는 단계로 구성.
export function Step4DetailPage({ initialValue, onNext, onBack }: Props) {
  const [html, setHtml] = useState(initialValue.detailHtml);
  const [isPreview, setIsPreview] = useState(true);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">상세페이지 확인 · 편집</h3>
        <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
          <button
            onClick={() => setIsPreview(true)}
            className={`px-3 py-1.5 ${isPreview ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            미리보기
          </button>
          <button
            onClick={() => setIsPreview(false)}
            className={`px-3 py-1.5 ${!isPreview ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            HTML 편집
          </button>
        </div>
      </div>

      {isPreview ? (
        // HTML 미리보기
        <div
          className="border border-gray-200 rounded-lg p-4 max-h-72 overflow-y-auto text-sm"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        // 원시 HTML 직접 편집
        <textarea
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          rows={12}
          className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
          spellCheck={false}
        />
      )}

      {!html && (
        <p className="text-sm text-gray-400">상세페이지 HTML이 없습니다. 이전 단계에서 이미지를 등록하면 자동 생성됩니다.</p>
      )}

      <div className="flex gap-3 justify-end mt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          이전
        </button>
        <button
          onClick={() => onNext({ detailHtml: html })}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          다음
        </button>
      </div>
    </div>
  );
}
