'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { C as BASE_C } from '@/lib/design-tokens';

const C = {
  ...BASE_C,
  green: '#16a34a',
  greenBg: 'rgba(22,163,74,0.08)',
  red: '#dc2626',
  redBg: 'rgba(220,38,38,0.07)',
  orange: '#d97706',
};

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface CostcoMemo {
  id: string;
  visitDate: string;       // YYYY-MM-DD
  productName: string;
  costcoPrice: number;     // 코스트코 가격 (원)
  onlineLowest: number;    // 온라인 최저가 (원)
  sellerCount: number;     // 온라인 셀러 수
  memo: string;
  createdAt: string;
}

function calcMargin(costco: number, online: number): number {
  if (!costco || !online) return 0;
  return Math.round(((online - costco) / costco) * 100);
}

function judgeEntry(memo: CostcoMemo): 'enter' | 'skip' | 'unknown' {
  if (!memo.costcoPrice || !memo.onlineLowest) return 'unknown';
  const margin = calcMargin(memo.costcoPrice, memo.onlineLowest);
  return memo.sellerCount <= 3 && margin >= 40 ? 'enter' : 'skip';
}

const STORAGE_KEY = 'plan_costco_memos';

function loadMemos(): CostcoMemo[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as CostcoMemo[]) : [];
  } catch { return []; }
}

