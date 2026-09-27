'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ScanUploader from '@/components/sourcing/candidates/ScanUploader';
import ListingTable from '@/components/sourcing/candidates/ListingTable';
import CandidateCard from '@/components/sourcing/candidates/CandidateCard';
import { api, type ScanSummary } from '@/components/sourcing/candidates/api';
import type { ListingView } from '@/lib/sourcing-candidates/view';

/** 판독 3회 실패하면 재시도 버튼을 접고 재업로드를 안내한다 */
const PARSE_RETRY_LIMIT = 3;
/** 'parsing' 상태가 이보다 오래 머물면 응답 없음으로 보고 재시도를 다시 보여준다 */
const PARSING_STALE_MS = 10 * 60 * 1000;
/** 판독 중일 때 "n분 경과"·재시도 버튼이 스스로 갱신되도록 도는 주기 */
const PARSING_POLL_MS = 30 * 1000;

function minutesAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

/** 스캔 목록 한 줄. 재시도 버튼의 busy 상태는 여기 로컬로 둔다 — 다른 줄과 섞이면 안 된다 */
function ScanListItem({
  s, active, onSelect, onRetry,
}: {
  s: ScanSummary;
  active: boolean;
  onSelect: () => void;
  onRetry: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const attempts = s.parse_attempts ?? 0;
  const stale = s.parse_status === 'parsing' && s.parse_started_at !== null
    && Date.now() - new Date(s.parse_started_at).getTime() > PARSING_STALE_MS;
  const failedLike = s.parse_status === 'failed' || stale;
  const exhausted = failedLike && attempts >= PARSE_RETRY_LIMIT;
  const showRetry = failedLike && !exhausted;

  return (
    <li>
      <button onClick={onSelect}
        className={`w-full rounded px-2 py-1 text-left ${active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
        <div className="truncate">{s.category_path ?? '(카테고리 미상)'}</div>
        <div className="text-xs text-gray-500">
          {s.sort_label ?? '정렬 미상'} · {s.listing_count}개 · ⭐{s.starred_count}
          {s.parse_status === 'failed' && <span className="text-red-600"> · 실패</span>}
          {s.parse_status === 'parsing' && !stale && (
            <span> · 판독 중{s.parse_started_at ? ` (${minutesAgo(s.parse_started_at)}분 경과)` : ''}</span>
          )}
          {stale && <span className="text-red-600"> · 응답 없음 (10분 경과)</span>}
        </div>
      </button>
      {showRetry && (
        <button className="px-2 text-xs underline disabled:text-gray-400" disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await onRetry(s.id); } finally { setBusy(false); }
          }}>
          {busy ? '판독 중…' : '판독 재시도'}
        </button>
      )}
      {exhausted && <div className="px-2 text-xs text-red-600">3회 실패 — 캡처를 다시 올려 주세요</div>}
    </li>
  );
}

export default function CandidatesWorkspace() {
  const [tab, setTab] = useState<'scan' | 'candidates'>('scan');
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [rows, setRows] = useState<ListingView[]>([]);
  const [starred, setStarred] = useState<ListingView[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 방금 올린 캡처가 판독되는 동안 표 대신 보여줄 안내 (scans 목록이 아직 이 스캔을 모를 때 대비) */
  const [parsingUpload, setParsingUpload] = useState<{ id: string; tiles: number } | null>(null);

  // 최신 scanId를 ref로도 들고 있는다 — 비동기 응답이 돌아왔을 때 "그 사이 다른 스캔으로
  // 옮기지 않았는지"를 판별하는 용도(I2). 렌더 중 대입은 멱등이라 안전하다.
  const scanIdRef = useRef<string | null>(null);
  scanIdRef.current = scanId;

  /** 스캔 목록·⭐후보 — 선택된 스캔과 무관하게 항상 최신으로 */
  const refreshLists = useCallback(async () => {
    const [scansList, starredList] = await Promise.all([api.listScans(), api.listings({ starred: true })]);
    setScans(scansList);
    setStarred(starredList);
  }, []);

  /**
   * 선택된 스캔의 후보 표. idOverride가 있으면 그 스캔을, 없으면 현재 선택된 스캔을 읽는다.
   * 응답이 돌아왔을 때 이미 다른 스캔으로 옮겨 있으면 그 응답은 버린다 (I2).
   */
  const refreshRows = useCallback(async (idOverride?: string) => {
    const id = idOverride ?? scanIdRef.current;
    if (!id) { setRows([]); return; }
    const data = await api.listings({ scan: id });
    if (scanIdRef.current === id) setRows(data);
  }, []);

  const refresh = useCallback(async (idOverride?: string) => {
    try {
      await Promise.all([refreshLists(), refreshRows(idOverride)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    }
  }, [refreshLists, refreshRows]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** 사이드바에서 스캔을 고를 때 — 표를 먼저 비워 낡은 스캔의 줄을 보여주지 않는다 (I2) */
  const selectScan = useCallback((id: string) => {
    setError(null);
    setScanId(id);
    setRows([]);
    void refresh(id);
  }, [refresh]);

  /** 실패·응답없음 스캔의 재시도 — 성공하든 실패하든 사이드바는 갱신한다 (C2) */
  const retryParse = useCallback(async (id: string) => {
    setError(null);
    try {
      await api.parseScan(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '판독 실패');
    } finally {
      await refresh(id);
    }
  }, [refresh]);

  const current = scans.find((s) => s.id === scanId);
  const isParsing = parsingUpload !== null || current?.parse_status === 'parsing';

  /**
   * 판독 중엔 "n분 경과"·재시도 버튼이 시간이 지나도 저절로 갱신되지 않는다(재렌더
   * 계기가 없다) — 30초마다 다시 불러와 스스로 최신 상태를 반영하게 한다.
   * isParsing이 꺼지면(완료·실패로 상태가 바뀌면) effect가 정리되고 폴링도 멎는다.
   */
  useEffect(() => {
    if (!isParsing) return;
    const id = setInterval(() => { void refresh(); }, PARSING_POLL_MS);
    return () => clearInterval(id);
  }, [isParsing, refresh]);

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
                setError(null);
                const { id } = await api.uploadScan(files);
                setScanId(id);
                setRows([]);
                setParsingUpload({ id, tiles: files.length });
                try {
                  const r = await api.parseScan(id);
                  return `상품 약 ${r.listing_count}개 인식 — 더 필요하면 스크롤해서 추가 캡처`;
                } finally {
                  setParsingUpload(null);
                  await refresh(id);
                }
              }} />
            <ul className="space-y-1 text-sm">
              {scans.map((s) => (
                <ScanListItem key={s.id} s={s} active={s.id === scanId} onSelect={() => selectScan(s.id)} onRetry={retryParse} />
              ))}
            </ul>
          </aside>
          <section>
            {current?.parse_error && <div className="mb-2 text-sm text-amber-700">{current.parse_error}</div>}
            {parsingUpload && parsingUpload.id === scanId ? (
              <div className="text-sm text-gray-500">판독 중… (조각 {parsingUpload.tiles}개, 10~120초)</div>
            ) : current?.parse_status === 'parsing' ? (
              <div className="text-sm text-gray-500">판독 중… (10~120초 정도 걸립니다)</div>
            ) : scanId ? (
              <ListingTable rows={rows} onPatch={async (id, data) => {
                setError(null);
                try {
                  await api.patchListing(id, data);
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : '저장 실패');
                }
              }} />
            ) : (
              <div className="text-sm text-gray-500">왼쪽에서 캡처를 올리거나 스캔을 고르세요.</div>
            )}
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
