# 상품 성과 대시보드 (위너 선별) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록 상품별 CTR·전환율·ROAS·리뷰수를 기록하고, 위너 조건(2주 3건+, ROAS 300%+, 리뷰 3개+)을 자동 판정해 집중 투자 대상을 선별한다.

**Architecture:** PlanClient의 TabId 타입에 'winner' 탭을 추가하고 `WinnerTab` 함수 컴포넌트를 PlanClient.tsx 내부에 추가한다. 데이터는 localStorage(`plan_winner_products`)에 저장한다. 기존 TodayTab / DailyTab / ProgressTab 패턴을 그대로 따른다.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, localStorage, 인라인 스타일

---

## File Map

| 파일 | 상태 | 역할 |
|---|---|---|
| `src/components/plan/PlanClient.tsx` | 수정 | WinnerTab 컴포넌트 추가 + 탭 연결 |

---

## Task 1: WinnerTab 컴포넌트 + 탭 통합

**Files:**
- Modify: `src/components/plan/PlanClient.tsx`

위너 판정 기준:
- 2주 판매수 ≥ 3
- ROAS ≥ 300%
- 리뷰 수 ≥ 3
→ 3개 모두 충족 시 위너

- [ ] **Step 1: 파일 읽기 — TabId 타입과 tabs 배열 위치 확인**

```bash
grep -n "type TabId\|TabId =\|tabs:" src/components/plan/PlanClient.tsx | head -10
```

- [ ] **Step 2: WinnerProduct 타입 + 헬퍼 함수 추가**

PlanClient.tsx에서 `type TabId = 'today' | 'daily' | 'progress';` 바로 위에 아래 코드 삽입:

```typescript
// ─── 위너 선별 타입 ──────────────────────────────────────────────────────────
interface WinnerProduct {
  id: string;
  name: string;
  platform: 'naver' | 'coupang' | 'both';
  sales2w: number;    // 2주 판매 수
  roas: number;       // ROAS (%)
  reviews: number;    // 리뷰 수
  memo: string;
  createdAt: string;
}

function judgeWinner(p: WinnerProduct): boolean {
  return p.sales2w >= 3 && p.roas >= 300 && p.reviews >= 3;
}

const WINNER_STORAGE_KEY = 'plan_winner_products';

function loadWinnerProducts(): WinnerProduct[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(WINNER_STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as WinnerProduct[]) : [];
  } catch { return []; }
}

function saveWinnerProducts(products: WinnerProduct[]): void {
  localStorage.setItem(WINNER_STORAGE_KEY, JSON.stringify(products));
}
```

- [ ] **Step 3: WinnerTab 컴포넌트 추가**

PlanClient.tsx에서 `function ProgressTab()` 바로 위에 삽입:

