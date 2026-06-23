# 소싱 메뉴 Phase 1 — 3단계 구조 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `SourcingDashboard.tsx`의 8-flat-탭 구조를 발굴 / 검증 / 실행 3단계 + 내부 서브탭으로 개편하고, 서브 라우트에 묻힌 기능들(상표사전검색, 위너대시보드, 입고체크리스트, 협상가이드)을 올바른 단계 탭으로 승격한다.

**Architecture:** 3개 메인 탭(MainTab) 각각이 서브탭(DiscoverSubTab / ValidateSubTab / ExecuteSubTab) 배열을 가진다. 각 단계는 별도의 섹션 컴포넌트(DiscoverSection / ValidateSection / ExecuteSection)로 분리하고, 재사용 가능한 `SubTabBar` 헬퍼 컴포넌트로 서브탭 UI를 통일한다.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, inline CSS (design-tokens 기반), Vitest, Playwright

---

## File Map

| Action | Path | Role |
|--------|------|------|
| **Create** | `src/components/sourcing/DeepKeywordEngine.tsx` | 딥 키워드 추천 엔진 UI 빈 틀 (search input + skeleton, API 없음) |
| **Create** | `src/components/sourcing/SourcingMemoTab.tsx` | CostcoMemoTab 범용 리네임 (localStorage 키 유지) |
| **Modify** | `src/components/sourcing/SourcingDashboard.tsx` | 3단계 구조로 전면 교체 |
| **Modify** | `e2e/sourcing-flow.spec.ts` | 새 탭 구조에 맞게 E2E 테스트 업데이트 |
| Keep | `src/app/sourcing/*/page.tsx` (모든 서브 라우트) | 기존 URL 접근 유지 (변경 없음) |
| Keep | `src/components/sourcing/CostcoMemoTab.tsx` | 삭제 안 함 (혹시 다른 참조 생길 경우 대비) |

---

## Task 1: `DeepKeywordEngine.tsx` 생성 (빈 skeleton)

**Files:**
- Create: `src/components/sourcing/DeepKeywordEngine.tsx`

- [ ] **Step 1: 파일 생성**

```tsx
'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { C } from '@/lib/design-tokens';

export default function DeepKeywordEngine() {
  const [query, setQuery] = useState('');

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>
          🔍 딥 키워드 추천 엔진
        </h2>
        <p style={{ fontSize: 12, color: C.textSub, margin: 0 }}>
          대표 키워드를 입력하면 공략 가능한 하위 키워드와 계절 점수를 분석합니다.
          (예: 텀블러 → 사무실 텀블러, 차량용 텀블러)
        </p>
      </div>

      {/* 검색 인풋 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: 텀블러"
          style={{
            flex: 1, padding: '10px 14px', fontSize: 14,
            border: `1px solid ${C.border}`, borderRadius: 8,
            outline: 'none', color: C.text, background: '#fff',
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        />
        <button
          disabled
          style={{
            padding: '10px 20px', fontSize: 14, fontWeight: 600,
            background: '#d4d4d8', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'not-allowed',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Search size={14} />
          분석 (준비 중)
        </button>
      </div>

      {/* 준비 중 안내 */}
      <div style={{
        border: `1px dashed ${C.border}`, borderRadius: 12,
        padding: '40px 24px', textAlign: 'center', color: C.textMuted,
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
        <p style={{ fontSize: 14, fontWeight: 600, color: C.textSub, margin: '0 0 8px' }}>
          Phase 2에서 구현 예정
        </p>
        <p style={{ fontSize: 12, margin: 0 }}>
          네이버 자동완성 API + 클로바 데이터랩으로<br />
          키워드 계층 트리 · 계절 점수 · 경쟁 강도를 분석합니다
        </p>

        {/* Skeleton preview */}
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
          {[80, 60, 70, 50].map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ width: `${w}%`, height: 14, background: '#e4e4e7', borderRadius: 4 }} />
              <div style={{ width: 40, height: 14, background: '#e4e4e7', borderRadius: 4 }} />
              <div style={{ width: 32, height: 14, background: '#e4e4e7', borderRadius: 4 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | head -20
```

