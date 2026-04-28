'use client';

import { useState } from 'react';

export default function KeywordSuggestionForm() {
  const [skuCode, setSkuCode] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [mainKeywords, setMainKeywords] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ suggestedTitle: string; reasoning: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/winners/keyword-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skuCode,
          currentTitle,
          mainKeywords: mainKeywords.split(',').map((s) => s.trim()).filter(Boolean),
          categoryName: categoryName || null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? '제안 실패');
      } else {
        setResult({ suggestedTitle: data.suggestedTitle, reasoning: data.reasoning });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-3">
      <input
        value={skuCode}
        onChange={(e) => setSkuCode(e.target.value)}
        placeholder="SKU 코드"
        className="w-full rounded border border-gray-300 p-2 text-sm"
        required
      />
      <input
        value={currentTitle}
        onChange={(e) => setCurrentTitle(e.target.value)}
        placeholder="현재 상품명"
        className="w-full rounded border border-gray-300 p-2 text-sm"
        required
      />
      <input
        value={mainKeywords}
        onChange={(e) => setMainKeywords(e.target.value)}
        placeholder="메인 키워드 (쉼표 구분)"
        className="w-full rounded border border-gray-300 p-2 text-sm"
      />
      <input
        value={categoryName}
        onChange={(e) => setCategoryName(e.target.value)}
        placeholder="카테고리명 (선택)"
        className="w-full rounded border border-gray-300 p-2 text-sm"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? '제안 중…' : '키워드 재구성 제안'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="rounded border border-green-300 bg-green-50 p-4">
          <div className="text-sm font-semibold">제안된 상품명:</div>
          <div className="mt-1 font-medium">{result.suggestedTitle}</div>
          <div className="mt-2 text-sm text-gray-700">💡 {result.reasoning}</div>
        </div>
      )}
    </form>
  );
}
