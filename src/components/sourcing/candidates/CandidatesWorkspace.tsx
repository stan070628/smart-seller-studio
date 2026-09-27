'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ScanUploader from '@/components/sourcing/candidates/ScanUploader';
import ListingTable from '@/components/sourcing/candidates/ListingTable';
import CandidateCard from '@/components/sourcing/candidates/CandidateCard';
import { api, type ScanSummary } from '@/components/sourcing/candidates/api';
import type { ListingView } from '@/lib/sourcing-candidates/view';

export default function CandidatesWorkspace() {
  const [tab, setTab] = useState<'scan' | 'candidates'>('scan');
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [rows, setRows] = useState<ListingView[]>([]);
  const [starred, setStarred] = useState<ListingView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setScans(await api.listScans());
      if (scanId) setRows(await api.listings({ scan: scanId }));
      setStarred(await api.listings({ starred: true }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    }
  }, [scanId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 진입 시 스캔·후보 목록을 불러온다
  useEffect(() => { void refresh(); }, [refresh]);

  const current = scans.find((s) => s.id === scanId);
  const adoptedCount = starred.filter((l) => l.adopted).length;

  return (
    <main className="container mx-auto space-y-4 px-4 py-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">소싱 후보 수집</h1>
          <p className="text-sm text-gray-600">네이버 쇼핑 카테고리(판매 많은순) 캡처 → 후보 ⭐ → 1688 매칭 → 20개 제출</p>
        </div>
        <Link href="/sourcing/candidates/print" className="rounded bg-gray-900 px-3 py-2 text-sm text-white">
          제출 목록 ({adoptedCount}/20)
        </Link>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex gap-2 border-b text-sm">
        {(['scan', 'candidates'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 ${tab === t ? 'border-b-2 border-gray-900 font-medium' : 'text-gray-500'}`}>
            {t === 'scan' ? '1. 캡처·후보 표' : `2. 후보 카드 (${starred.length})`}
          </button>
        ))}
      </div>

      {tab === 'scan' && (
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <aside className="space-y-2">
            <ScanUploader listenPaste label="네이버 캡처 올리기"
              hint="전체 페이지 캡처 1장 또는 여러 장 · 끌어놓기·선택·Ctrl+V"
              onFiles={async (files) => {
                const { id } = await api.uploadScan(files);
                setScanId(id);
                const r = await api.parseScan(id);
                await refresh();
                return `상품 약 ${r.listing_count}개 인식${r.partial_error ? ` · ${r.partial_error}` : ' — 더 필요하면 스크롤해서 추가 캡처'}`;
              }} />
            <ul className="space-y-1 text-sm">
              {scans.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setScanId(s.id)}
                    className={`w-full rounded px-2 py-1 text-left ${s.id === scanId ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                    <div className="truncate">{s.category_path ?? '(카테고리 미상)'}</div>
                    <div className="text-xs text-gray-500">
                      {s.sort_label ?? '정렬 미상'} · {s.listing_count}개 · ⭐{s.starred_count}
                      {s.parse_status === 'failed' && <span className="text-red-600"> · 실패</span>}
                    </div>
                  </button>
                  {s.parse_status === 'failed' && s.id === scanId && (
                    <button className="px-2 text-xs underline" onClick={async () => {
                      await api.parseScan(s.id).catch((e) => setError(e.message)); await refresh();
                    }}>판독 재시도</button>
                  )}
                </li>
              ))}
            </ul>
          </aside>
          <section>
            {current?.parse_error && <div className="mb-2 text-sm text-amber-700">{current.parse_error}</div>}
            {scanId
              ? <ListingTable rows={rows} onPatch={async (id, data) => { await api.patchListing(id, data); await refresh(); }} />
              : <div className="text-sm text-gray-500">왼쪽에서 캡처를 올리거나 스캔을 고르세요.</div>}
          </section>
        </div>
      )}

      {tab === 'candidates' && (
        <div className="space-y-3">
          {starred.length === 0 && <div className="text-sm text-gray-500">후보 표에서 ★를 눌러 후보를 올리세요.</div>}
          {starred.map((l) => <CandidateCard key={l.id} l={l} onChanged={refresh} />)}
        </div>
      )}
    </main>
  );
}
