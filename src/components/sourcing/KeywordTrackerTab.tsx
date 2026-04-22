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
};

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface KeywordEntry {
  id: string;
  keyword: string;
  searchVolume: number;    // 월 검색량
  competitorCount: number; // 경쟁 상품 수
  topReviewCount: number;  // 상위 상품 리뷰 수
  domeggookNos: string;    // 매칭 도매꾹 상품번호 (쉼표 구분)
  memo: string;
  createdAt: string;       // ISO 날짜
}

interface SuggestedKeyword {
  keyword: string;
  reason: string;
}

type PassStatus = 'pass' | 'fail' | 'unknown';

function judgeKeyword(entry: KeywordEntry): PassStatus {
  if (!entry.searchVolume && !entry.competitorCount && !entry.topReviewCount) return 'unknown';
  const volumeOk = entry.searchVolume >= 3000 && entry.searchVolume <= 30000;
  const competitorOk = entry.competitorCount < 500;
  const reviewOk = entry.topReviewCount < 50;
  return volumeOk && competitorOk && reviewOk ? 'pass' : 'fail';
}

const STORAGE_KEY = 'plan_keywords';

function loadKeywords(): KeywordEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as KeywordEntry[]) : [];
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

  useEffect(() => {
    setEntries(loadKeywords());
  }, []);

  function handleAdd() {
    if (!form.keyword.trim()) return;
    const newEntry: KeywordEntry = {
      id: crypto.randomUUID(),
      keyword: form.keyword.trim(),
      searchVolume: Number(form.searchVolume) || 0,
      competitorCount: Number(form.competitorCount) || 0,
      topReviewCount: Number(form.topReviewCount) || 0,
      domeggookNos: form.domeggookNos.trim(),
      memo: form.memo.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newEntry, ...entries];
    setEntries(updated);
    saveKeywords(updated);
    setForm({ ...EMPTY_FORM });
    setShowForm(false);
  }

  async function handleSuggest() {
    setSuggestLoading(true);
    setSuggestResults([]);
    try {
      const res = await fetch('/api/ai/keyword-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hint: suggestHint.trim() || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        const all = json.data.keywords as SuggestedKeyword[];
        setSuggestResults(all);
        setSelectedIds(new Set(all.map((_, i) => i)));
      }
    } catch {
      // 빈 결과 유지 — 사용자가 재시도 가능
    } finally {
      setSuggestLoading(false);
    }
  }

  function handleAddSuggested() {
    const toAdd = suggestResults
      .filter((_, i) => selectedIds.has(i))
      .map((s) => ({
        id: crypto.randomUUID(),
        keyword: s.keyword,
        searchVolume: 0,
        competitorCount: 0,
        topReviewCount: 0,
        domeggookNos: '',
        memo: s.reason,
        createdAt: new Date().toISOString(),
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

  const { passCount, failCount } = useMemo(() =>
    entries.reduce(
      (acc, e) => {
        const s = judgeKeyword(e);
        if (s === 'pass') acc.passCount++;
        else if (s === 'fail') acc.failCount++;
        return acc;
      },
      { passCount: 0, failCount: 0 }
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
            총 {entries.length}개 · 통과 {passCount}개 · 탈락 {failCount}개
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowSuggestModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              background: '#7c3aed', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >
            ✨ AI 추천
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

      {/* 판정 기준 안내 */}
      <div style={{
        background: 'rgba(190,0,20,0.05)',
        border: `1px solid rgba(190,0,20,0.15)`,
        borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: C.textSub,
      }}>
        ✅ 통과 조건: 월 검색량 <strong style={{ color: C.text }}>3,000~30,000</strong> &nbsp;·&nbsp;
        경쟁 <strong style={{ color: C.text }}>500개 미만</strong> &nbsp;·&nbsp;
        상위 리뷰 <strong style={{ color: C.text }}>50개 미만</strong> — 3개 모두 충족
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
        >
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28,
            width: 560, maxWidth: '92vw', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', gap: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            {/* 모달 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>✨ AI 키워드 추천</h3>
                <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
                  Claude가 셀러 전략 기준(검색량·경쟁·리뷰)에 맞는 키워드 15개를 제안합니다
                </p>
              </div>
              <button
                onClick={() => setShowSuggestModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.textSub, lineHeight: 1 }}
              >×</button>
            </div>

            {/* 힌트 입력 */}
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
                />
                <button
                  onClick={handleSuggest}
                  disabled={suggestLoading}
                  style={{
                    padding: '8px 20px', fontSize: 13, fontWeight: 700,
                    background: suggestLoading ? '#a78bfa' : '#7c3aed',
                    color: '#fff', border: 'none', borderRadius: 8,
                    cursor: suggestLoading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {suggestLoading ? '추천 중...' : '추천 받기'}
                </button>
              </div>
            </div>

            {/* 로딩 */}
            {suggestLoading && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: C.textSub, fontSize: 13 }}>
                Claude가 키워드를 분석하는 중...
              </div>
            )}

            {/* 추천 결과 */}
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
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(i)}
                        onChange={() => toggleSelectId(i)}
                        style={{ marginTop: 2, accentColor: '#7c3aed', flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.keyword}</div>
                        <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{s.reason}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.textSub }}>
                    {selectedIds.size}개 선택됨 · 숫자 필드는 아이템스카우트에서 직접 채우세요
                  </span>
                  <button
                    onClick={handleAddSuggested}
                    disabled={selectedIds.size === 0}
                    style={{
                      padding: '8px 20px', fontSize: 13, fontWeight: 700,
                      background: selectedIds.size > 0 ? '#7c3aed' : '#ccc',
                      color: '#fff', border: 'none', borderRadius: 8,
                      cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                    }}
                  >
                    선택 추가 ({selectedIds.size}개)
                  </button>
                </div>
              </>
            )}

            {/* 초기 안내 */}
            {!suggestLoading && suggestResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 0', color: C.textSub, fontSize: 13 }}>
                힌트를 입력하거나 그냥 &ldquo;추천 받기&rdquo;를 눌러보세요
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
              {entries.map((entry, idx) => {
                const status = judgeKeyword(entry);
                return (
                  <tr key={entry.id} style={{ background: idx % 2 === 0 ? '#fff' : C.bg, borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      {status === 'pass' && <CheckCircle size={16} color={C.green} />}
                      {status === 'fail' && <XCircle size={16} color={C.red} />}
                      {status === 'unknown' && <span style={{ color: C.textSub, fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 16px', fontWeight: 600, color: C.text }}>{entry.keyword}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.searchVolume === 0 ? C.textSub : (entry.searchVolume >= 3000 && entry.searchVolume <= 30000 ? C.green : C.red) }}>
                      {entry.searchVolume ? entry.searchVolume.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.competitorCount === 0 ? C.textSub : (entry.competitorCount < 500 ? C.green : C.red) }}>
                      {entry.competitorCount ? entry.competitorCount.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.topReviewCount === 0 ? C.textSub : (entry.topReviewCount < 50 ? C.green : C.red) }}>
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
                );
              })}
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