function saveMemos(memos: CostcoMemo[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13,
  border: `1px solid ${C.border}`, borderRadius: 7,
  outline: 'none', color: C.text, background: '#fff',
  width: '100%', boxSizing: 'border-box',
};

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function CostcoMemoTab() {
  const [memos, setMemos] = useState<CostcoMemo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    visitDate: todayStr(),
    productName: '',
    costcoPrice: '' as string | number,
    onlineLowest: '' as string | number,
    sellerCount: '' as string | number,
    memo: '',
  });

  useEffect(() => { setMemos(loadMemos()); }, []);

  function handleAdd() {
    if (!form.productName.trim()) return;
    const newMemo: CostcoMemo = {
      id: crypto.randomUUID(),
      visitDate: form.visitDate,
      productName: form.productName.trim(),
      costcoPrice: Number(form.costcoPrice) || 0,
      onlineLowest: Number(form.onlineLowest) || 0,
      sellerCount: Number(form.sellerCount) || 0,
      memo: form.memo.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newMemo, ...memos];
    setMemos(updated);
    saveMemos(updated);
    setForm({ visitDate: todayStr(), productName: '', costcoPrice: '', onlineLowest: '', sellerCount: '', memo: '' });
    setShowForm(false);
  }

  function handleDelete(id: string) {
    const updated = memos.filter((m) => m.id !== id);
    setMemos(updated);
    saveMemos(updated);
  }

  const enterCount = memos.filter((m) => judgeEntry(m) === 'enter').length;

  return (
    <div style={{ padding: '20px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>코스트코 발굴 메모</h2>
          <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
            총 {memos.length}개 기록 · <strong style={{ color: C.green }}>진입 가능 {enterCount}개</strong>
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 700,
            background: C.accent, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
          }}
        >
          <Plus size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          메모 추가
        </button>
      </div>

      {/* 판정 기준 안내 */}
      <div style={{
        background: 'rgba(190,0,20,0.05)', border: `1px solid rgba(190,0,20,0.15)`,
        borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: C.textSub,
      }}>
        ✅ 진입 조건: 온라인 셀러 수 <strong style={{ color: C.text }}>3명 이하</strong> &nbsp;·&nbsp;
        마진율 <strong style={{ color: C.text }}>40% 이상</strong> — 2개 모두 충족
        <span style={{ marginLeft: 12, color: C.orange }}>
          마진율 = (온라인최저가 − 코스트코가격) ÷ 코스트코가격 × 100
        </span>
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 20, marginBottom: 20,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>방문일</label>
              <input style={inputStyle} type="date" value={form.visitDate}
                onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>상품명 *</label>
              <input style={inputStyle} placeholder="예: 코스트코 알래스카 연어 슬라이스 450g"
                value={form.productName}
                onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>코스트코 가격 (원)</label>
              <input style={inputStyle} type="number" placeholder="예: 28900"
                value={form.costcoPrice}
                onChange={(e) => setForm((f) => ({ ...f, costcoPrice: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>온라인 최저가 (원)</label>
              <input style={inputStyle} type="number" placeholder="예: 45000"
                value={form.onlineLowest}
                onChange={(e) => setForm((f) => ({ ...f, onlineLowest: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>온라인 셀러 수</label>
              <input style={inputStyle} type="number" placeholder="예: 2"
                value={form.sellerCount}
                onChange={(e) => setForm((f) => ({ ...f, sellerCount: e.target.value }))} />
            </div>
          </div>
          {/* 실시간 마진 미리보기 */}
          {Number(form.costcoPrice) > 0 && Number(form.onlineLowest) > 0 && (
            <div style={{ marginBottom: 12, fontSize: 13, color: C.textSub }}>
              예상 마진율: <strong style={{ color: calcMargin(Number(form.costcoPrice), Number(form.onlineLowest)) >= 40 ? C.green : C.red }}>
                {calcMargin(Number(form.costcoPrice), Number(form.onlineLowest))}%
              </strong>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>메모</label>
            <input style={inputStyle} placeholder="재입고 주기, 포장 특이사항 등"
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={!form.productName.trim()}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 700,
                background: form.productName.trim() ? C.accent : '#ccc',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: form.productName.trim() ? 'pointer' : 'not-allowed',
              }}
            >저장</button>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '8px 16px', fontSize: 13,
                background: C.bg, color: C.textSub,
                border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >취소</button>
          </div>
        </div>
      )}

      {/* 목록 테이블 */}
      {memos.length > 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f3f3f3', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub, width: 44 }}>판정</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub, width: 90 }}>방문일</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>상품명</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 100 }}>코스트코가</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 100 }}>온라인최저가</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 70 }}>마진율</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 70 }}>셀러 수</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>메모</th>
                <th style={{ padding: '10px 16px', width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {memos.map((m, idx) => {
                const verdict = judgeEntry(m);
                const margin = calcMargin(m.costcoPrice, m.onlineLowest);
                return (
                  <tr key={m.id} style={{
                    background: verdict === 'enter' ? C.greenBg : idx % 2 === 0 ? '#fff' : C.bg,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      {verdict === 'enter' && <CheckCircle size={16} color={C.green} />}
                      {verdict === 'skip' && <XCircle size={16} color={C.red} />}
                      {verdict === 'unknown' && <span style={{ color: C.textSub, fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 16px', color: C.textSub, fontSize: 12 }}>{m.visitDate}</td>
                    <td style={{ padding: '10px 16px', fontWeight: verdict === 'enter' ? 700 : 400, color: C.text }}>{m.productName}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: C.text }}>
                      {m.costcoPrice ? m.costcoPrice.toLocaleString('ko-KR') + '원' : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: C.text }}>
                      {m.onlineLowest ? m.onlineLowest.toLocaleString('ko-KR') + '원' : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: m.costcoPrice && m.onlineLowest ? (margin >= 40 ? C.green : C.red) : C.textSub }}>
                      {m.costcoPrice && m.onlineLowest ? `${margin}%` : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: m.sellerCount === 0 ? C.textSub : (m.sellerCount <= 3 ? C.green : C.red), fontWeight: 700 }}>
                      {m.sellerCount}명
                    </td>
                    <td style={{ padding: '10px 16px', color: C.textSub, fontSize: 12 }}>{m.memo || '—'}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <button onClick={() => handleDelete(m.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.textSub }}>
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
          코스트코 방문 후 발굴 상품을 기록하세요
        </div>
      )}
    </div>
  );
}