```tsx
// ─── 위너 선별 탭 ────────────────────────────────────────────────────────────
function WinnerTab() {
  const [products, setProducts] = useState<WinnerProduct[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    platform: 'both' as 'naver' | 'coupang' | 'both',
    sales2w: '' as string | number,
    roas: '' as string | number,
    reviews: '' as string | number,
    memo: '',
  });

  useEffect(() => { setProducts(loadWinnerProducts()); }, []);

  function handleAdd() {
    if (!form.name.trim()) return;
    const p: WinnerProduct = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      platform: form.platform,
      sales2w: Number(form.sales2w) || 0,
      roas: Number(form.roas) || 0,
      reviews: Number(form.reviews) || 0,
      memo: form.memo.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [p, ...products];
    setProducts(updated);
    saveWinnerProducts(updated);
    setForm({ name: '', platform: 'both', sales2w: '', roas: '', reviews: '', memo: '' });
    setShowForm(false);
  }

  function handleDelete(id: string) {
    const updated = products.filter((p) => p.id !== id);
    setProducts(updated);
    saveWinnerProducts(updated);
  }

  const winnerCount = products.filter(judgeWinner).length;

  const inputSt: React.CSSProperties = {
    padding: '7px 10px', fontSize: 13,
    border: `1px solid ${C.border}`, borderRadius: 7,
    outline: 'none', color: C.text, background: '#fff',
    width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ padding: '4px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>
            총 {products.length}개 등록 · <strong style={{ color: C.green }}>위너 {winnerCount}개</strong>
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            padding: '7px 14px', fontSize: 13, fontWeight: 700,
            background: C.accent, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
          }}
        >
          + 상품 추가
        </button>
      </div>

      {/* 위너 조건 안내 */}
      <div style={{
        background: C.accentBg, border: `1px solid ${C.accentBorder}`,
        borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: C.textSub,
      }}>
        🏆 위너 조건: <strong style={{ color: C.text }}>2주 판매 3건+</strong> &nbsp;·&nbsp;
        <strong style={{ color: C.text }}>ROAS 300%+</strong> &nbsp;·&nbsp;
        <strong style={{ color: C.text }}>리뷰 3개+</strong> — 3개 모두 충족
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <div style={{
          background: '#fff', border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 20, marginBottom: 20,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>상품명 *</label>
              <input style={inputSt} placeholder="예: 방수 백팩 직장인" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>플랫폼</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.platform}
                onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value as 'naver' | 'coupang' | 'both' }))}>
                <option value="both">스마트스토어 + 쿠팡</option>
                <option value="naver">스마트스토어</option>
                <option value="coupang">쿠팡</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>2주 판매수</label>
              <input style={inputSt} type="number" placeholder="예: 5" value={form.sales2w}
                onChange={(e) => setForm((f) => ({ ...f, sales2w: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>ROAS (%)</label>
              <input style={inputSt} type="number" placeholder="예: 420" value={form.roas}
                onChange={(e) => setForm((f) => ({ ...f, roas: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>리뷰 수</label>
              <input style={inputSt} type="number" placeholder="예: 8" value={form.reviews}
                onChange={(e) => setForm((f) => ({ ...f, reviews: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>메모</label>
            <input style={inputSt} placeholder="다음 액션 메모" value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={!form.name.trim()}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 700,
                background: form.name.trim() ? C.accent : '#ccc',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: form.name.trim() ? 'pointer' : 'not-allowed',
              }}
            >저장</button>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '7px 14px', fontSize: 13,
                background: C.bg, color: C.textSub,
                border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >취소</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      {products.length > 0 ? (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f3f3f3', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub, width: 44 }}>위너</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>상품명</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 90 }}>플랫폼</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 80 }}>2주 판매</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 80 }}>ROAS</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 70 }}>리뷰</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>메모</th>
                <th style={{ padding: '10px 16px', width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, idx) => {
                const isWinner = judgeWinner(p);
                return (
                  <tr key={p.id} style={{
                    background: isWinner ? 'rgba(22,163,74,0.05)' : idx % 2 === 0 ? '#fff' : C.bg,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    <td style={{ padding: '10px 16px', textAlign: 'center', fontSize: 16 }}>
                      {isWinner ? '🏆' : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', fontWeight: isWinner ? 700 : 400, color: C.text }}>{p.name}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, color: C.textSub }}>
                      {p.platform === 'both' ? '스토어+쿠팡' : p.platform === 'naver' ? '스마트스토어' : '쿠팡'}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: p.sales2w >= 3 ? C.green : C.text, fontWeight: p.sales2w >= 3 ? 700 : 400 }}>
                      {p.sales2w}건
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: p.roas >= 300 ? C.green : C.text, fontWeight: p.roas >= 300 ? 700 : 400 }}>
                      {p.roas}%
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: p.reviews >= 3 ? C.green : C.text, fontWeight: p.reviews >= 3 ? 700 : 400 }}>
                      {p.reviews}개
                    </td>
                    <td style={{ padding: '10px 16px', color: C.textSub, fontSize: 12 }}>{p.memo || '—'}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <button onClick={() => handleDelete(p.id)}
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
          Week 3~4에 상품 데이터가 쌓이면 여기에 입력하세요
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: TabId에 'winner' 추가**

```typescript
// 기존
type TabId = 'today' | 'daily' | 'progress';

// 변경
type TabId = 'today' | 'daily' | 'progress' | 'winner';
```

- [ ] **Step 5: tabs 배열에 위너 탭 항목 추가**

기존 tabs 배열 마지막에 추가:
```typescript
{ id: 'winner' as const, label: '위너 선별', icon: <Target size={15} /> },
```

(`Target` 아이콘이 이미 import되어 있음. 없으면 import 추가)

- [ ] **Step 6: 탭 콘텐츠 렌더에 추가**

기존 `{activeTab === 'progress' && <ProgressTab />}` 아래에:
```tsx
{activeTab === 'winner' && <WinnerTab />}
```

- [ ] **Step 7: Trash2 import 확인**

`Trash2`가 lucide-react에서 import되어 있는지 확인. 없으면 추가:
```typescript
import { CheckSquare, Square, Target, TrendingUp, ClipboardList, AlertTriangle, ChevronRight, Save, Calendar, BarChart2, Zap, Trash2 } from 'lucide-react';
```

- [ ] **Step 8: C 색상 상수에 green 추가 확인**

PlanClient.tsx의 `const C` 객체에 `green: '#16a34a'`가 있는지 확인. 없으면 추가.

- [ ] **Step 9: 빌드 확인**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully`

- [ ] **Step 10: 커밋**

```bash
git add src/components/plan/PlanClient.tsx
git commit -m "feat: add 위너 선별 tab to PlanClient"
```
