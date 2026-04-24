# 아이템스카우트 키워드 트래커 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이템스카우트에서 조사한 키워드별 월검색량·경쟁수·상위리뷰수를 기록하고, 진입 가능 여부(조건 통과/탈락)를 자동 판정한다.

**Architecture:** SourcingDashboard에 'keywords' 탭을 추가하고 `KeywordTrackerTab` 컴포넌트를 신규 생성한다. 데이터는 localStorage(`plan_keywords`)에 JSON으로 저장한다. 기존 PlanClient의 DailyRecord 패턴을 그대로 따른다.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, localStorage, 인라인 스타일 (기존 C 팔레트)

---

## File Map

| 파일 | 상태 | 역할 |
|---|---|---|
| `src/components/sourcing/KeywordTrackerTab.tsx` | 신규 | 키워드 입력·목록·판정 UI |
| `src/components/sourcing/SourcingDashboard.tsx` | 수정 | 'keywords' 탭 추가 |

---

## Task 1: KeywordTrackerTab 컴포넌트

**Files:**
- Create: `src/components/sourcing/KeywordTrackerTab.tsx`

**판정 기준 (조건 모두 충족해야 통과)**
- 월 검색량: 3,000 이상 30,000 이하
- 경쟁 상품 수: 500 미만
- 상위 리뷰 수: 50 미만

- [ ] **Step 1: 파일 생성**

```tsx
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

  function handleDelete(id: string) {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    saveKeywords(updated);
  }

  const passCount = entries.filter((e) => judgeKeyword(e) === 'pass').length;

  return (
    <div style={{ padding: '20px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>키워드 트래커</h2>
          <p style={{ fontSize: 12, color: C.textSub, margin: '4px 0 0' }}>
            총 {entries.length}개 · 통과 {passCount}개 · 탈락 {entries.length - passCount}개
          </p>
        </div>
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
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.searchVolume >= 3000 && entry.searchVolume <= 30000 ? C.green : C.red }}>
                      {entry.searchVolume ? entry.searchVolume.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.competitorCount && entry.competitorCount < 500 ? C.green : C.red }}>
                      {entry.competitorCount ? entry.competitorCount.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: entry.topReviewCount && entry.topReviewCount < 50 ? C.green : C.red }}>
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
```

- [ ] **Step 2: tsc 확인**

```bash
npx tsc --noEmit 2>&1 | grep "KeywordTrackerTab" | head -10
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/components/sourcing/KeywordTrackerTab.tsx
git commit -m "feat: add KeywordTrackerTab component"
```

---

## Task 2: SourcingDashboard에 keywords 탭 추가

**Files:**
- Modify: `src/components/sourcing/SourcingDashboard.tsx`

- [ ] **Step 1: import 추가**

파일 상단 import 블록에 추가:
```typescript
import KeywordTrackerTab from '@/components/sourcing/KeywordTrackerTab';
```

- [ ] **Step 2: 탭 타입에 'keywords' 추가**

```typescript
// 기존
const [sourcingSubTab, setSourcingSubTab] = useState<'tracking' | 'calculator' | 'niche' | 'costco'>('niche');

// 변경
const [sourcingSubTab, setSourcingSubTab] = useState<'tracking' | 'calculator' | 'niche' | 'costco' | 'keywords'>('niche');
```

- [ ] **Step 3: 탭 목록 배열에 항목 추가**

기존 탭 배열(`{ id: 'niche' ... }`, `{ id: 'tracking' ... }`, ...) 에 추가:
```typescript
{ id: 'keywords' as const, label: '키워드 목록', icon: <Search size={13} /> },
```

- [ ] **Step 4: 탭 콘텐츠 렌더 추가**

기존 `{sourcingSubTab === 'tracking' && <DomeggookTab />}` 아래에 추가:
```tsx
{sourcingSubTab === 'keywords' && <KeywordTrackerTab />}
```

- [ ] **Step 5: 빌드 확인**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully` 또는 `Route (app)` 정상 목록

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/SourcingDashboard.tsx
git commit -m "feat: add 키워드 목록 tab to SourcingDashboard"
```
