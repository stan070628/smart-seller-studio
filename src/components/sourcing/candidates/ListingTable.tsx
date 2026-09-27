'use client';

import { useRef, useState } from 'react';
import type { ListingView } from '@/lib/sourcing-candidates/view';
import type { FilterFlag } from '@/lib/sourcing-candidates/filters';

const FLAG_LABEL: Record<FilterFlag, { text: string; cls: string }> = {
  below_floor: { text: '하한선 미만', cls: 'bg-red-100 text-red-700' },
  official: { text: '공식', cls: 'bg-amber-100 text-amber-800' },
  electric: { text: '인증 확인', cls: 'bg-amber-100 text-amber-800' },
  strong: { text: '리뷰 1만+', cls: 'bg-amber-100 text-amber-800' },
};

const won = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('ko-KR')}원`);

interface Props {
  rows: ListingView[];
  onPatch: (id: string, data: Record<string, unknown>) => Promise<void>;
}

function Row({ r, onPatch }: { r: ListingView; onPatch: Props['onPatch'] }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(r.effective_price));
  /** Escape로 취소했을 때 곧이어 오는 blur 커밋을 건너뛰기 위한 플래그 */
  const skipBlurRef = useRef(false);

  const startEdit = () => {
    // Escape로 취소했을 때 input이 DOM에서 사라지며 blur가 안 붙는 브라우저가 있다 —
    // 그러면 플래그가 true로 남아 다음 편집의 정상 커밋까지 건너뛴다. 편집을 열 때마다 초기화한다.
    skipBlurRef.current = false;
    setPrice(String(r.effective_price));
    setEditing(true);
  };
  /** 입력칸을 비우면 사람이 고친 값을 지운다 — AI 판매가로 되돌아간다 */
  const commitPrice = () => {
    setEditing(false);
    if (price.trim() === '') {
      if (r.price_override !== null) void onPatch(r.id, { price_override: null });
      return;
    }
    const n = Number(price.replace(/[^\d]/g, ''));
    if (n > 0 && n !== r.effective_price) void onPatch(r.id, { price_override: n });
  };
  const cancelPrice = () => {
    skipBlurRef.current = true;
    setPrice(String(r.effective_price));
    setEditing(false);
  };

  return (
    <tr className={`border-t border-white/10 ${r.excluded ? 'text-gray-400' : ''}`}>
      <td className="px-2 py-1 text-right">{r.rank}</td>
      <td className="px-2 py-1">
        <button aria-pressed={r.starred} aria-label={r.starred ? '후보에서 내리기' : '후보로 올리기'}
          onClick={() => void onPatch(r.id, { starred: !r.starred })}
          className={r.starred ? 'text-yellow-400' : 'text-white/25 hover:text-yellow-400/70'}>★</button>
      </td>
      <td className="max-w-md px-2 py-1">
        <div className="truncate" title={r.title}>{r.title}</div>
        <div className="text-xs text-gray-400">{r.seller}{r.badges.length ? ` · ${r.badges.join('·')}` : ''}</div>
      </td>
      <td className="px-2 py-1 text-right">
        {editing ? (
          <input autoFocus value={price} onChange={(e) => setPrice(e.target.value)}
            className="w-24 border border-white/15 bg-transparent px-1 text-right text-white"
            onBlur={() => {
              if (skipBlurRef.current) { skipBlurRef.current = false; return; }
              commitPrice();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') cancelPrice();
            }} />
        ) : (
          <button onClick={startEdit} title="클릭해서 고치기 (쿠팡 판매가로 바꿔 보세요)">
            {won(r.effective_price)}{r.price_override !== null && <span className="text-blue-400">*</span>}
          </button>
        )}
        {r.number_check && <div className="text-xs text-red-400">⚠ {r.number_check}</div>}
      </td>
      <td className="px-2 py-1 text-right">{r.review_count?.toLocaleString('ko-KR') ?? '—'}</td>
      <td className="px-2 py-1 text-right">{r.rating ?? '—'}</td>
      <td className="px-2 py-1">
        <div className="flex flex-wrap gap-1">
          {r.flags.map((f) => <span key={f} className={`rounded px-1 text-xs ${FLAG_LABEL[f].cls}`}>{FLAG_LABEL[f].text}</span>)}
        </div>
      </td>
      <td className="px-2 py-1 text-xs">
        <button className="underline" onClick={() => void onPatch(r.id, { excluded_override: !r.excluded })}>
          {r.excluded ? '되살리기' : '제외'}
        </button>
      </td>
    </tr>
  );
}

/** 제외된 줄은 숨기지 않고 접어 둔다 — 거름망이 틀렸을 때 되살릴 수 있어야 한다 */
export default function ListingTable({ rows, onPatch }: Props) {
  const [showExcluded, setShowExcluded] = useState(false);
  const kept = rows.filter((r) => !r.excluded);
  const excluded = rows.filter((r) => r.excluded);
  const head = (
    <thead className="bg-white/5 text-left text-xs text-gray-400">
      <tr><th className="px-2 py-1 text-right">순위</th><th /><th className="px-2 py-1">상품 · 판매자</th>
        <th className="px-2 py-1 text-right">판매가</th><th className="px-2 py-1 text-right">리뷰</th>
        <th className="px-2 py-1 text-right">별점</th><th className="px-2 py-1">거름망</th><th /></tr>
    </thead>
  );
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">{head}<tbody>{kept.map((r) => <Row key={r.id} r={r} onPatch={onPatch} />)}</tbody></table>
      {excluded.length > 0 && (
        <div>
          <button className="text-sm text-gray-400 underline" onClick={() => setShowExcluded((v) => !v)}>
            자동 제외 {excluded.length}건 {showExcluded ? '접기' : '펼치기'}
            {' '}(하한선 {won(excluded[0].floor)} 미만{excluded.some((r) => r.excluded_override === true) ? '·수동 제외 포함' : ''})
          </button>
          {showExcluded && (
            <table className="mt-1 w-full text-sm">{head}<tbody>{excluded.map((r) => <Row key={r.id} r={r} onPatch={onPatch} />)}</tbody></table>
          )}
        </div>
      )}
    </div>
  );
}
