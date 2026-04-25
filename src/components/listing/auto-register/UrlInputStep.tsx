'use client';
import { useState } from 'react';
import type { NormalizedProduct, MappedCoupangFields } from '@/lib/auto-register/types';

interface UrlInputStepProps {
  onComplete: (product: NormalizedProduct, fields: MappedCoupangFields | null) => void;
}

type Status = 'idle' | 'fetching' | 'mapping' | 'error';

type StepState = 'pending' | 'running' | 'done';

function StepRow({ label, sub, state }: { label: string; sub: string; state: StepState }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex-shrink-0">
        {state === 'done' && (
          <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}
        {state === 'running' && (
          <div className="w-5 h-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
        )}
        {state === 'pending' && (
          <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
        )}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-medium leading-tight ${state === 'pending' ? 'text-gray-400' : 'text-gray-900'}`}>
          {label}
        </p>
        <p className={`text-xs mt-0.5 leading-tight ${state === 'pending' ? 'text-gray-300' : state === 'running' ? 'text-blue-500' : 'text-gray-400'}`}>
          {sub}
        </p>
      </div>
    </div>
  );
}

export function UrlInputStep({ onComplete }: UrlInputStepProps) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
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

  const fetchState: StepState = status === 'fetching' ? 'running' : status === 'mapping' ? 'done' : 'pending';
  const mapState: StepState = status === 'mapping' ? 'running' : 'pending';

  const progressPct = status === 'fetching' ? 35 : status === 'mapping' ? 70 : 0;

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
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />

        {errorMsg && (
          <p className="text-sm text-red-600">{errorMsg}</p>
        )}

        {isLoading ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 flex flex-col gap-4">
            {/* 진행 바 */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-gray-500">분석 진행 중</span>
                <span className="text-xs text-gray-400">{progressPct}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* 단계 목록 */}
            <div className="flex flex-col gap-3">
              <StepRow
                label="상품 정보 수집"
                sub={fetchState === 'running' ? '도매꾹 / 코스트코에서 데이터를 가져오는 중...' : '완료'}
                state={fetchState}
              />
              <StepRow
                label="AI 필드 자동 매핑"
                sub={mapState === 'running' ? '쿠팡 등록 항목에 맞게 분석하는 중...' : '대기 중'}
                state={mapState}
              />
              <StepRow
                label="고시정보 생성"
                sub="카테고리 확정 후 자동 생성"
                state="pending"
              />
            </div>
          </div>
        ) : (
          <button
            type="submit"
            disabled={!url}
            className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            분석 시작
          </button>
        )}
      </form>
    </div>
  );
}
