'use client';
import { useState } from 'react';
import type { NormalizedProduct, MappedCoupangFields } from '@/lib/auto-register/types';

interface UrlInputStepProps {
  onComplete: (product: NormalizedProduct, fields: MappedCoupangFields | null) => void;
}

export function UrlInputStep({ onComplete }: UrlInputStepProps) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'fetching' | 'mapping' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setStatus('fetching');

    const parseRes = await fetch('/api/auto-register/parse-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!parseRes.ok) {
      const data = await parseRes.json().catch(() => ({})) as { error?: string };
      setErrorMsg(data.error ?? '상품 정보를 가져오지 못했습니다.');
      setStatus('error');
      return;
    }

    const { product } = (await parseRes.json()) as { product: NormalizedProduct };
    setStatus('mapping');

    const mapRes = await fetch('/api/auto-register/ai-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product }),
    });

    if (!mapRes.ok) {
      onComplete(product, null);
      return;
    }

    const { fields } = (await mapRes.json()) as { fields: MappedCoupangFields | null };
    onComplete(product, fields);
  }

  const isLoading = status === 'fetching' || status === 'mapping';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">상품 URL 입력</h2>
        <p className="text-sm text-gray-500 mt-1">
          도매꾹 또는 코스트코 코리아 상품 상세 페이지 URL을 입력하세요.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.domeggook.com/product/detail/..."
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />

        {errorMsg && (
          <p className="text-sm text-red-600">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={isLoading || !url}
          className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'fetching' && '상품 정보 불러오는 중...'}
          {status === 'mapping' && 'AI가 필드를 분석하는 중...'}
          {(status === 'idle' || status === 'error') && '분석 시작'}
        </button>
      </form>
    </div>
  );
}
