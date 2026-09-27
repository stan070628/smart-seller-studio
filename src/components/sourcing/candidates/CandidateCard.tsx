'use client';

import { useState } from 'react';
import ScanUploader from '@/components/sourcing/candidates/ScanUploader';
import { api } from '@/components/sourcing/candidates/api';
import type { ListingView, OfferView } from '@/lib/sourcing-candidates/view';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const VERDICT = { same: '✅ 같음', diff: '⚠️ 차이', different: '❌ 다름' } as const;

/**
 * 판정 표시. match_verdict가 판정 신뢰도를 가른다 — 다른 물건이면 원가율·마진이
 * 아무리 좋아도 그 숫자는 이 후보와 무관하다. 통과✅·최선🟢 표시를 지우고
 * "참고용"으로 낮춰, 다른 물건인데 초록불이 켜져 보이는 일이 없게 한다.
 */
function Judgement({ o }: { o: OfferView }) {
  if (!o.lecture || !o.real) return <span className="text-gray-400">원가 없음</span>;

  if (o.match_verdict === 'different') {
    return (
      <div className="space-y-0.5 text-xs">
        <div className="text-white/50">다른 물건 — 참고용</div>
        <div className="text-white/30 line-through decoration-white/20">강의: 원가율 {pct(o.lecture.costRatio)} (≤30%)</div>
        <div className="text-white/30 line-through decoration-white/20">실측: 마진 {won(o.real.margin)} · {pct(o.real.marginRate)}</div>
        {o.daily !== null && <div className="text-gray-500">일 판매 {o.daily.toFixed(1)}개 (누적÷180, 참고)</div>}
      </div>
    );
  }

  return (
    <div className="space-y-0.5 text-xs">
      {o.match_verdict === 'diff' && <div className="text-amber-400">⚠ 조건 다름 —</div>}
      <div>강의: 원가율 {pct(o.lecture.costRatio)} {o.lecture.best ? '🟢 최선' : o.lecture.pass ? '✅' : '❌'} (≤30%)</div>
      <div>실측: 마진 {won(o.real.margin)} · {pct(o.real.marginRate)} {o.real.passRate ? 'ⓐ✅' : 'ⓐ❌'} {o.real.passAmount ? 'ⓑ✅' : 'ⓑ❌'}</div>
      {o.daily !== null && <div className="text-gray-400">일 판매 {o.daily.toFixed(1)}개 (누적÷180, 참고)</div>}
    </div>
  );
}

interface RunFn {
  (fn: () => Promise<void>): Promise<void>;
}

