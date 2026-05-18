'use client';

import React, { useCallback, useEffect, useState } from 'react';

// ─── 색상 토큰 (다크 테마) ────────────────────────────────────────────────────
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
interface AgentCategory {
  id: number;
  name: string;
  last_crawled_at: string | null;
  is_active: boolean;
}

interface AgentResult {
  id: number;
  crawled_at: string;
  category_id: number;
  category_name: string;
  coupang_product_id: string;
  coupang_product_name: string;
  coupang_rank: number;
  coupang_price: number;
  coupang_image_url: string;
  coupang_url: string;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_image_url: string | null;
  domeggook_similarity: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_image_url: string | null;
  domeggook_margin_rate: number | null;
  china_margin_rate: number | null;
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

// ─── 서브 컴포넌트: 소스 링크 ─────────────────────────────────────────────────
function SourceLinks({
  coupangUrl, domeggookUrl, chinaUrl,
}: { coupangUrl: string; domeggookUrl: string | null; chinaUrl: string | null }) {
  const link = (href: string, label: string, color: string) => (
    <a
      href={href} target="_blank" rel="noopener noreferrer"
      style={{
        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
        background: `${color}22`, color, border: `1px solid ${color}44`,
        textDecoration: 'none', whiteSpace: 'nowrap',
      }}
    >{label}</a>
  );
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {link(coupangUrl, '쿠팡', '#be0014')}
      {domeggookUrl && link(domeggookUrl, '도매꾹', '#0ea5e9')}
      {chinaUrl && link(chinaUrl, '1688', '#f97316')}
    </div>
  );
}