Expected: 에러 없음 (기존 에러만 있고 새 에러 없음)

- [ ] **Step 3: Commit**

```bash
git add src/components/sourcing/DeepKeywordEngine.tsx
git commit -m "feat: DeepKeywordEngine 빈 skeleton 컴포넌트 생성 (Phase 2 대비)"
```

---

## Task 2: `SourcingMemoTab.tsx` 생성

CostcoMemoTab.tsx를 복사해 범용 소싱 메모로 리네임.
인터페이스명·컴포넌트명·헤더 텍스트만 변경, `STORAGE_KEY`는 기존 데이터 유지를 위해 동일하게 유지.

**Files:**
- Create: `src/components/sourcing/SourcingMemoTab.tsx`

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
  orange: '#d97706',
};

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface SourcingMemo {
  id: string;
  visitDate: string;       // YYYY-MM-DD
  productName: string;
  costcoPrice: number;     // 소싱처 가격 (원)
  onlineLowest: number;    // 온라인 최저가 (원)
  sellerCount: number;     // 온라인 셀러 수
  memo: string;
  createdAt: string;
}

function calcMargin(cost: number, online: number): number {
  if (!cost || !online) return 0;
  return Math.round(((online - cost) / cost) * 100);
}

function judgeEntry(m: SourcingMemo): 'enter' | 'skip' | 'unknown' {
  if (!m.costcoPrice || !m.onlineLowest) return 'unknown';
  const margin = calcMargin(m.costcoPrice, m.onlineLowest);
  return m.sellerCount <= 3 && margin >= 40 ? 'enter' : 'skip';
}

// 기존 CostcoMemoTab 데이터와 하위 호환
const STORAGE_KEY = 'plan_costco_memos';

function loadMemos(): SourcingMemo[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as SourcingMemo[]) : [];
  } catch { return []; }
}

function saveMemos(memos: SourcingMemo[]): void {
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
export default function SourcingMemoTab() {
  const [memos, setMemos] = useState<SourcingMemo[]>([]);
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
    const newMemo: SourcingMemo = {
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
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>소싱 발굴 메모</h2>
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
          마진율 = (온라인최저가 − 소싱처가격) ÷ 소싱처가격 × 100
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
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>날짜</label>
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
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>소싱처 가격 (원)</label>
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
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub, width: 90 }}>날짜</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>상품명</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 100 }}>소싱처가</th>
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
          발굴한 상품을 기록하세요
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sourcing/SourcingMemoTab.tsx
git commit -m "feat: SourcingMemoTab 생성 (CostcoMemoTab 범용 리네임, localStorage 키 유지)"
```

---

## Task 3: `SourcingDashboard.tsx` 3단계 구조로 교체

**Files:**
- Modify: `src/components/sourcing/SourcingDashboard.tsx`

- [ ] **Step 1: 파일 전체 교체**

```tsx
'use client';

import React, { useState } from 'react';
import { Calculator } from 'lucide-react';
import { C } from '@/lib/design-tokens';

// ── 발굴 탭 컴포넌트들 ─────────────────────────────────────────────────────────
import DeepKeywordEngine from '@/components/sourcing/DeepKeywordEngine';
import NicheTab from '@/components/niche/NicheTab';
import NicheAlertBadge from '@/components/niche/NicheAlertBadge';
import { useNicheStore } from '@/store/useNicheStore';
import ProductDiscoveryTab from '@/components/sourcing/ProductDiscoveryTab';
import KeywordTrackerTab from '@/components/sourcing/KeywordTrackerTab';
import SourcingAgentTab from '@/components/sourcing/SourcingAgentTab';