function OfferRowView({ o, onChanged, run }: { o: OfferView; onChanged: () => Promise<void>; run: RunFn }) {
  const [url, setUrl] = useState(o.url ?? '');
  const [cny, setCny] = useState(o.cny_override === null ? '' : String(o.cny_override));
  const save = (data: Record<string, unknown>) => run(async () => { await api.patchOffer(o.id, data); await onChanged(); });

  /**
   * 위안 직접입력 — 숫자가 아니면 저장하지 않고 카드 상단에 알린다. 값이 그대로면 PATCH를 건너뛴다 (I3)
   * "지운다"로 볼 때는 입력칸 자체가 빈 문자열일 때뿐이다 — "abc"처럼 숫자·점을 걷어내면
   * 빈 문자열이 되는 값을 지우기로 오인하면 오타를 조용히 null로 저장해 버린다.
   */
  const commitCny = () => run(async () => {
    if (cny.trim() === '') {
      if (o.cny_override === null) return;
      await api.patchOffer(o.id, { cny_override: null });
      await onChanged();
      return;
    }
    const cleaned = cny.replace(/[^\d.]/g, '');
    const n = cleaned === '' ? NaN : Number(cleaned);
    if (!(n > 0)) throw new Error('위안은 숫자로 입력하세요');
    if (n === o.cny_override) return;
    await api.patchOffer(o.id, { cny_override: n });
    await onChanged();
  });

  const adoptDisabled = o.cny === null || o.parse_status === 'failed';
  const adoptTitle = o.parse_status === 'failed'
    ? '판독 실패라 채택할 수 없습니다'
    : o.cny === null ? '위안 원가가 없어 채택할 수 없습니다' : undefined;

  return (
    <tr className={`border-t border-white/10 align-top ${o.adopted ? 'bg-green-500/10' : ''}`}>
      <td className="px-2 py-1 text-xs">
        {o.parse_status === 'failed' ? (
          <span className="text-red-400">판독 실패: {o.parse_error}{' '}
            <button className="underline" onClick={() => void run(async () => { await api.reparseOffer(o.id); await onChanged(); })}>재시도</button>
          </span>
        ) : (
          <>
            <div>{o.match_verdict ? VERDICT[o.match_verdict] : '—'} {o.match_reason}</div>
            <div className="text-gray-400">{o.title_cn}</div>
          </>
        )}
      </td>
      <td className="px-2 py-1 text-xs">
        {(o.tiers ?? []).map((t) => <div key={t.min_qty}>{t.min_qty}+ {o.sale_unit ?? ''} ¥{t.cny}</div>)}
        {o.tier_check && <div className="text-red-400">⚠ {o.tier_check}</div>}
        {(o.options ?? []).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {(o.options ?? []).map((opt) => opt.cny === null ? (
              <span key={opt.name} title="가격 미상" className="rounded border border-white/10 px-1 text-white/30">
                {opt.name}
              </span>
            ) : (
              <button key={opt.name} type="button"
                title="이 옵션가로 채택 원가를 바꿉니다"
                onClick={() => { setCny(String(opt.cny)); void save({ cny_override: opt.cny }); }}
                className={`rounded border px-1 ${o.cny === opt.cny
                  ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                  : 'border-white/15 text-white/70 hover:border-white/30'}`}>
                {opt.name} ¥{opt.cny}
              </button>
            ))}
          </div>
        )}
        {o.sold_count !== null && <div className="mt-1 text-gray-400">판매 {o.sold_count.toLocaleString('ko-KR')}</div>}
        <input placeholder="위안 직접" value={cny} onChange={(e) => setCny(e.target.value)}
          onBlur={() => void commitCny()} className="mt-1 w-20 border border-white/15 bg-transparent px-1 text-white" />
      </td>
      <td className="px-2 py-1"><Judgement o={o} /></td>
      <td className="px-2 py-1 text-xs">
        <input placeholder="1688 URL" value={url} onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== (o.url ?? '') && void save({ url: url || null })}
          className="w-40 border border-white/15 bg-transparent px-1 text-white" />
        <div className="mt-1">
          {o.adopted ? (
            <button className="underline text-gray-400" onClick={() => void save({ adopted: false })}>채택 취소</button>
          ) : (
            <button className="underline disabled:cursor-not-allowed disabled:text-white/25 disabled:no-underline"
              disabled={adoptDisabled} title={adoptTitle}
              onClick={() => {
                if (o.match_verdict === 'different' && !window.confirm('AI가 다른 물건이라고 판정했습니다. 그래도 채택하시겠습니까?')) return;
                void save({ adopted: true });
              }}>채택</button>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * 최근 6개월 리뷰 — 네이버 상세 페이지 별점 옆 ⓘ에서 사람이 옮겨 적는다.
 * 누적 리뷰는 한때 잘 팔리다 식은 상품을 강자로 오판하게 한다 — 지금 팔리는 속도를 보려는 값이다.
 * ⭐ 후보 카드에만 있고 후보 표에는 없다(20개 안팎이라 사람이 직접 캡처를 보고 적는다).
 */
function Recent6mFields({ l, run, onChanged }: { l: ListingView; run: RunFn; onChanged: () => Promise<void> }) {
  const [count, setCount] = useState(l.recent6m_review_count === null ? '' : String(l.recent6m_review_count));
  const [rating, setRating] = useState(l.recent6m_rating === null ? '' : String(l.recent6m_rating));

  /** 입력칸이 비어야 "지운다"다 — 숫자를 걷어내고 빈 문자열이 된 오타는 에러로 알린다 */
  const commitCount = () => run(async () => {
    if (count.trim() === '') {
      if (l.recent6m_review_count === null) return;
      await api.patchListing(l.id, { recent6m_review_count: null });
      await onChanged();
      return;
    }
    const cleaned = count.replace(/[^\d]/g, '');
    const n = cleaned === '' ? NaN : Number(cleaned);
    if (!Number.isInteger(n) || n < 0) throw new Error('최근 6개월 리뷰는 0 이상 정수로 입력하세요');
    if (n === l.recent6m_review_count) return;
    await api.patchListing(l.id, { recent6m_review_count: n });
    await onChanged();
  });

  const commitRating = () => run(async () => {
    if (rating.trim() === '') {
      if (l.recent6m_rating === null) return;
      await api.patchListing(l.id, { recent6m_rating: null });
      await onChanged();
      return;
    }
    const cleaned = rating.replace(/[^\d.]/g, '');
    const n = cleaned === '' ? NaN : Number(cleaned);
    if (Number.isNaN(n) || n < 0 || n > 5) throw new Error('6개월 별점은 0~5 사이로 입력하세요');
    if (n === l.recent6m_rating) return;
    await api.patchListing(l.id, { recent6m_rating: n });
    await onChanged();
  });

  const sharePct = l.recent_share === null ? null : Math.round(l.recent_share * 100);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
      <label className="flex items-center gap-1">
        최근 6개월 리뷰
        <input value={count} onChange={(e) => setCount(e.target.value)} onBlur={() => void commitCount()}
          placeholder="건" className="w-16 border border-white/15 bg-transparent px-1 text-white" />
      </label>
      <label className="flex items-center gap-1">
        6개월 별점
        <input value={rating} onChange={(e) => setRating(e.target.value)} onBlur={() => void commitRating()}
          placeholder="점" className="w-12 border border-white/15 bg-transparent px-1 text-white" />
      </label>
      <span className="text-gray-400">상세 페이지 별점 옆 ⓘ</span>
      {sharePct !== null && (
        <span className={sharePct > 100 ? 'text-red-400' : ''}>
          {sharePct > 100 && '⚠ '}최근 비중 {sharePct}%
        </span>
      )}
    </div>
  );
}

/** ⭐ 후보 하나. 1688 캡처는 이 카드에 넣는다 — 짝은 사람이 정하고 AI는 같은 물건인지만 본다 */
export default function CandidateCard({ l, onChanged }: { l: ListingView; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** 저장·재시도·크기 변경을 한 통로로 모아 실패를 조용히 삼키지 않는다 */
  const run: RunFn = async (fn) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    }
  };

  return (
    <div className="rounded-lg border border-white/15 p-3">
      {error && <div className="mb-2 text-sm text-red-400">{error}</div>}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{l.title}</div>
          <div className="text-xs text-gray-400">
            {l.category_path ?? '카테고리 미상'} · {l.seller} · {l.effective_price.toLocaleString('ko-KR')}원 · 리뷰 {l.review_count?.toLocaleString('ko-KR') ?? '—'}
          </div>
        </div>
        <select value={l.size} onChange={(e) => { const size = e.target.value; void run(async () => { await api.patchListing(l.id, { size }); await onChanged(); }); }}
          className="border border-white/15 bg-transparent px-1 text-xs text-white">
          <option value="xsmall" className="bg-black">극소형</option>
          <option value="small" className="bg-black">소형</option>
          <option value="medium" className="bg-black">중형</option>
        </select>
      </div>

      <Recent6mFields l={l} run={run} onChanged={onChanged} />

      {l.offers.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-gray-400"><tr>
            <th className="px-2">같은 물건?</th><th className="px-2">구간가</th><th className="px-2">판정</th><th className="px-2" />
          </tr></thead>
          <tbody>{l.offers.map((o) => <OfferRowView key={o.id} o={o} onChanged={onChanged} run={run} />)}</tbody>
        </table>
      )}

      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
        <ScanUploader label="1688 캡처 추가 (업체 1곳)" hint="가격·판매량 화면을 한 번에 올리면 한 업체로 묶입니다"
          onFiles={async (files) => {
            const r = await api.addOffer(l.id, files, url);
            setUrl('');
            await onChanged();
            if (r.parse_error) throw new Error(`판독 실패: ${r.parse_error}`);
            return '판독 완료';
          }} />
        <input placeholder="1688 URL (선택)" value={url} onChange={(e) => setUrl(e.target.value)}
          className="h-9 border border-white/15 bg-transparent px-2 text-sm text-white" />
      </div>
    </div>
  );
}
