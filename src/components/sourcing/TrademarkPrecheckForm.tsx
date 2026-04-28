'use client';

import { useState } from 'react';
import TrademarkPrecheckResultCard from './TrademarkPrecheckResultCard';

export interface PrecheckResult {
  title: string;
  status: 'safe' | 'warning' | 'blocked';
  canProceed: boolean;
  brandCandidate: string | null;
  issue: {
    severity: 'RED' | 'YELLOW' | 'GREEN';
    code: string;
    message: string;
  } | null;
}

export default function TrademarkPrecheckForm() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PrecheckResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResults([]);

    const titles = input
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (titles.length === 0) {
      setError('상품명을 한 줄에 하나씩 입력하세요.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/sourcing/trademark-precheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titles }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? '사전체크 실패');
      } else {
        setResults(data.results);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  const blockedCount = results.filter((r) => r.status === 'blocked').length;

  return (
    <div className="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-sm font-medium">
          상품명 (한 줄에 하나, 최대 50개)
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={8}
          className="w-full rounded border border-gray-300 p-3 font-mono text-sm"
          placeholder={'스테인리스 텀블러 500ml\n캠핑 코펠 4인용\n...'}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? '검사 중…' : '1688 발주 사전체크'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {results.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="text-sm text-gray-600">
            총 {results.length}건 검사 — 차단 {blockedCount}건 / 통과 {results.length - blockedCount}건
          </div>
          {results.map((r, i) => (
            <TrademarkPrecheckResultCard key={`${i}-${r.title}`} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}
