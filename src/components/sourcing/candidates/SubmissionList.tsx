'use client';

import { useEffect, useState } from 'react';
import { api } from '@/components/sourcing/candidates/api';
import type { ListingView } from '@/lib/sourcing-candidates/view';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const VERDICT = { same: '같음', diff: '차이', different: '다름' } as const;
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

/** "2,793건 (23%) · 4.88" 형태. 누적 대비 최근 비중이 100%를 넘으면 ⚠로 표시한다 */
function Recent6mCell({ l }: { l: ListingView }) {
  if (l.recent6m_review_count === null) return <>—</>;
  const sharePct = l.recent_share === null ? null : Math.round(l.recent_share * 100);
  return (
    <span className={sharePct !== null && sharePct > 100 ? 'text-red-400 print:text-red-600' : undefined}>
      {sharePct !== null && sharePct > 100 && '⚠ '}
      {l.recent6m_review_count.toLocaleString('ko-KR')}건
      {sharePct !== null && ` (${sharePct}%)`}
      {l.recent6m_rating !== null && ` · ${l.recent6m_rating}`}
    </span>
  );
}

/** 강사 상담에 들고 갈 표. 채택까지 끝난 ⭐ 후보만 싣는다 */
export default function SubmissionList() {
  const [rows, setRows] = useState<ListingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listings({ starred: true })
      .then((all) => setRows(all.filter((l) => l.adopted)))
      .catch((e) => setError(e instanceof Error ? e.message : '불러오기 실패'));
  }, []);

  if (error) return <div className="p-6 text-red-400 print:text-red-600">{error}</div>;
  if (!rows) return <div className="p-6 print:text-black">불러오는 중…</div>;

  return (
    // 화면은 어두운 AppShell 안이라 어두운 테마로 보이지만, 인쇄는 항상 종이용(흰 바탕·검은 글씨)이어야
    // 한다 — 아래 요소마다 print: 변형으로 화면용 색을 인쇄용 색으로 되돌린다.
    <main className="mx-auto max-w-6xl space-y-3 p-6 print:bg-white print:text-black">
      <div className="flex items-end justify-between print:hidden">
        <h1 className="text-xl font-bold">소싱 후보 제출 목록 ({rows.length}개)</h1>
        <button onClick={() => window.print()} className="rounded bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20">인쇄</button>
      </div>
      <p className="text-xs text-gray-400 print:text-gray-600">
        강의 공식: 위안×210×1.4 ÷ 판매가 ≤ 30% · 실측 공식: 로켓그로스 물류비 포함, ⓐ마진율 ≥ 30% ⓑ마진 ≥ 물류비×1.5
      </p>
      <table className="w-full border border-white/15 text-xs print:border-gray-400">
        <thead className="bg-white/5 print:bg-gray-50"><tr>
          {['#', '상품', '카테고리', '판매가', '리뷰', '최근 6개월', '1688', '위안', '강의 원가율', '실측 마진', '같은 물건', '메모'].map((h) =>
            <th key={h} className="border border-white/15 px-1 py-1 text-left print:border-gray-300">{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((l, i) => {
            const o = l.adopted!;
            return (
              <tr key={l.id}>
                <td className="border border-white/15 px-1 print:border-gray-300">{i + 1}</td>
                <td className="border border-white/15 px-1 print:border-gray-300">
                  {l.title}<div className="text-gray-400 print:text-gray-600">{l.seller}</div>
                </td>
                <td className="border border-white/15 px-1 print:border-gray-300">{l.category_path ?? '—'}</td>
                <td className="border border-white/15 px-1 text-right print:border-gray-300">{won(l.effective_price)}</td>
                <td className="border border-white/15 px-1 text-right print:border-gray-300">{l.review_count?.toLocaleString('ko-KR') ?? '—'}</td>
                <td className="border border-white/15 px-1 print:border-gray-300"><Recent6mCell l={l} /></td>
                <td className="border border-white/15 px-1 print:border-gray-300">
                  {o.url ? (
                    <>
                      <span className="print:hidden">
                        {isHttpUrl(o.url)
                          ? <a href={o.url} target="_blank" rel="noopener noreferrer" className="underline">링크</a>
                          : o.url}
                      </span>
                      <span className="hidden print:inline break-all">{o.url}</span>
                    </>
                  ) : '링크 없음'}
                </td>
                <td className="border border-white/15 px-1 text-right print:border-gray-300">{o.cny === null ? '—' : `¥${o.cny}`}</td>
                <td className="border border-white/15 px-1 print:border-gray-300">{o.lecture ? `${pct(o.lecture.costRatio)} ${o.lecture.pass ? '통과' : '탈락'}` : '—'}</td>
                <td className="border border-white/15 px-1 print:border-gray-300">{o.real ? `${won(o.real.margin)} · ${pct(o.real.marginRate)} ${o.real.pass ? '통과' : '탈락'}` : '—'}</td>
                <td className="border border-white/15 px-1 print:border-gray-300">{o.match_verdict ? VERDICT[o.match_verdict] : '—'}</td>
                <td className="border border-white/15 px-1 print:border-gray-300">{l.memo ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
