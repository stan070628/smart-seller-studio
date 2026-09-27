'use client';

import { useState } from 'react';
import ScanUploader from '@/components/sourcing/candidates/ScanUploader';
import { api } from '@/components/sourcing/candidates/api';
import type { ListingView, OfferView } from '@/lib/sourcing-candidates/view';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const VERDICT = { same: '✅ 같음', diff: '⚠️ 차이', different: '❌ 다름' } as const;

function Judgement({ o }: { o: OfferView }) {
  if (!o.lecture || !o.real) return <span className="text-gray-400">원가 없음</span>;
  return (
    <div className="space-y-0.5 text-xs">
      <div>강의: 원가율 {pct(o.lecture.costRatio)} {o.lecture.best ? '🟢 최선' : o.lecture.pass ? '✅' : '❌'} (≤30%)</div>
      <div>실측: 마진 {won(o.real.margin)} · {pct(o.real.marginRate)} {o.real.passRate ? 'ⓐ✅' : 'ⓐ❌'} {o.real.passAmount ? 'ⓑ✅' : 'ⓑ❌'}</div>
      {o.daily !== null && <div className="text-gray-500">일 판매 {o.daily.toFixed(1)}개 (누적÷180, 참고)</div>}
    </div>
  );
}

function OfferRowView({ o, onChanged }: { o: OfferView; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState(o.url ?? '');
  const [cny, setCny] = useState(o.cny_override === null ? '' : String(o.cny_override));
  const save = async (data: Record<string, unknown>) => { await api.patchOffer(o.id, data); await onChanged(); };
  return (
    <tr className={`border-t align-top ${o.adopted ? 'bg-green-50' : ''}`}>
      <td className="px-2 py-1 text-xs">
        {o.parse_status === 'failed' ? (
          <span className="text-red-600">판독 실패: {o.parse_error}{' '}
            <button className="underline" onClick={async () => { await api.reparseOffer(o.id).catch(() => {}); await onChanged(); }}>재시도</button>
          </span>
        ) : (
          <>
            <div>{o.match_verdict ? VERDICT[o.match_verdict] : '—'} {o.match_reason}</div>
            <div className="text-gray-500">{o.title_cn}</div>
          </>
        )}
      </td>
      <td className="px-2 py-1 text-xs">
        {(o.tiers ?? []).map((t) => <div key={t.min_qty}>{t.min_qty}+ {o.sale_unit ?? ''} ¥{t.cny}</div>)}
        {o.tier_check && <div className="text-red-600">⚠ {o.tier_check}</div>}
        <input placeholder="위안 직접" value={cny} onChange={(e) => setCny(e.target.value)}
          onBlur={() => save({ cny_override: cny ? Number(cny) : null })} className="mt-1 w-20 border px-1" />
      </td>
      <td className="px-2 py-1"><Judgement o={o} /></td>
      <td className="px-2 py-1 text-xs">
        <input placeholder="1688 URL" value={url} onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== (o.url ?? '') && save({ url: url || null })} className="w-40 border px-1" />
        <div className="mt-1">
          {o.adopted ? <span className="font-medium text-green-700">채택됨</span>
            : <button className="underline" onClick={() => save({ adopted: true })}>채택</button>}
        </div>
      </td>
    </tr>
  );
}

/** ⭐ 후보 하나. 1688 캡처는 이 카드에 넣는다 — 짝은 사람이 정하고 AI는 같은 물건인지만 본다 */
export default function CandidateCard({ l, onChanged }: { l: ListingView; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState('');
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{l.title}</div>
          <div className="text-xs text-gray-500">
            {l.category_path ?? '카테고리 미상'} · {l.seller} · {l.effective_price.toLocaleString('ko-KR')}원 · 리뷰 {l.review_count?.toLocaleString('ko-KR') ?? '—'}
          </div>
        </div>
        <select value={l.size} onChange={async (e) => { await api.patchListing(l.id, { size: e.target.value }); await onChanged(); }}
          className="border text-xs">
          <option value="xsmall">극소형</option><option value="small">소형</option><option value="medium">중형</option>
        </select>
      </div>

      {l.offers.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-gray-500"><tr>
            <th className="px-2">같은 물건?</th><th className="px-2">구간가</th><th className="px-2">판정</th><th className="px-2" />
          </tr></thead>
          <tbody>{l.offers.map((o) => <OfferRowView key={o.id} o={o} onChanged={onChanged} />)}</tbody>
        </table>
      )}

      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
        <ScanUploader label="1688 캡처 추가 (업체 1곳)" hint="가격·판매량 화면을 한 번에 올리면 한 업체로 묶입니다"
          onFiles={async (files) => {
            const r = await api.addOffer(l.id, files, url);
            setUrl('');
            await onChanged();
            return r.parse_error ? `판독 실패: ${r.parse_error}` : '판독 완료';
          }} />
        <input placeholder="1688 URL (선택)" value={url} onChange={(e) => setUrl(e.target.value)} className="h-9 border px-2 text-sm" />
      </div>
    </div>
  );
}
