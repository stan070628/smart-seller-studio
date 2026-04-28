'use client';

import { buildSourcingUrl } from '@/lib/niche/sourcing-links';
import type { PrecheckResult } from './TrademarkPrecheckForm';

const STATUS_STYLE: Record<
  PrecheckResult['status'],
  { bg: string; border: string; label: string; emoji: string }
> = {
  safe:    { bg: 'bg-green-50',  border: 'border-green-300',  label: '발주 가능',     emoji: '✅' },
  warning: { bg: 'bg-yellow-50', border: 'border-yellow-300', label: '주의 (수동검토)', emoji: '⚠️' },
  blocked: { bg: 'bg-red-50',    border: 'border-red-400',    label: '발주 차단',     emoji: '🚫' },
};

export default function TrademarkPrecheckResultCard({ result }: { result: PrecheckResult }) {
  const s = STATUS_STYLE[result.status];
  const search1688Url = buildSourcingUrl('1688', result.brandCandidate ?? result.title);

  return (
    <div className={`rounded border p-4 ${s.bg} ${s.border}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold tracking-wide text-gray-500">
            {s.emoji} {s.label}
          </div>
          <div className="mt-1 font-medium">{result.title}</div>
          {result.brandCandidate && (
            <div className="mt-1 text-sm text-gray-600">
              검색 단어: <code className="rounded bg-white px-1">{result.brandCandidate}</code>
            </div>
          )}
        </div>

        {result.canProceed ? (
          <a
            href={search1688Url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
          >
            1688 검색 →
          </a>
        ) : (
          <button
            disabled
            className="cursor-not-allowed rounded bg-gray-300 px-3 py-2 text-sm font-medium text-gray-500"
            title="등록상표 충돌로 발주 차단됨"
          >
            1688 검색 차단
          </button>
        )}
      </div>

      {result.issue && (
        <div className="mt-3 rounded bg-white p-2 text-sm">
          <span className="font-medium">[{result.issue.code}]</span> {result.issue.message}
        </div>
      )}
    </div>
  );
}