// ─── 서브 컴포넌트: 상세 슬라이드오버 ───────────────────────────────────────
function DetailSlideOver({ result, onClose }: { result: AgentResult; onClose: () => void }) {
  const fmt = (n: number | null, suffix = '원') =>
    n == null ? '—' : `${n.toLocaleString()}${suffix}`;

  return (
    <>
      {/* 오버레이 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
        }}
      />
      {/* 패널 */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
        background: DC.surface, borderLeft: `1px solid ${DC.border}`,
        zIndex: 101, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: DC.text }}>상세 정보</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: DC.textSub, cursor: 'pointer', fontSize: 18 }}
          >✕</button>
        </div>

        {/* 쿠팡 */}
        <Section title="쿠팡">
          <Row label="상품명" value={result.coupang_product_name} />
          <Row label="순위" value={`${result.coupang_rank}위`} />
          <Row label="가격" value={fmt(result.coupang_price)} />
          {result.coupang_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.coupang_image_url} alt="" style={{ width: '100%', borderRadius: 6, marginTop: 6 }} />
          )}
          <a href={result.coupang_url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: DC.accent }}>쿠팡 페이지 열기 →</a>
        </Section>

        {/* 도매꾹 */}
        {result.domeggook_url ? (
          <Section title="도매꾹 매칭">
            <Row label="상품명" value={result.domeggook_product_name ?? '—'} />
            <Row label="가격" value={fmt(result.domeggook_price)} />
            <Row label="유사도" value={result.domeggook_similarity != null ? `${(result.domeggook_similarity * 100).toFixed(0)}%` : '—'} />
            <Row label="마진율" value={<MarginBadge rate={result.domeggook_margin_rate} />} />
            {result.domeggook_image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.domeggook_image_url} alt="" style={{ width: '100%', borderRadius: 6, marginTop: 6 }} />
            )}
            <a href={result.domeggook_url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#0ea5e9' }}>도매꾹 페이지 열기 →</a>
          </Section>
        ) : (
          <Section title="도매꾹 매칭">
            <div style={{ fontSize: 12, color: DC.textSub }}>매칭 결과 없음</div>
          </Section>
        )}

        {/* 1688 */}
        {result.china_url ? (
          <Section title="1688 매칭">
            <Row label="상품명" value={result.china_product_name ?? '—'} />
            <Row label="원가(원)" value={fmt(result.china_price_krw)} />
            <Row label="마진율" value={<MarginBadge rate={result.china_margin_rate} />} />
            {result.china_image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.china_image_url} alt="" style={{ width: '100%', borderRadius: 6, marginTop: 6 }} />
            )}
            <a href={result.china_url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#f97316' }}>1688 페이지 열기 →</a>
          </Section>
        ) : (
          <Section title="1688 매칭">
            <div style={{ fontSize: 12, color: DC.textSub }}>매칭 결과 없음</div>
          </Section>
        )}

        <div style={{ fontSize: 10, color: DC.textSub, marginTop: 'auto' }}>
          크롤링: {new Date(result.crawled_at).toLocaleString('ko-KR')}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: DC.bg, borderRadius: 8, padding: 12, border: `1px solid ${DC.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: DC.accent, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: DC.textSub }}>{label}</span>
      <span style={{ color: DC.text, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function SourcingAgentTab() {
  const [results, setResults] = useState<AgentResult[]>([]);
  const [categories, setCategories] = useState<AgentCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentResult | null>(null);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const fetchResults = useCallback(async (off = 0, catId = categoryFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
      if (catId) params.set('categoryId', String(catId));
      const res = await fetch(`/api/sourcing/agent/results?${params}`);
      const json = await res.json();
      if (json.success) {
        setResults(off === 0 ? json.data : (prev) => [...prev, ...json.data]);
        setOffset(off);
      }
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    fetchResults(0, null);
    fetch('/api/sourcing/agent/categories')
      .then((r) => r.json())
      .then((j) => { if (j.success) setCategories(j.data); });
  }, [fetchResults]);

  const handleCategoryFilter = (id: number | null) => {
    setCategoryFilter(id);
    fetchResults(0, id);
  };

  const handleRun = async () => {
    setRunning(true);
    setRunLog(null);
    try {
      const body: Record<string, unknown> = {};
      if (categoryFilter) body.categoryId = categoryFilter;
      const res = await fetch('/api/sourcing/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setRunLog(`✅ 완료 — 카테고리: ${json.categoryName}, 저장: ${json.savedCount}개`);
        fetchResults(0, categoryFilter);
      } else {
        setRunLog(`❌ ${json.error ?? '실행 실패'}`);
      }
    } catch (e) {
      setRunLog(`❌ ${e instanceof Error ? e.message : '실행 실패'}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ flex: 1, background: DC.bg, color: DC.text, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 헤더 */}
      <div style={{
        padding: '12px 20px', background: DC.surface,
        borderBottom: `1px solid ${DC.border}`,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: DC.text }}>🤖 소싱 에이전트</div>
          <div style={{ fontSize: 11, color: DC.textSub }}>쿠팡 카테고리 자동 크롤링 → 도매꾹/1688 매칭</div>
        </div>

        {/* 카테고리 필터 */}
        <select
          value={categoryFilter ?? ''}
          onChange={(e) => handleCategoryFilter(e.target.value ? Number(e.target.value) : null)}
          style={{
            padding: '5px 10px', borderRadius: 6, border: `1px solid ${DC.border}`,
            background: DC.surface, color: DC.text, fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="">전체 카테고리</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <button
          onClick={() => fetchResults(0, categoryFilter)}
          disabled={loading}
          style={{
            padding: '6px 14px', borderRadius: 6, border: `1px solid ${DC.border}`,
            background: 'transparent', color: DC.textSub, fontSize: 12, cursor: 'pointer',
          }}
        >
          {loading ? '로딩 중...' : '↻ 새로고침'}
        </button>

        <button
          onClick={handleRun}
          disabled={running}
          style={{
            marginLeft: 'auto', padding: '7px 18px', borderRadius: 6, border: 'none',
            background: running ? '#4b5563' : DC.accent,
            color: '#fff', fontSize: 12, fontWeight: 700,
            cursor: running ? 'not-allowed' : 'pointer',
          }}
        >
          {running ? '⏳ 소싱 중...' : '▶ 지금 소싱'}
        </button>
      </div>

      {/* 실행 로그 */}
      {runLog && (
        <div style={{
          padding: '8px 20px', fontSize: 12,
          background: runLog.startsWith('✅') ? '#052e16' : '#450a0a',
          color: runLog.startsWith('✅') ? DC.success : DC.danger,
          borderBottom: `1px solid ${DC.border}`,
        }}>{runLog}</div>
      )}

      {/* 결과 테이블 */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {results.length === 0 && !loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: DC.textSub, fontSize: 13 }}>
            결과가 없습니다. &quot;지금 소싱&quot; 버튼을 클릭하거나 매일 오전 6시 자동 실행됩니다.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: DC.surface, position: 'sticky', top: 0, zIndex: 1 }}>
                {['카테고리', '쿠팡 상품', '쿠팡가', '도매꾹 마진', '1688 마진', '링크', '크롤링일'].map((h) => (
                  <th key={h} style={{
                    padding: '8px 12px', textAlign: 'left', fontWeight: 600,
                    color: DC.textSub, fontSize: 11,
                    borderBottom: `1px solid ${DC.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  style={{
                    borderBottom: `1px solid ${DC.border}`,
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = DC.surface)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '8px 12px', color: DC.textSub, whiteSpace: 'nowrap' }}>
                    {r.category_name}
                  </td>
                  <td style={{ padding: '8px 12px', maxWidth: 220 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: DC.text }}>
                      {r.coupang_product_name}
                    </div>
                    <div style={{ fontSize: 10, color: DC.textSub }}>#{r.coupang_rank}</div>
                  </td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: DC.text }}>
                    {r.coupang_price.toLocaleString()}원
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <MarginBadge rate={r.domeggook_margin_rate} />
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <MarginBadge rate={r.china_margin_rate} />
                  </td>
                  <td style={{ padding: '8px 12px' }} onClick={(e) => e.stopPropagation()}>
                    <SourceLinks
                      coupangUrl={r.coupang_url}
                      domeggookUrl={r.domeggook_url}
                      chinaUrl={r.china_url}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: DC.textSub, fontSize: 11 }}>
                    {new Date(r.crawled_at).toLocaleDateString('ko-KR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 더 보기 */}
        {results.length > 0 && results.length % LIMIT === 0 && (
          <div style={{ padding: '12px 0', textAlign: 'center' }}>
            <button
              onClick={() => fetchResults(offset + LIMIT, categoryFilter)}
              disabled={loading}
              style={{
                padding: '6px 20px', borderRadius: 6, border: `1px solid ${DC.border}`,
                background: 'transparent', color: DC.textSub, fontSize: 12, cursor: 'pointer',
              }}
            >
              {loading ? '로딩 중...' : '더 보기'}
            </button>
          </div>
        )}
      </div>

      {/* 슬라이드오버 */}
      {selected && <DetailSlideOver result={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
