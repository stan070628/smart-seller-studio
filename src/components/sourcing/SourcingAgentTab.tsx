'use client';

import React, { useCallback, useEffect, useState } from 'react';

// ─── 색상 토큰 (다크 테마) ─────────────────────────────────────────────────────
const DC = {
  bg:      '#0f1117',
  surface: '#1a1d26',
  border:  '#2a2d3a',
  accent:  '#6366f1',
  text:    '#e2e8f0',
  textSub: '#94a3b8',
  success: '#10b981',
  warn:    '#f59e0b',
  danger:  '#ef4444',
} as const;

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface KeywordResult {
  id: number;
  rank: number;
  naver_price: number | null;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_margin_rate: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_margin_rate: number | null;
}

interface KeywordRequest {
  id: number;
  keyword: string;
  status: 'pending' | 'done' | 'error';
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
  results: KeywordResult[];
}

interface Stats {
  total: number;
  thisWeek: number;
  avgTopMargin: number | null;
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatKrw(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString()}원`;
}

// ─── 서브 컴포넌트: 마진 배지 ─────────────────────────────────────────────────
function MarginBadge({ rate }: { rate: number | null }) {
  if (rate == null) return <span style={{ fontSize: 11, color: DC.textSub }}>—</span>;
  const pct = rate.toFixed(1);
  const color = rate >= 40 ? DC.success : rate >= 25 ? DC.warn : DC.danger;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      background: `${color}22`, color,
      border: `1px solid ${color}55`,
    }}>
      {pct}%
    </span>
  );
}

// ─── 서브 컴포넌트: 상태 배지 ─────────────────────────────────────────────────
function StatusBadge({ status }: { status: KeywordRequest['status'] }) {
  if (status === 'pending') return <span style={{ color: DC.warn, fontSize: 12 }}>⏳ 분석 중...</span>;
  if (status === 'error')   return <span style={{ color: DC.danger, fontSize: 12 }}>❌ 오류</span>;
  return <span style={{ color: DC.success, fontSize: 12 }}>✅ 완료</span>;
}

// ─── 서브 컴포넌트: 결과 카드 ────────────────────────────────────────────────
function ResultCard({ result }: { result: KeywordResult }) {
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const medal = medals[result.rank - 1] ?? `${result.rank}위`;

  return (
    <div style={{
      background: DC.bg, borderRadius: 8, padding: '10px 14px',
      border: `1px solid ${DC.border}`, marginBottom: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{medal}</span>
        <span style={{ fontSize: 13, color: DC.text, fontWeight: 600 }}>
          {result.domeggook_product_name ?? '—'}
        </span>
        <MarginBadge rate={result.domeggook_margin_rate} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <div>
          <span style={{ color: DC.textSub }}>네이버가: </span>
          <span style={{ color: DC.text }}>{formatKrw(result.naver_price)}</span>
        </div>
        <div>
          <span style={{ color: DC.textSub }}>도매꾹가: </span>
          {result.domeggook_url ? (
            <a href={result.domeggook_url} target="_blank" rel="noreferrer"
               style={{ color: DC.accent }}>
              {formatKrw(result.domeggook_price)}
            </a>
          ) : (
            <span style={{ color: DC.text }}>{formatKrw(result.domeggook_price)}</span>
          )}
        </div>
        <div>
          <span style={{ color: DC.textSub }}>1688가: </span>
          {result.china_url ? (
            <a href={result.china_url} target="_blank" rel="noreferrer"
               style={{ color: DC.accent }}>
              {formatKrw(result.china_price_krw)}
            </a>
          ) : (
            <span style={{ color: DC.textSub }}>없음</span>
          )}
        </div>
        <div>
          <span style={{ color: DC.textSub }}>1688 마진: </span>
          <MarginBadge rate={result.china_margin_rate} />
        </div>
      </div>
    </div>
  );
}

// ─── 서브 컴포넌트: 요청 행 ───────────────────────────────────────────────────
function RequestRow({ request }: { request: KeywordRequest }) {
  const [open, setOpen] = useState(false);
  const topMargin = request.results.length > 0
    ? Math.max(...request.results.map((r) => r.domeggook_margin_rate ?? 0))
    : null;

  return (
    <div style={{
      background: DC.surface, borderRadius: 10,
      border: `1px solid ${DC.border}`, marginBottom: 8, overflow: 'hidden',
    }}>
      <div
        onClick={() => request.status === 'done' && setOpen((v) => !v)}
        style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center',
          gap: 12, cursor: request.status === 'done' ? 'pointer' : 'default',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: DC.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {request.keyword}
          </div>
          <div style={{ fontSize: 11, color: DC.textSub, marginTop: 2 }}>
            {formatDate(request.requested_at)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StatusBadge status={request.status} />
          {request.status === 'done' && topMargin != null && (
            <span style={{ fontSize: 11, color: DC.textSub }}>
              최고 <MarginBadge rate={topMargin} />
            </span>
          )}
          {request.status === 'done' && (
            <span style={{ color: DC.textSub, fontSize: 12 }}>{open ? '▲' : '▼'}</span>
          )}
        </div>
      </div>

      {open && request.results.length > 0 && (
        <div style={{ padding: '0 12px 12px' }}>
          {request.results.map((r) => (
            <ResultCard key={r.id} result={r} />
          ))}
        </div>
      )}

      {open && request.results.length === 0 && (
        <div style={{ padding: '8px 16px 12px', fontSize: 12, color: DC.textSub }}>
          결과 없음
        </div>
      )}

      {request.status === 'error' && request.error_message && (
        <div style={{ padding: '0 16px 12px', fontSize: 12, color: DC.danger }}>
          {request.error_message}
        </div>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function SourcingAgentTab() {
  const [requests, setRequests] = useState<KeywordRequest[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  const fetchData = useCallback(async (kw?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50', stats: 'true' });
      if (kw) params.set('keyword', kw);
      const res = await fetch(`/api/sourcing/agent/results?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setRequests(json.data);
      if (json.stats) setStats(json.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // pending 요청이 있으면 10초마다 자동 갱신
  useEffect(() => {
    const hasPending = requests.some((r) => r.status === 'pending');
    if (!hasPending) return;
    const timer = setInterval(() => fetchData(keyword || undefined), 10_000);
    return () => clearInterval(timer);
  }, [requests, keyword, fetchData]);

  return (
    <div style={{ background: DC.bg, minHeight: '100%', padding: 20, color: DC.text }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>소싱 에이전트</div>
        <div style={{ fontSize: 12, color: DC.textSub }}>
          텔레그램 봇에 상품명을 보내면 자동 분석됩니다
        </div>
      </div>

      {/* 통계 */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          {[
            { label: '전체', value: `${stats.total}건` },
            { label: '이번 주', value: `${stats.thisWeek}건` },
            { label: '평균 마진', value: stats.avgTopMargin ? `${stats.avgTopMargin.toFixed(1)}%` : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{
              flex: 1, background: DC.surface, borderRadius: 8,
              border: `1px solid ${DC.border}`, padding: '10px 14px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: DC.textSub, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: DC.accent }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 검색 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchData(keyword || undefined)}
          placeholder="키워드 검색..."
          style={{
            flex: 1, background: DC.surface, border: `1px solid ${DC.border}`,
            borderRadius: 8, padding: '8px 12px', color: DC.text,
            fontSize: 13, outline: 'none',
          }}
        />
        <button
          onClick={() => fetchData(keyword || undefined)}
          style={{
            background: DC.accent, color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 16px', fontSize: 13,
            cursor: 'pointer',
          }}
        >
          검색
        </button>
        <button
          onClick={() => { setKeyword(''); fetchData(); }}
          style={{
            background: DC.surface, color: DC.textSub, border: `1px solid ${DC.border}`,
            borderRadius: 8, padding: '8px 12px', fontSize: 13,
            cursor: 'pointer',
          }}
        >
          초기화
        </button>
      </div>

      {/* 목록 */}
      {loading && (
        <div style={{ textAlign: 'center', color: DC.textSub, padding: 40 }}>불러오는 중...</div>
      )}
      {error && (
        <div style={{ color: DC.danger, fontSize: 13, padding: 16, background: `${DC.danger}11`, borderRadius: 8 }}>
          {error}
        </div>
      )}
      {!loading && !error && requests.length === 0 && (
        <div style={{ textAlign: 'center', color: DC.textSub, padding: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📱</div>
          <div>텔레그램 봇에 상품명을 보내면 여기에 결과가 표시됩니다</div>
        </div>
      )}
      {requests.map((req) => (
        <RequestRow key={req.id} request={req} />
      ))}
    </div>
  );
}