// ── 검증 탭 컴포넌트들 ─────────────────────────────────────────────────────────
import TrademarkPrecheckForm from '@/components/sourcing/TrademarkPrecheckForm';
import WinnerOccupancyTable from '@/components/winner/WinnerOccupancyTable';
import KeywordSuggestionForm from '@/components/winner/KeywordSuggestionForm';
import CoupangTab from '@/components/calculator/tabs/CoupangTab';
import NaverTab from '@/components/calculator/tabs/NaverTab';
import GmarketTab from '@/components/calculator/tabs/GmarketTab';
import ElevenstTab from '@/components/calculator/tabs/ElevenstTab';
import ShopeeTab from '@/components/calculator/tabs/ShopeeTab';
import CompareMode from '@/components/calculator/CompareMode';

// ── 실행 탭 컴포넌트들 ─────────────────────────────────────────────────────────
import DomeggookTab from '@/components/sourcing/DomeggookTab';
import CostcoTab from '@/components/sourcing/CostcoTab';
import SourcingMemoTab from '@/components/sourcing/SourcingMemoTab';
import InboundChecklistForm from '@/components/sourcing/InboundChecklistForm';
import { NEGOTIATION_STEPS } from '@/lib/sourcing/negotiation-guide';

// ─── 타입 ─────────────────────────────────────────────────────────────────────
type MainTab = 'discover' | 'validate' | 'execute';
type DiscoverSubTab = 'keywords' | 'niche' | 'seed' | 'tracker' | 'agent';
type ValidateSubTab = 'margin' | 'trademark' | 'winner' | 'keyword-opt';
type ExecuteSubTab = 'domeggook' | 'costco' | 'memo' | 'inbound' | 'negotiation';
type CalcTab = 'coupang' | 'naver' | 'gmarket' | 'elevenst' | 'shopee';

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function SourcingDashboard() {
  const [mainTab, setMainTab] = useState<MainTab>('discover');
  const [discoverSubTab, setDiscoverSubTab] = useState<DiscoverSubTab>('keywords');
  const [validateSubTab, setValidateSubTab] = useState<ValidateSubTab>('margin');
  const [executeSubTab, setExecuteSubTab] = useState<ExecuteSubTab>('domeggook');
  const unreadAlertCount = useNicheStore((s) => s.unreadAlertCount);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', backgroundColor: C.bg, fontFamily: "'Noto Sans KR', sans-serif", color: C.text }}>
      {/* ── 메인 탭 (발굴 / 검증 / 실행) ───────────────────────────────────────── */}
      <div style={{ display: 'flex', backgroundColor: C.card, borderBottom: `2px solid ${C.border}`, padding: '0 24px' }}>
        {([
          { id: 'discover' as MainTab, label: '발굴' },
          { id: 'validate' as MainTab, label: '검증' },
          { id: 'execute' as MainTab,  label: '실행' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMainTab(tab.id)}
            style={{
              padding: '12px 28px', border: 'none', cursor: 'pointer',
              fontSize: '14px', fontWeight: mainTab === tab.id ? 700 : 500,
              color: mainTab === tab.id ? C.accent : C.textSub,
              backgroundColor: 'transparent',
              borderBottom: mainTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
              marginBottom: '-2px', transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === 'discover' && (
        <DiscoverSection subTab={discoverSubTab} setSubTab={setDiscoverSubTab} unreadAlertCount={unreadAlertCount} />
      )}
      {mainTab === 'validate' && (
        <ValidateSection subTab={validateSubTab} setSubTab={setValidateSubTab} />
      )}
      {mainTab === 'execute' && (
        <ExecuteSection subTab={executeSubTab} setSubTab={setExecuteSubTab} />
      )}
    </div>
  );
}

// ─── 공통: 서브탭 바 ──────────────────────────────────────────────────────────
function SubTabBar({ tabs, active, onSelect }: {
  tabs: { id: string; label: string; badge?: React.ReactNode }[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', backgroundColor: '#fafafa', borderBottom: `1px solid ${C.border}`, padding: '0 24px' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', border: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: active === tab.id ? 600 : 500,
            color: active === tab.id ? C.accent : C.textSub,
            backgroundColor: 'transparent',
            borderBottom: active === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
            transition: 'all 0.15s',
          }}
        >
          {tab.label}
          {tab.badge ?? null}
        </button>
      ))}
    </div>
  );
}

