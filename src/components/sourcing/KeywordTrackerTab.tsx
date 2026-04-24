'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { C as BASE_C } from '@/lib/design-tokens';

const C = {
  ...BASE_C,
  green: '#16a34a',
  greenBg: 'rgba(22,163,74,0.08)',
  red: '#dc2626',
  redBg: 'rgba(220,38,38,0.07)',
  yellow: '#d97706',
  purple: '#7c3aed',
  purpleDisabled: '#a78bfa',
};

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface KeywordEntry {
  id: string;
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  topReviewCount: number;
  domeggookNos: string;
  memo: string;
  createdAt: string;
  aiPass: boolean | null;
  aiReasoning: string | null;
}

interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
  pass: boolean | null;
  reasoning: string | null;
}

interface DiscoveredKeyword {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  pass: boolean | null;
  reasoning: string | null;
}

const STORAGE_KEY = 'plan_keywords';

function loadKeywords(): KeywordEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw
      ? (JSON.parse(raw) as KeywordEntry[]).map((e) => ({
          ...e,
          aiPass: e.aiPass ?? null,
          aiReasoning: e.aiReasoning ?? null,
        }))
      : [];
  } catch { return []; }
}

function saveKeywords(entries: KeywordEntry[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ─── 빈 폼 초기값 ────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  keyword: '',
  searchVolume: '' as string | number,
  competitorCount: '' as string | number,
  topReviewCount: '' as string | number,
  domeggookNos: '',
  memo: '',
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: 13,
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  outline: 'none',
  color: C.text,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
};

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function KeywordTrackerTab() {
  const [entries, setEntries] = useState<KeywordEntry[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showForm, setShowForm] = useState(false);
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [suggestHint, setSuggestHint] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestResults, setSuggestResults] = useState<SuggestedKeyword[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoverResults, setDiscoverResults] = useState<DiscoveredKeyword[]>([]);
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(loadKeywords());
  }, []);

  async function handleAdd() {
    if (!form.keyword.trim()) return;
    const sv = Number(form.searchVolume) || 0;
    const cc = Number(form.competitorCount) || 0;
    const rv = Number(form.topReviewCount) || 0;
    const newEntry: KeywordEntry = {
      id: crypto.randomUUID(),
      keyword: form.keyword.trim(),
      searchVolume: sv,
      competitorCount: cc,
      topReviewCount: rv,
      domeggookNos: form.domeggookNos.trim(),
      memo: form.memo.trim(),
      createdAt: new Date().toISOString(),
      aiPass: null,
      aiReasoning: null,
    };
    const updated = [newEntry, ...entries];
    setEntries(updated);
    saveKeywords(updated);
    setForm({ ...EMPTY_FORM });
    setShowForm(false);

    if (sv > 0 && cc > 0) {
      try {
        const res = await fetch('/api/ai/keyword-evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: newEntry.keyword,
            searchVolume: sv,
            competitorCount: cc,
            ...(rv > 0 ? { topReviewCount: rv } : {}),
          }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setEntries((prev) => {
              const next = prev.map((e) =>
                e.id === newEntry.id
                  ? { ...e, aiPass: json.data.pass, aiReasoning: json.data.reasoning }
                  : e,
              );
              saveKeywords(next);
              return next;
            });
          }
        }
      } catch {
        // aiPass stays null
      }
    }
  }

  async function handleSuggest() {
    setSuggestLoading(true);
    setSuggestResults([]);
    setSuggestError(null);
    try {
      const res = await fetch('/api/ai/keyword-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hint: suggestHint.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '알 수 없는 오류가 발생했습니다');
      if (!Array.isArray(json.data?.keywords)) throw new Error('잘못된 응답 형식입니다');
      const all = json.data.keywords as SuggestedKeyword[];
      const sorted = [...all].sort((a, b) => {
        if (a.pass === true && b.pass !== true) return -1;
        if (a.pass !== true && b.pass === true) return 1;
        return 0;
      });
      setSuggestResults(sorted);
      setSelectedIds(new Set(sorted.map((_, i) => i)));
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : '키워드 추천 중 오류가 발생했습니다');
    } finally {
      setSuggestLoading(false);
    }
  }

  const handleDiscover = async () => {
    setIsDiscovering(true);
    setDiscoverResults([]);
    setDiscoverError(null);
    try {
      const res = await fetch('/api/ai/keyword-discover', { method: 'POST' });
      if (!res.ok) throw new Error('키워드 발굴 중 오류가 발생했습니다.');
      const json = await res.json();
      if (json.success) {
        setDiscoverResults(json.data.keywords);
        setShowDiscoverModal(true);
      } else {
        setDiscoverError(json.error ?? '키워드 발굴 중 오류가 발생했습니다.');
      }
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : '키워드 발굴 중 오류가 발생했습니다.');
    } finally {
      setIsDiscovering(false);
    }
  };

  function handleAddSuggested() {
    const toAdd = suggestResults
      .filter((_, i) => selectedIds.has(i))
      .map((s) => ({
        id: crypto.randomUUID(),
        keyword: s.keyword,
        searchVolume: s.searchVolume ?? 0,
        competitorCount: s.competitorCount ?? 0,
        topReviewCount: 0,
        domeggookNos: '',
        memo: s.reason,
        createdAt: new Date().toISOString(),
        aiPass: s.pass ?? null,
        aiReasoning: s.reasoning ?? null,
      }));
    if (toAdd.length === 0) return;
    const updated = [...toAdd, ...entries];
    setEntries(updated);
    saveKeywords(updated);
    setShowSuggestModal(false);
    setSuggestResults([]);
    setSelectedIds(new Set());
    setSuggestHint('');
  }

  function toggleSelectId(i: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function handleDelete(id: string) {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    saveKeywords(updated);
  }

  const { passCount, failCount, nullCount } = useMemo(() =>
    entries.reduce(
      (acc, e) => {
        if (e.aiPass === true) acc.passCount++;
        else if (e.aiPass === false) acc.failCount++;
        else acc.nullCount++;
        return acc;
      },
      { passCount: 0, failCount: 0, nullCount: 0 }
    ),
    [entries]
  );

  return (
    <div style={{ padding: '20px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>키워드 트래커</h2>
          <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
            총 {entries.length}개 · 통과 {passCount}개 · 탈락 {failCount}개 · 미평가 {nullCount}개
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowSuggestModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              background: C.purple, color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            ✨ AI 추천
          </button>
          <button
            onClick={handleDiscover}
            disabled={isDiscovering}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              background: isDiscovering ? '#86efac' : C.green, color: '#fff',
              border: 'none', borderRadius: 8, cursor: isDiscovering ? 'not-allowed' : 'pointer',
            }}
          >
            {isDiscovering ? '발굴 중...' : '🔍 키워드 발굴'}
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              background: C.accent, color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> 키워드 추가
          </button>
        </div>
      </div>

      {/* AI 추천 모달 */}
      {showSuggestModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSuggestModal(false); }}
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowSuggestModal(false); }}
        >
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28,
            width: 560, maxWidth: '92vw', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', gap: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>✨ AI 키워드 추천</h3>
                <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
                  Claude가 카테고리 맥락을 분석해 키워드 15개를 제안합니다
                </p>
              </div>
              <button
                onClick={() => setShowSuggestModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.textSub, lineHeight: 1 }}
              >×</button>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 6 }}>
                카테고리 / 시즌 힌트 <span style={{ fontWeight: 400 }}>(선택 — 비워두면 AI가 자유롭게 추천)</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{
                    flex: 1, padding: '8px 12px', fontSize: 13,
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    outline: 'none', color: C.text,
                  }}
                  placeholder="예: 봄 시즌 / 주방용품 / 남성 데스크 소품"
                  value={suggestHint}
                  onChange={(e) => setSuggestHint(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !suggestLoading) handleSuggest(); }}
                  autoFocus
                />
                <button
                  onClick={handleSuggest}
                  disabled={suggestLoading}
                  style={{
                    padding: '8px 20px', fontSize: 13, fontWeight: 700,
                    background: suggestLoading ? C.purpleDisabled : C.purple,
                    color: '#fff', border: 'none', borderRadius: 8,
                    cursor: suggestLoading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {suggestLoading ? '추천 중...' : '추천 받기'}
                </button>
              </div>
            </div>

            {suggestError && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, fontSize: 13,
                background: 'rgba(220,38,38,0.07)', color: '#dc2626',
                border: '1px solid rgba(220,38,38,0.2)',
              }}>
                ⚠️ {suggestError}
              </div>
            )}

            {suggestLoading && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: C.textSub, fontSize: 13 }}>
                Claude 분석 + 네이버 검색량 조회 중...
              </div>
            )}

            {!suggestLoading && suggestResults.length > 0 && (
              <>
                <div style={{ overflowY: 'auto', maxHeight: 340, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  {suggestResults.map((s, i) => (
                    <label
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 14px',
                        borderBottom: i < suggestResults.length - 1 ? `1px solid ${C.border}` : 'none',
                        cursor: 'pointer',
                        background: selectedIds.has(i) ? 'rgba(124,58,237,0.04)' : '#fff',
                        opacity: s.pass === false ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(i)}
                        onChange={() => toggleSelectId(i)}
                        style={{ marginTop: 2, accentColor: C.purple, flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.keyword}</span>
                          {s.pass !== null && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                              background: s.pass ? C.greenBg : C.redBg,
                              color: s.pass ? C.green : C.red,
                            }}>
                              {s.pass ? '✅ 통과' : '❌ 탈락'}
                            </span>
                          )}
                        </div>
                        {s.searchVolume !== null && s.competitorCount !== null && (
                          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
                            검색량 {s.searchVolume.toLocaleString()} · 경쟁 {s.competitorCount.toLocaleString()}개
                          </div>
                        )}
                        {s.reasoning && (
                          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2, fontStyle: 'italic' }}>
                            {s.reasoning}
                          </div>
                        )}
                        {!s.reasoning && (
                          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{s.reason}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.textSub }}>
                    {selectedIds.size}개 선택됨
                  </span>
                  <button
                    onClick={handleAddSuggested}
                    disabled={selectedIds.size === 0}
                    style={{
                      padding: '8px 20px', fontSize: 13, fontWeight: 700,
                      background: selectedIds.size > 0 ? C.purple : '#ccc',
                      color: '#fff', border: 'none', borderRadius: 8,
                      cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                    }}
                  >
                    선택 추가 ({selectedIds.size}개)
                  </button>
                </div>
              </>
            )}

            {!suggestLoading && suggestResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: C.textSub, fontSize: 13 }}>
                힌트를 입력하거나 그냥 &ldquo;추천 받기&rdquo;를 눌러보세요
              </div>
            )}
          </div>
        </div>
      )}

      {/* 키워드 발굴 에러 */}
      {discoverError && (
        <div style={{
          background: '#fff5f5', border: '1px solid #fecaca',
          borderRadius: 8, padding: '10px 14px', marginBottom: 12,
          fontSize: 13, color: C.red, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          ⚠️ {discoverError}
          <button
            onClick={() => setDiscoverError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub, fontSize: 16, lineHeight: 1 }}
          >✕</button>
        </div>
      )}

      {/* 키워드 발굴 모달 */}
      {showDiscoverModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDiscoverModal(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowDiscoverModal(false); }}
          tabIndex={-1}
        >
          <div style={{
            background: C.card, borderRadius: 12, padding: 24,
            maxWidth: 672, width: '100%', maxHeight: '80vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>🔍 키워드 발굴 결과</h3>
              <button
                onClick={() => setShowDiscoverModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.textSub, lineHeight: 1 }}
              >✕</button>
            </div>
            {discoverResults.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: C.textSub, fontSize: 13 }}>
                발굴된 키워드가 없습니다.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {discoverResults.map((kw, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{kw.keyword}</span>
                      <span style={{ fontSize: 11, color: C.textSub }}>검색량 {kw.searchVolume.toLocaleString()}</span>
                      <span style={{ fontSize: 11, color: C.textSub }}>경쟁 {kw.competitorCount !== null ? kw.competitorCount.toLocaleString() : '—'}</span>
                      {kw.pass === true && (
                        <span title={kw.reasoning ?? undefined} style={{ cursor: 'help' }}>✅</span>
                      )}
                      {kw.pass === false && (
                        <span title={kw.reasoning ?? undefined} style={{ cursor: 'help' }}>❌</span>
                      )}
                      {kw.pass === null && (
                        <span style={{ color: C.textSub, fontSize: 12 }}>—</span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setShowDiscoverModal(false);
                        setForm((f) => ({
                          ...f,
                          keyword: kw.keyword,
                          searchVolume: String(kw.searchVolume),
                          competitorCount: kw.competitorCount !== null ? String(kw.competitorCount) : '',
                        }));
                        setShowForm(true);
                      }}
                      style={{ fontSize: 12, color: C.purple, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      사용
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 입력 폼 */}
      {showForm && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 20, marginBottom: 20,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>키워드 *</label>
              <input
                style={inputStyle}
                placeholder="예: 방수 백팩 직장인"
                value={form.keyword}
                onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>월 검색량</label>
              <input
                style={inputStyle} type="number" placeholder="예: 8500"
                value={form.searchVolume}
                onChange={(e) => setForm((f) => ({ ...f, searchVolume: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>경쟁 상품 수</label>
              <input
                style={inputStyle} type="number" placeholder="예: 320"
                value={form.competitorCount}
                onChange={(e) => setForm((f) => ({ ...f, competitorCount: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>상위 리뷰 수</label>
              <input
                style={inputStyle} type="number" placeholder="예: 23"
                value={form.topReviewCount}
                onChange={(e) => setForm((f) => ({ ...f, topReviewCount: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>도매꾹 번호</label>
              <input
                style={inputStyle} placeholder="12345, 67890"
                value={form.domeggookNos}
                onChange={(e) => setForm((f) => ({ ...f, domeggookNos: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>메모</label>
            <input
              style={inputStyle} placeholder="추가 메모"
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={!form.keyword.trim()}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 700,
                background: form.keyword.trim() ? C.accent : '#ccc',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: form.keyword.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              저장
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '8px 16px', fontSize: 13,
                background: C.bg, color: C.textSub,
                border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 목록 테이블 */}
      {entries.length > 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f3f3f3', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub, width: 44 }}>판정</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>키워드</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 90 }}>월검색량</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 80 }}>경쟁수</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 80 }}>상위리뷰</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>도매꾹</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>메모</th>
                <th style={{ padding: '10px 16px', width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr key={entry.id} style={{ background: idx % 2 === 0 ? '#fff' : C.bg, borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                    {entry.aiPass === true && (
                      <span title={entry.aiReasoning ?? undefined} style={{ cursor: entry.aiReasoning ? 'help' : 'default' }}>
                        <CheckCircle size={16} color={C.green} />
                      </span>
                    )}
                    {entry.aiPass === false && (
                      <span title={entry.aiReasoning ?? undefined} style={{ cursor: entry.aiReasoning ? 'help' : 'default' }}>
                        <XCircle size={16} color={C.red} />
                      </span>
                    )}
                    {entry.aiPass === null && <span style={{ color: C.textSub, fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 16px', fontWeight: 600, color: C.text }}>{entry.keyword}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.searchVolume === 0 ? C.textSub : C.text }}>
                    {entry.searchVolume ? entry.searchVolume.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.competitorCount === 0 ? C.textSub : C.text }}>
                    {entry.competitorCount ? entry.competitorCount.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.topReviewCount === 0 ? C.textSub : C.text }}>
                    {entry.topReviewCount ? entry.topReviewCount.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: C.textSub, fontSize: 12, fontFamily: 'monospace' }}>
                    {entry.domeggookNos || '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: C.textSub, fontSize: 12 }}>{entry.memo || '—'}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.textSub }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.textSub, fontSize: 14 }}>
          아이템스카우트에서 조사한 키워드를 추가하세요
        </div>
      )}
    </div>
  );
}