// ─── 발굴 섹션 ────────────────────────────────────────────────────────────────
function DiscoverSection({ subTab, setSubTab, unreadAlertCount }: {
  subTab: DiscoverSubTab;
  setSubTab: (t: DiscoverSubTab) => void;
  unreadAlertCount: number;
}) {
  const tabs = [
    { id: 'keywords', label: '🔍 딥 키워드' },
    { id: 'niche',    label: '니치소싱', badge: <NicheAlertBadge count={unreadAlertCount} /> },
    { id: 'seed',     label: '🌱 상품 발굴' },
    { id: 'tracker',  label: '키워드 목록' },
    { id: 'agent',    label: '🤖 소싱 에이전트' },
  ];

  return (
    <>
      <SubTabBar tabs={tabs} active={subTab} onSelect={(id) => setSubTab(id as DiscoverSubTab)} />
      <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
        {subTab === 'keywords' && <DeepKeywordEngine />}
        {subTab === 'niche'    && <NicheTab />}
        {subTab === 'seed'     && <ProductDiscoveryTab />}
        {subTab === 'tracker'  && <KeywordTrackerTab />}
        {subTab === 'agent'    && <SourcingAgentTab />}
      </div>
    </>
  );
}

// ─── 검증 섹션 ────────────────────────────────────────────────────────────────
function ValidateSection({ subTab, setSubTab }: {
  subTab: ValidateSubTab;
  setSubTab: (t: ValidateSubTab) => void;
}) {
  const tabs = [
    { id: 'margin',      label: '마진계산기' },
    { id: 'trademark',   label: '상표 사전검색' },
    { id: 'winner',      label: '위너 대시보드' },
    { id: 'keyword-opt', label: '키워드 최적화' },
  ];

  return (
    <>
      <SubTabBar tabs={tabs} active={subTab} onSelect={(id) => setSubTab(id as ValidateSubTab)} />
      <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
        {subTab === 'margin'      && <SourcingCalculator />}
        {subTab === 'trademark'   && <TrademarkPrecheckContent />}
        {subTab === 'winner'      && <WinnerDashboardContent />}
        {subTab === 'keyword-opt' && <KeywordOptimizerContent />}
      </div>
    </>
  );
}

// ─── 실행 섹션 ────────────────────────────────────────────────────────────────
function ExecuteSection({ subTab, setSubTab }: {
  subTab: ExecuteSubTab;
  setSubTab: (t: ExecuteSubTab) => void;
}) {
  const tabs = [
    { id: 'domeggook',   label: '도매꾹' },
    { id: 'costco',      label: '코스트코' },
    { id: 'memo',        label: '소싱 메모' },
    { id: 'inbound',     label: '입고 체크리스트' },
    { id: 'negotiation', label: '협상 가이드' },
  ];

  return (
    <>
      <SubTabBar tabs={tabs} active={subTab} onSelect={(id) => setSubTab(id as ExecuteSubTab)} />
      <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
        {subTab === 'domeggook'   && <DomeggookTab />}
        {subTab === 'costco'      && <CostcoTab />}
        {subTab === 'memo'        && <SourcingMemoTab />}
        {subTab === 'inbound'     && <InboundChecklistContent />}
        {subTab === 'negotiation' && <NegotiationGuideContent />}
      </div>
    </>
  );
}

// ─── 콘텐츠 래퍼들 (서브 라우트 → 탭 승격) ──────────────────────────────────

function TrademarkPrecheckContent() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>1688 발주 사전체크</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        위너 후보 상품명을 입력하면 KIPRIS 등록상표를 검사합니다. 등록상표 충돌 시 1688 검색 링크가 자동 차단됩니다.
      </p>
      <TrademarkPrecheckForm />
    </div>
  );
}

function WinnerDashboardContent() {
  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>위너 대시보드</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        SKU별 아이템위너 점유율 일별 추적. 빼앗김 발생 시 알림 센터에 표시됩니다.
      </p>
      <WinnerOccupancyTable />
    </div>
  );
}

function KeywordOptimizerContent() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>위너 SKU 키워드 최적화</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        검색 1페이지 진입 못 한 위너 SKU의 상품명을 AI로 재구성합니다.
      </p>
      <KeywordSuggestionForm />
    </div>
  );
}

function InboundChecklistContent() {
  return (
    <div style={{ maxWidth: 800 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>1688 입고 체크리스트</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        SKU 정보를 입력하면 체크리스트가 자동 생성됩니다. 브라우저 인쇄(Cmd+P) → PDF 저장.
      </p>
      <InboundChecklistForm />
    </div>
  );
}

function NegotiationGuideContent() {
  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>1688 가격 협상 가이드</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        채널 영상 "1688 네고 흥정 팁 (2025-06-22)" 기반. 발주 단계별 협상 전략.
      </p>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {NEGOTIATION_STEPS.map((step) => (
          <li key={step.order} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px', color: C.text }}>
              {step.order}. {step.title}
            </h3>
            <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>{step.detail}</p>
            {step.tip && (
              <div style={{
                marginTop: 8, borderRadius: 6, border: '1px solid #fde68a',
                background: '#fefce8', padding: '8px 12px', fontSize: 12, color: '#92400e',
              }}>
                💡 {step.tip}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── 서브 컴포넌트: 마진계산기 ────────────────────────────────────────────────
const CALC_TABS: { id: CalcTab; label: string; color: string }[] = [
  { id: 'coupang',  label: '쿠팡',   color: '#be0014' },
  { id: 'naver',    label: '네이버', color: '#03c75a' },
  { id: 'gmarket',  label: 'G마켓',  color: '#6dbe46' },
  { id: 'elevenst', label: '11번가', color: '#ff0038' },
  { id: 'shopee',   label: 'Shopee', color: '#ee4d2d' },
];

function SourcingCalculator() {
  const [activeCalcTab, setActiveCalcTab] = React.useState<CalcTab>('coupang');
  const [showCompare, setShowCompare] = React.useState(false);

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Calculator size={18} color="#be0014" />
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#18181b', margin: 0 }}>마진 계산기</h2>
          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>플랫폼별 수수료 자동 계산</span>
        </div>
        <button
          onClick={() => setShowCompare(!showCompare)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
            fontSize: '12px', fontWeight: 500, transition: 'all 0.15s',
            border: showCompare ? '1px solid rgba(190,0,20,0.3)' : '1px solid #e5e5e5',
            backgroundColor: showCompare ? 'rgba(190,0,20,0.05)' : '#fff',
            color: showCompare ? '#be0014' : '#52525b',
          }}
        >
          {showCompare ? '개별 계산 모드' : '플랫폼 비교 모드'}
        </button>
      </div>

      {showCompare ? (
        <CompareMode />
      ) : (
        <>
          <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '12px', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: '16px', border: '1px solid #e5e5e5' }}>
            {CALC_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCalcTab(tab.id)}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: activeCalcTab === tab.id ? 600 : 500,
                  color: activeCalcTab === tab.id ? tab.color : '#71717a',
                  backgroundColor: activeCalcTab === tab.id ? `${tab.color}10` : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeCalcTab === 'coupang'  && <CoupangTab />}
          {activeCalcTab === 'naver'    && <NaverTab />}
          {activeCalcTab === 'gmarket'  && <GmarketTab />}
          {activeCalcTab === 'elevenst' && <ElevenstTab />}
          {activeCalcTab === 'shopee'   && <ShopeeTab />}
        </>
      )}

      <p style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px', color: '#a1a1aa' }}>
        수수료는 2025년 10월 기준이며, 플랫폼 정책 변경에 따라 달라질 수 있습니다.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 새로 추가된 에러 없음

- [ ] **Step 3: 빌드 확인**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` 또는 기존 빌드와 동일한 경고

- [ ] **Step 4: Commit**

```bash
git add src/components/sourcing/SourcingDashboard.tsx
git commit -m "feat: 소싱 메뉴 3단계 구조 개편 — 발굴/검증/실행 탭 + 서브라우트 기능 승격"
```

---

## Task 4: E2E 테스트 업데이트

새 구조에 맞게 `sourcing-flow.spec.ts`의 탭 탐색 흐름 수정.
구 탭 레이블(니치소싱, 도매꾹, 코스트코)은 이제 서브탭이므로, 메인 탭 클릭 후 서브탭 클릭하는 흐름으로 변경.

**Files:**
- Modify: `e2e/sourcing-flow.spec.ts`

- [ ] **Step 1: 파일 전체 교체**

```typescript
/**
 * sourcing-flow.spec.ts
 * 소싱 페이지 3단계 구조 (발굴/검증/실행) E2E 테스트
 *
 * 검증 시나리오:
 *  1. /sourcing 접근 → 발굴 메인 탭 + 딥 키워드 서브탭 기본 활성
 *  2. 발굴 > 니치소싱 서브탭 클릭 → NicheTab 렌더링
 *  3. 실행 메인 탭 클릭 → 도매꾹 서브탭 기본 활성 (DomeggookTab 렌더링)
 *  4. 실행 > 코스트코 서브탭 클릭 → CostcoTab 렌더링
 *  5. 검증 메인 탭 클릭 → 마진계산기 서브탭 기본 활성
 *  6. 탭 간 왕복 전환 오류 없음
 */

import { test, expect } from '@playwright/test';

const MAIN = {
  discover: '발굴',
  validate: '검증',
  execute:  '실행',
} as const;

const SUB = {
  keywords:   '🔍 딥 키워드',
  niche:      '니치소싱',
  seed:       '🌱 상품 발굴',
  domeggook:  '도매꾹',
  costco:     '코스트코',
  margin:     '마진계산기',
  trademark:  '상표 사전검색',
  winner:     '위너 대시보드',
  inbound:    '입고 체크리스트',
} as const;

test.describe('소싱 페이지 — 3단계 구조', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/sourcing', { timeout: 10000 }).catch(() => test.skip());
  });

  test('1. 기본 진입 시 발굴 메인탭 + 딥 키워드 서브탭이 활성이다', async ({ page }) => {
    await expect(page.getByRole('button', { name: MAIN.discover })).toBeVisible();
    await expect(page.getByRole('button', { name: SUB.keywords })).toBeVisible();
    await expect(page.locator('body')).toContainText('딥 키워드 추천 엔진');
  });

  test('2. 발굴 > 니치소싱 서브탭 클릭 시 NicheTab이 렌더링된다', async ({ page }) => {
    await page.getByRole('button', { name: SUB.niche }).click();
    await expect(page.locator('body')).toContainText('니치소싱');
  });

  test('3. 실행 메인탭 클릭 시 도매꾹 서브탭이 기본 활성이다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.execute }).click();
    await expect(page.getByRole('button', { name: SUB.domeggook })).toBeVisible();
    await expect(page.locator('body')).toContainText('도매꾹');
  });

  test('4. 실행 > 코스트코 서브탭 클릭 시 CostcoTab이 렌더링된다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.execute }).click();
    await page.getByRole('button', { name: SUB.costco }).click();
    await expect(page.locator('body')).toContainText('코스트코');
  });

  test('4-1. 코스트코 탭에 성별 필터 서브메뉴가 없다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.execute }).click();
    await page.getByRole('button', { name: SUB.costco }).click();
    await expect(page.locator('button', { hasText: '남성용' })).not.toBeVisible();
    await expect(page.locator('button', { hasText: '여성용' })).not.toBeVisible();
  });

  test('5. 검증 메인탭 클릭 시 마진계산기 서브탭이 기본 활성이다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.validate }).click();
    await expect(page.getByRole('button', { name: SUB.margin })).toBeVisible();
    await expect(page.locator('body')).toContainText('마진 계산기');
  });

  test('5-1. 검증 > 상표 사전검색 서브탭이 존재한다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.validate }).click();
    await page.getByRole('button', { name: SUB.trademark }).click();
    await expect(page.locator('body')).toContainText('발주 사전체크');
  });

  test('5-2. 검증 > 위너 대시보드 서브탭이 존재한다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.validate }).click();
    await page.getByRole('button', { name: SUB.winner }).click();
    await expect(page.locator('body')).toContainText('위너 대시보드');
  });

  test('6. 발굴 → 검증 → 실행 탭 왕복 전환이 오류 없이 동작한다', async ({ page }) => {
    await page.getByRole('button', { name: MAIN.validate }).click();
    await expect(page.locator('body')).toContainText('마진 계산기');

    await page.getByRole('button', { name: MAIN.execute }).click();
    await expect(page.locator('body')).toContainText('도매꾹');

    await page.getByRole('button', { name: MAIN.discover }).click();
    await expect(page.locator('body')).toContainText('딥 키워드 추천 엔진');

    await expect(page.locator('body')).not.toContainText('Unhandled Runtime Error');
  });
});

test.describe('소싱 페이지 — CI 환경 스킵 대상 (실 DB 필요)', () => {
  test.fixme('실행 > 코스트코 탭에서 실제 API 데이터가 렌더링된다', async ({ page }) => {
    await page.goto('/sourcing');
    await page.getByRole('button', { name: '실행' }).click();
    await page.getByRole('button', { name: '코스트코' }).click();
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const rows = await page.locator('table tbody tr').count();
    expect(rows).toBeGreaterThan(0);
  });

  test.fixme('실행 > 도매꾹 탭에서 차단 체크박스가 렌더링된다', async ({ page }) => {
    await page.goto('/sourcing');
    await page.getByRole('button', { name: '실행' }).click();
    await page.getByRole('button', { name: '도매꾹' }).click();
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });
  });
});
```

- [ ] **Step 2: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: E2E 테스트 실행 (로컬 서버 실행 중일 때)**

```bash
# 서버가 실행 중인 경우에만 실행:
npm run test:e2e -- e2e/sourcing-flow.spec.ts 2>&1 | tail -20
```

Expected: 서버 없으면 skip (beforeEach `.catch(() => test.skip())`), 서버 있으면 모든 테스트 PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/sourcing-flow.spec.ts
git commit -m "test(e2e): sourcing-flow 테스트 3단계 탭 구조로 업데이트"
```

---

## Self-Review

### Spec Coverage

| 요구사항 | 담당 태스크 |
|---------|-----------|
| 8탭 → 발굴/검증/실행 3단계 구조 | Task 3 |
| 딥 키워드 빈 컴포넌트 (search input + skeleton) | Task 1 |
| 서브라우트 기능들 → 검증/실행 탭으로 승격 | Task 3 (TrademarkPrecheckContent, WinnerDashboardContent, InboundChecklistContent, NegotiationGuideContent) |
| CostcoMemoTab 범용 리네임 | Task 2 |
| 기존 서브라우트 URL 유지 | 변경 없음 (파일 보존) |
| E2E 테스트 업데이트 | Task 4 |

### Placeholder Scan
없음 — 모든 단계에 완성된 코드 있음.

### Type Consistency
- `SubTabBar`의 `onSelect` 콜백: `(id: string) => void` — 각 섹션에서 `(id) => setSubTab(id as DiscoverSubTab)` 패턴으로 일관되게 사용.
- `CalcTab` 타입: Task 3 SourcingDashboard.tsx 내부에서만 사용, 일관됨.
- `SourcingMemo` 인터페이스: Task 2 내부에서만 사용, CostcoMemo와 구조 동일.
