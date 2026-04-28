'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  CheckSquare,
  Square,
  Target,
  TrendingUp,
  ClipboardList,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Save,
  Calendar,
  BarChart2,
  Zap,
  Trash2,
  Search,
  Plus,
} from 'lucide-react';
import { C as BASE_C } from '@/lib/design-tokens';
import {
  WBS_DATA,
  WEEKLY_TARGETS,
} from '@/lib/plan/constants';
import {
  getCurrentWeek,
  getWeekForDate,
} from '@/lib/plan/week';
import {
  loadDailyRecords,
  saveDailyRecords,
  type DailyRecord,
} from '@/lib/plan/daily-records';

// ─── 색상 상수 ──────────────────────────────────────────────────
const C = {
  ...BASE_C,
  bg: '#f5f5f7',
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  textMuted: '#a1a1aa',
  accentBg: 'rgba(190,0,20,0.07)',
  accentBorder: 'rgba(190,0,20,0.20)',
  green: '#16a34a',
  greenBg: 'rgba(22,163,74,0.08)',
  greenBorder: 'rgba(22,163,74,0.20)',
  yellow: '#d97706',
  yellowBg: 'rgba(217,119,6,0.08)',
  yellowBorder: 'rgba(217,119,6,0.20)',
  blue: '#2563eb',
  blueBg: 'rgba(37,99,235,0.07)',
  blueBorder: 'rgba(37,99,235,0.20)',
} as const;

// ─── 네비게이션 ─────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
];

// ─── 위너 선별 타입 ──────────────────────────────────────────────────────────
interface WinnerProduct {
  id: string;
  name: string;
  platform: 'naver' | 'coupang' | 'both';
  sales2w: number;
  roas: number;
  reviews: number;
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
  if (typeof window === 'undefined') return;
  localStorage.setItem(WINNER_STORAGE_KEY, JSON.stringify(products));
}

// ─── 유틸: 오늘 날짜 문자열 ─────────────────────────────────────
function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── localStorage 헬퍼 ──────────────────────────────────────────
function loadTaskChecks(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('plan_wbs_tasks');
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveTaskChecks(data: Record<string, boolean>): void {
  localStorage.setItem('plan_wbs_tasks', JSON.stringify(data));
}

// ─── 난이도 헬퍼 ────────────────────────────────────────────────
const DIFFICULTY_COLORS = ['#16A34A', '#65A30D', '#CA8A04', '#EA580C', '#DC2626'];

function difficultyColor(d: 1 | 2 | 3 | 4 | 5): string {
  return DIFFICULTY_COLORS[d - 1];
}

function renderStars(d: 1 | 2 | 3 | 4 | 5): string {
  return '⭐'.repeat(d);
}

// ─── 탭 A: 오늘 할 일 ───────────────────────────────────────────
function TodayTab() {
  const currentWeek = useMemo(() => getCurrentWeek(), []);
  const weekData = WBS_DATA[currentWeek];
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    setChecks(loadTaskChecks());
    setMounted(true);
  }, []);

  function toggleTask(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    saveTaskChecks(next);
  }

  const completedCount = useMemo(
    () => weekData.tasks.filter((t) => checks[t.id]).length,
    [checks, weekData.tasks]
  );
  const totalCount = weekData.tasks.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // 오늘의 핵심 미션: 첫 번째 미완료 태스크
  const keyMission = useMemo(
    () => weekData.tasks.find((t) => !checks[t.id]) ?? weekData.tasks[0],
    [checks, weekData.tasks]
  );

  if (!mounted) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 주차 헤더 */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span
              style={{
                background: C.accent,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 10px',
                borderRadius: 20,
                letterSpacing: 0.5,
              }}
            >
              {currentWeek}주차
            </span>
            <span style={{ color: C.textSub, fontSize: 13 }}>
              {currentWeek}주차 / 12주차
            </span>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>
            {weekData.title}
          </h2>
          <p style={{ color: C.textSub, fontSize: 14, margin: '4px 0 0' }}>
            목표: {weekData.goal} &nbsp;|&nbsp; 매출 목표: {weekData.revenueTarget}
          </p>
        </div>
        {/* 진행률 */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.accent }}>
            {progressPct}%
          </div>
          <div style={{ fontSize: 12, color: C.textSub }}>
            {completedCount}/{totalCount} 완료
          </div>
        </div>
      </div>

      {/* 진행 바 */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '16px 24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: C.textSub,
            marginBottom: 8,
          }}
        >
          <span>이번 주 태스크 진행률</span>
          <span>{completedCount}/{totalCount}</span>
        </div>
        <div
          style={{
            height: 8,
            background: '#eee',
            borderRadius: 99,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: progressPct === 100 ? C.green : C.accent,
              borderRadius: 99,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* 오늘의 핵심 미션 */}
      {keyMission && (
        <div
          style={{
            background: C.accentBg,
            border: `1.5px solid ${C.accentBorder}`,
            borderRadius: 12,
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <Zap size={20} color={C.accent} style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 1, marginBottom: 4 }}>
              오늘의 핵심 미션
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>
              {keyMission.text}
            </div>
          </div>
        </div>
      )}

      {/* 태스크 목록 */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 24px',
            borderBottom: `1px solid ${C.border}`,
            fontSize: 14,
            fontWeight: 600,
            color: C.text,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <ClipboardList size={16} color={C.accent} />
          이번 주 태스크
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {weekData.tasks.map((task, idx) => {
            const done = !!checks[task.id];
            const isExpanded = expandedTasks.has(task.id);
            const hasDetails = !!(task.steps?.length || task.tip || task.videoRef);
            const isLast = idx === weekData.tasks.length - 1;
            return (
              <React.Fragment key={task.id}>
                <li
                  onClick={() => toggleTask(task.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '14px 24px',
                    borderBottom: !isExpanded && !isLast ? `1px solid ${C.border}` : 'none',
                    cursor: 'pointer',
                    background: done ? 'rgba(22,163,74,0.04)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!done) (e.currentTarget as HTMLLIElement).style.background = C.rowHover;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLLIElement).style.background = done
                      ? 'rgba(22,163,74,0.04)'
                      : 'transparent';
                  }}
                >
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    {done ? (
                      <CheckSquare size={18} color={C.green} />
                    ) : (
                      <Square size={18} color={C.textMuted} />
                    )}
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 14,
                        color: done ? C.textMuted : C.text,
                        textDecoration: done ? 'line-through' : 'none',
                        lineHeight: 1.6,
                        flex: 1,
                      }}
                    >
                      {task.text}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: 11,
                          color: difficultyColor(task.difficulty),
                          fontWeight: 600,
                          letterSpacing: -1,
                        }}
                        title={`난이도 ${task.difficulty}/5`}
                      >
                        {renderStars(task.difficulty)}
                      </span>
                      {hasDetails && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(task.id);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 4,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          aria-label={isExpanded ? '접기' : '펼치기'}
                        >
                          {isExpanded ? (
                            <ChevronDown size={16} color={C.textMuted} />
                          ) : (
                            <ChevronRight size={16} color={C.textMuted} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
                {isExpanded && (
                  <li
                    style={{
                      padding: '12px 24px 16px 54px',
                      borderBottom: !isLast ? `1px solid ${C.border}` : 'none',
                      background: '#FAFAFA',
                      listStyle: 'none',
                    }}
                  >
                    {task.steps && task.steps.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>
                          📋 단계별 가이드
                        </div>
                        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: C.text }}>
                          {task.steps.map((s, i) => (
                            <li key={i} style={{ marginBottom: 4 }}>{s}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {task.tip && (
                      <div
                        style={{
                          background: '#FEF3C7',
                          border: '1px solid #FCD34D',
                          borderRadius: 4,
                          padding: '8px 12px',
                          fontSize: 12,
                          color: '#78350F',
                          marginBottom: 8,
                        }}
                      >
                        💡 {task.tip}
                      </div>
                    )}
                    {(task.videoRef || task.estimatedHours !== undefined) && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 16,
                          fontSize: 11,
                          color: C.textMuted,
                          marginTop: 8,
                        }}
                      >
                        {task.videoRef && <span>📺 {task.videoRef}</span>}
                        {task.estimatedHours !== undefined && (
                          <span>⏱️ 약 {task.estimatedHours}시간</span>
                        )}
                      </div>
                    )}
                  </li>
                )}
              </React.Fragment>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ─── 탭 B: 일일 실적 기록 ───────────────────────────────────────
function DailyTab() {
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [mounted, setMounted] = useState(false);

  // 폼 상태
  const today = getTodayStr();
  const [date, setDate] = useState(today);
  const [revenue, setRevenue] = useState('');
  const [adSpend, setAdSpend] = useState('');
  const [newProducts, setNewProducts] = useState('');
  const [winnerNote, setWinnerNote] = useState('');
  const [blockerNote, setBlockerNote] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRecords(loadDailyRecords());
    setMounted(true);
  }, []);

  // ROAS 자동 계산
  const roas = useMemo(() => {
    const rev = parseFloat(revenue);
    const ad = parseFloat(adSpend);
    if (!rev || !ad || ad === 0) return null;
    return Math.round((rev / ad) * 100);
  }, [revenue, adSpend]);

  function handleSave() {
    const rev = parseFloat(revenue) || 0;
    const ad = parseFloat(adSpend) || 0;
    const np = parseInt(newProducts) || 0;
    const week = getWeekForDate(date);

    const newRecord: DailyRecord = {
      date,
      revenue: rev,
      adSpend: ad,
      newProducts: np,
      winnerNote,
      blockerNote,
      week,
    };

    // 같은 날짜 기록은 덮어쓰기
    const filtered = records.filter((r) => r.date !== date);
    const updated = [newRecord, ...filtered].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    setRecords(updated);
    saveDailyRecords(updated);

    // 폼 초기화 피드백
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    // 오늘이 아닐 때는 오늘 날짜로 리셋
    setDate(today);
    setRevenue('');
    setAdSpend('');
    setNewProducts('');
    setWinnerNote('');
    setBlockerNote('');
  }

  // 최근 14일 기록만 표시
  const recentRecords = useMemo(() => records.slice(0, 14), [records]);

  if (!mounted) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 14,
    color: C.text,
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: C.textSub,
    marginBottom: 6,
    display: 'block',
    letterSpacing: 0.3,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 입력 폼 카드 */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
          }}
        >
          <Calendar size={16} color={C.accent} />
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
            오늘 실적 기록
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          {/* 날짜 */}
          <div>
            <label style={labelStyle}>날짜</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* 매출 */}
          <div>
            <label style={labelStyle}>오늘 매출 (만원)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              placeholder="예: 12.5"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* 광고비 */}
          <div>
            <label style={labelStyle}>오늘 광고비 (만원)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              placeholder="예: 3"
              value={adSpend}
              onChange={(e) => setAdSpend(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* ROAS 표시 */}
          <div>
            <label style={labelStyle}>ROAS (자동 계산)</label>
            <div
              style={{
                ...inputStyle,
                background: roas !== null ? (roas >= 300 ? C.greenBg : C.accentBg) : '#f9f9f9',
                border: `1px solid ${roas !== null ? (roas >= 300 ? C.greenBorder : C.accentBorder) : C.border}`,
                color: roas !== null ? (roas >= 300 ? C.green : C.accent) : C.textMuted,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {roas !== null ? `${roas}%` : '—'}
              {roas !== null && roas >= 300 && (
                <span style={{ fontSize: 11, marginLeft: 6, fontWeight: 400 }}>목표 달성</span>
              )}
              {roas !== null && roas < 300 && (
                <span style={{ fontSize: 11, marginLeft: 6, fontWeight: 400 }}>목표 미달</span>
              )}
            </div>
          </div>

          {/* 신규 등록 상품 수 */}
          <div>
            <label style={labelStyle}>신규 등록 상품 수</label>
            <input
              type="number"
              min="0"
              placeholder="예: 10"
              value={newProducts}
              onChange={(e) => setNewProducts(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          {/* 위너 메모 */}
          <div>
            <label style={labelStyle}>위너 상품 메모</label>
            <textarea
              placeholder="잘 팔린 상품, 특이사항..."
              value={winnerNote}
              onChange={(e) => setWinnerNote(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          {/* 막힌 부분 */}
          <div>
            <label style={labelStyle}>막힌 부분 메모</label>
            <textarea
              placeholder="어려운 점, 개선 필요 사항..."
              value={blockerNote}
              onChange={(e) => setBlockerNote(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleSave}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 24px',
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Save size={15} />
            저장
          </button>
          {saved && (
            <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>
              저장되었습니다.
            </span>
          )}
        </div>
      </div>

      {/* 최근 기록 목록 */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 24px',
            borderBottom: `1px solid ${C.border}`,
            fontSize: 14,
            fontWeight: 600,
            color: C.text,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <TrendingUp size={16} color={C.accent} />
          최근 14일 기록
        </div>
        {recentRecords.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: C.textMuted, fontSize: 14 }}>
            아직 기록이 없습니다. 오늘 실적을 입력해 보세요.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.tableHeader }}>
                  {['날짜', '주차', '매출(만원)', '광고비(만원)', 'ROAS', '신규상품'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: C.textSub,
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentRecords.map((r, idx) => {
                  const roasVal = r.adSpend > 0 ? Math.round((r.revenue / r.adSpend) * 100) : null;
                  return (
                    <tr
                      key={r.date}
                      style={{
                        borderTop: idx > 0 ? `1px solid ${C.border}` : 'none',
                        background: idx % 2 === 0 ? '#fff' : C.tableHeader,
                      }}
                    >
                      <td style={{ padding: '10px 16px', color: C.text, whiteSpace: 'nowrap' }}>
                        {r.date}
                      </td>
                      <td style={{ padding: '10px 16px', color: C.textSub }}>
                        {r.week}주차
                      </td>
                      <td style={{ padding: '10px 16px', fontWeight: 600, color: C.text }}>
                        {r.revenue.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 16px', color: C.textSub }}>
                        {r.adSpend.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {roasVal !== null ? (
                          <span
                            style={{
                              fontWeight: 700,
                              color: roasVal >= 300 ? C.green : C.accent,
                            }}
                          >
                            {roasVal}%
                          </span>
                        ) : (
                          <span style={{ color: C.textMuted }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px', color: C.textSub }}>
                        {r.newProducts > 0 ? `+${r.newProducts}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

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

      <div style={{
        background: C.accentBg, border: `1px solid ${C.accentBorder}`,
        borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: C.textSub,
      }}>
        위너 조건: <strong style={{ color: C.text }}>2주 판매 3건+</strong> &nbsp;·&nbsp;
        <strong style={{ color: C.text }}>ROAS 300%+</strong> &nbsp;·&nbsp;
        <strong style={{ color: C.text }}>리뷰 3개+</strong> — 3개 모두 충족
      </div>

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

// ─── 틈새 키워드 발굴 탭 ─────────────────────────────────────────

interface KeywordEntry {
  id: string;
  keyword: string;
  searchVolume: number | null;   // 월 검색량
  competition: number | null;    // 경쟁 상품 수
  maxReviews: number | null;     // 상위 경쟁상품 최대 리뷰 수
  platform: 'naver' | 'coupang' | 'both';
  status: 'candidate' | 'registered' | 'archived';
  memo: string;
  createdAt: string;
}

function judgeKeyword(k: KeywordEntry): 'pass' | 'partial' | 'fail' {
  const sv = k.searchVolume;
  const comp = k.competition;
  const rev = k.maxReviews;
  // 수요(검색량) 최소 1,000 이상
  const svOk = sv !== null && sv >= 1000;
  // 경쟁상품수가 검색량의 5배 미만 (수요 대비 공급 비율)
  const ratioOk = sv !== null && comp !== null && comp < sv * 5;
  // 상위 경쟁상품 리뷰 100개 미만
  const revOk = rev !== null && rev < 100;
  const passCount = [svOk, ratioOk, revOk].filter(Boolean).length;
  if (passCount === 3) return 'pass';
  if (passCount >= 1) return 'partial';
  return 'fail';
}

const KEYWORD_STORAGE_KEY = 'plan_keywords';

function loadKeywords(): KeywordEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(KEYWORD_STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as KeywordEntry[]) : [];
  } catch { return []; }
}

function saveKeywords(entries: KeywordEntry[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYWORD_STORAGE_KEY, JSON.stringify(entries));
}

const EMPTY_FORM = {
  keyword: '',
  searchVolume: '',
  competition: '',
  maxReviews: '',
  platform: 'naver' as 'naver' | 'coupang' | 'both',
  memo: '',
};

function KeywordTab() {
  const [entries, setEntries] = useState<KeywordEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'candidate' | 'registered' | 'archived'>('all');
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    setEntries(loadKeywords());
    setMounted(true);
  }, []);

  function handleAdd() {
    if (!form.keyword.trim()) return;
    const entry: KeywordEntry = {
      id: crypto.randomUUID(),
      keyword: form.keyword.trim(),
      searchVolume: form.searchVolume !== '' ? Number(form.searchVolume) : null,
      competition: form.competition !== '' ? Number(form.competition) : null,
      maxReviews: form.maxReviews !== '' ? Number(form.maxReviews) : null,
      platform: form.platform,
      status: 'candidate',
      memo: form.memo.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [entry, ...entries];
    setEntries(updated);
    saveKeywords(updated);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  function handleStatusChange(id: string, status: KeywordEntry['status']) {
    const updated = entries.map((e) => e.id === id ? { ...e, status } : e);
    setEntries(updated);
    saveKeywords(updated);
  }

  function handleDelete(id: string) {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    saveKeywords(updated);
  }

  const filtered = useMemo(
    () => filter === 'all' ? entries : entries.filter((e) => e.status === filter),
    [entries, filter]
  );

  const passCount = useMemo(() => entries.filter((e) => judgeKeyword(e) === 'pass').length, [entries]);
  const candidateCount = entries.filter((e) => e.status === 'candidate').length;
  const registeredCount = entries.filter((e) => e.status === 'registered').length;

  const inputSt: React.CSSProperties = {
    padding: '7px 10px', fontSize: 13,
    border: `1px solid ${C.border}`, borderRadius: 7,
    outline: 'none', color: C.text, background: '#fff',
    width: '100%', boxSizing: 'border-box',
  };

  if (!mounted) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 기준 안내 배너 */}
      <div style={{
        background: C.blueBg, border: `1px solid ${C.blueBorder}`,
        borderRadius: 10, padding: '12px 18px',
        display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center',
      }}>
        <Search size={15} color={C.blue} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: C.blue, fontWeight: 600 }}>틈새 키워드 선별 기준 (AI 평가 동일 기준)</span>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: C.textSub }}>
          <span style={{ background: '#fff', border: `1px solid ${C.blueBorder}`, borderRadius: 6, padding: '2px 10px' }}>
            월 검색량 <strong style={{ color: C.text }}>1,000 이상</strong>
          </span>
          <span style={{ background: '#fff', border: `1px solid ${C.blueBorder}`, borderRadius: 6, padding: '2px 10px' }}>
            경쟁상품수 <strong style={{ color: C.text }}>검색량 × 5배 미만</strong>
          </span>
          <span style={{ background: '#fff', border: `1px solid ${C.blueBorder}`, borderRadius: 6, padding: '2px 10px' }}>
            상위 리뷰 <strong style={{ color: C.text }}>100개 미만</strong>
          </span>
        </div>
      </div>

      {/* 상태 요약 + 추가 버튼 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 12, fontSize: 13, color: C.textSub }}>
          <span>전체 <strong style={{ color: C.text }}>{entries.length}</strong>개</span>
          <span style={{ color: C.green }}>기준 충족 <strong>{passCount}</strong>개</span>
          <span>후보 <strong style={{ color: C.text }}>{candidateCount}</strong> · 등록 <strong style={{ color: C.text }}>{registeredCount}</strong></span>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', fontSize: 13, fontWeight: 700,
            background: C.accent, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
          }}
        >
          <Plus size={14} /> 키워드 추가
        </button>
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <div style={{
          background: '#fff', border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 20,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>키워드 *</label>
              <input style={inputSt} placeholder="예: 미니 가습기 usb" value={form.keyword}
                onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>플랫폼</label>
              <select style={{ ...inputSt, cursor: 'pointer' }} value={form.platform}
                onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value as 'naver' | 'coupang' | 'both' }))}>
                <option value="naver">스마트스토어</option>
                <option value="coupang">쿠팡</option>
                <option value="both">둘 다</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>
                월 검색량 <span style={{ color: C.textMuted, fontWeight: 400 }}>(1,000 이상)</span>
              </label>
              <input style={inputSt} type="number" placeholder="예: 8500" value={form.searchVolume}
                onChange={(e) => setForm((f) => ({ ...f, searchVolume: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>
                경쟁 상품 수 <span style={{ color: C.textMuted, fontWeight: 400 }}>(검색량 5배 미만)</span>
              </label>
              <input style={inputSt} type="number" placeholder="예: 3000" value={form.competition}
                onChange={(e) => setForm((f) => ({ ...f, competition: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>
                상위 리뷰 수 <span style={{ color: C.textMuted, fontWeight: 400 }}>(&lt;100)</span>
              </label>
              <input style={inputSt} type="number" placeholder="예: 12" value={form.maxReviews}
                onChange={(e) => setForm((f) => ({ ...f, maxReviews: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.textSub, display: 'block', marginBottom: 4 }}>메모</label>
            <input style={inputSt} placeholder="소싱 출처, 발굴 경로 등" value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={!form.keyword.trim()}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 700,
                background: form.keyword.trim() ? C.accent : '#ccc',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: form.keyword.trim() ? 'pointer' : 'not-allowed',
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

      {/* 필터 탭 */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}` }}>
        {([['all', '전체'], ['candidate', '후보'], ['registered', '등록완료'], ['archived', '보류']] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            style={{
              padding: '7px 14px', fontSize: 12, fontWeight: filter === val ? 700 : 400,
              color: filter === val ? C.accent : C.textSub,
              background: 'transparent', border: 'none',
              borderBottom: filter === val ? `2px solid ${C.accent}` : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer',
            }}
          >{label}</button>
        ))}
      </div>

      {/* 키워드 목록 */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: C.textMuted, fontSize: 14 }}>
          {entries.length === 0
            ? '아이템스카우트에서 발굴한 키워드를 여기에 기록하세요.'
            : '해당 상태의 키워드가 없습니다.'}
        </div>
      ) : (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f3f3f3', borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 40 }}>적합</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>키워드</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 90 }}>월 검색량</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 90 }}>경쟁 상품</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: C.textSub, width: 80 }}>상위 리뷰</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 70 }}>플랫폼</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: C.textSub }}>메모</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: C.textSub, width: 80 }}>상태</th>
                <th style={{ padding: '10px 14px', width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, idx) => {
                const grade = judgeKeyword(entry);
                const sv = entry.searchVolume;
                const comp = entry.competition;
                const rev = entry.maxReviews;
                const svOk = sv !== null && sv >= 1000;
                const ratioOk = sv !== null && comp !== null && comp < sv * 5;
                const revOk = rev !== null && rev < 100;
                const dotColor = grade === 'pass' ? C.green : grade === 'partial' ? C.yellow : C.textMuted;
                return (
                  <tr key={entry.id} style={{
                    borderTop: idx > 0 ? `1px solid ${C.border}` : 'none',
                    background: grade === 'pass' ? 'rgba(22,163,74,0.04)' : idx % 2 === 0 ? '#fff' : C.bg,
                    opacity: entry.status === 'archived' ? 0.55 : 1,
                  }}>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block', width: 10, height: 10,
                        borderRadius: '50%', background: dotColor,
                      }} title={grade === 'pass' ? '기준 충족' : grade === 'partial' ? '일부 충족' : '미충족'} />
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: grade === 'pass' ? 700 : 400, color: C.text }}>
                      {entry.keyword}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: svOk ? C.green : sv !== null ? C.accent : C.textMuted, fontWeight: svOk ? 700 : 400 }}>
                      {sv !== null ? sv.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: ratioOk ? C.green : comp !== null ? C.accent : C.textMuted, fontWeight: ratioOk ? 700 : 400 }}>
                      {comp !== null ? comp.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: revOk ? C.green : rev !== null ? C.accent : C.textMuted, fontWeight: revOk ? 700 : 400 }}>
                      {rev !== null ? rev : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, color: C.textSub }}>
                      {entry.platform === 'both' ? '둘 다' : entry.platform === 'naver' ? '스토어' : '쿠팡'}
                    </td>
                    <td style={{ padding: '10px 14px', color: C.textSub, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.memo || '—'}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      <select
                        value={entry.status}
                        onChange={(e) => handleStatusChange(entry.id, e.target.value as KeywordEntry['status'])}
                        style={{
                          fontSize: 11, padding: '3px 6px',
                          border: `1px solid ${C.border}`, borderRadius: 5,
                          background: '#fff', color: C.textSub, cursor: 'pointer', outline: 'none',
                        }}
                      >
                        <option value="candidate">후보</option>
                        <option value="registered">등록완료</option>
                        <option value="archived">보류</option>
                      </select>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <button onClick={() => handleDelete(entry.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.textMuted }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 탭 C: 목표 진행도 ──────────────────────────────────────────
function ProgressTab() {
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setRecords(loadDailyRecords());
    setMounted(true);
  }, []);

  const currentWeek = useMemo(() => getCurrentWeek(), []);

  // 주차별 실제 매출 합산
  const weeklyActual = useMemo(() => {
    const sums: Record<number, number> = {};
    for (let w = 1; w <= 12; w++) sums[w] = 0;
    records.forEach((r) => {
      const w = r.week;
      if (w >= 1 && w <= 12) sums[w] += r.revenue;
    });
    // 누적합으로 변환
    const cumulative: number[] = [];
    let acc = 0;
    for (let w = 1; w <= 12; w++) {
      acc += sums[w];
      cumulative.push(acc);
    }
    return cumulative;
  }, [records]);

  // 오늘까지의 누적 매출 (현재 주차까지)
  const totalActual = weeklyActual[currentWeek - 1] ?? 0;
  const totalTarget = WEEKLY_TARGETS[currentWeek - 1];
  const overallPct = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
  const isBehind = overallPct < 70;

  const maxTarget = 1000; // 전체 최대 목표

  if (!mounted) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 전체 현황 */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '24px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 24,
          alignItems: 'center',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: C.textSub, marginBottom: 4 }}>
            전체 목표 ({currentWeek}주차 기준)
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.text }}>
            월 1,000만원
          </div>
          <div style={{ fontSize: 14, color: C.textSub, marginTop: 2 }}>
            현재 {currentWeek}주차 &nbsp;|&nbsp; 이번 주 목표 누적&nbsp;
            <strong style={{ color: C.text }}>{totalTarget.toLocaleString()}만원</strong>
          </div>
        </div>

        <div style={{ textAlign: 'center', minWidth: 120 }}>
          <div
            style={{
              fontSize: 40,
              fontWeight: 900,
              color: isBehind ? C.accent : overallPct >= 100 ? C.green : C.text,
              lineHeight: 1,
            }}
          >
            {overallPct}%
          </div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>달성률</div>
        </div>

        <div style={{ textAlign: 'right', minWidth: 140 }}>
          <div style={{ fontSize: 13, color: C.textSub, marginBottom: 2 }}>현재 누적 실적</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>
            {totalActual.toLocaleString()}만원
          </div>
        </div>
      </div>

      {/* 경고 배너 */}
      {isBehind && totalActual > 0 && (
        <div
          style={{
            background: C.accentBg,
            border: `1.5px solid ${C.accentBorder}`,
            borderRadius: 12,
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <AlertTriangle size={18} color={C.accent} />
          <span style={{ fontSize: 14, color: C.accent, fontWeight: 600 }}>
            현재 주차 목표의 70% 미달입니다. 핵심 태스크에 집중이 필요합니다.
          </span>
        </div>
      )}

      {/* 주차별 바 차트 */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
          }}
        >
          <BarChart2 size={16} color={C.accent} />
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
            주차별 누적 매출 vs 목표
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12, color: C.textSub }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: C.accent, display: 'inline-block' }} />
              목표
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: C.green, display: 'inline-block' }} />
              실적
            </span>
          </div>
        </div>

        {/* 차트 영역 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {WEEKLY_TARGETS.map((target, idx) => {
            const weekNum = idx + 1;
            const actual = weeklyActual[idx] ?? 0;
            const targetPct = (target / maxTarget) * 100;
            const actualPct = (actual / maxTarget) * 100;
            const isCurrent = weekNum === currentWeek;
            const isFuture = weekNum > currentWeek;

            return (
              <div key={weekNum} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* 주차 라벨 */}
                <div
                  style={{
                    width: 48,
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: isCurrent ? 700 : 400,
                    color: isCurrent ? C.accent : C.textSub,
                    textAlign: 'right',
                  }}
                >
                  {weekNum}주차
                  {isCurrent && (
                    <div style={{ fontSize: 9, color: C.accent, fontWeight: 700 }}>NOW</div>
                  )}
                </div>

                {/* 바 영역 */}
                <div style={{ flex: 1, position: 'relative', height: 28, borderRadius: 6, background: '#f0f0f0', overflow: 'hidden' }}>
                  {/* 목표 바 (배경) */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      height: '100%',
                      width: `${targetPct}%`,
                      background: isFuture ? '#e8e8e8' : 'rgba(190,0,20,0.15)',
                      borderRadius: 6,
                    }}
                  />
                  {/* 실적 바 */}
                  {!isFuture && actual > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 4,
                        left: 0,
                        height: 'calc(100% - 8px)',
                        width: `${Math.min(actualPct, targetPct)}%`,
                        background: actual >= target ? C.green : C.accent,
                        borderRadius: 4,
                        transition: 'width 0.5s ease',
                      }}
                    />
                  )}
                </div>

                {/* 수치 */}
                <div style={{ width: 110, flexShrink: 0, fontSize: 12 }}>
                  {isFuture ? (
                    <span style={{ color: C.textMuted }}>목표 {target.toLocaleString()}만</span>
                  ) : (
                    <span>
                      <span style={{ fontWeight: 700, color: actual >= target ? C.green : C.text }}>
                        {actual.toLocaleString()}
                      </span>
                      <span style={{ color: C.textMuted }}>/{target.toLocaleString()}만</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 주차별 상세 목표 목록 */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 24px',
            borderBottom: `1px solid ${C.border}`,
            fontSize: 14,
            fontWeight: 600,
            color: C.text,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Target size={16} color={C.accent} />
          12주 플랜 전체 개요
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.tableHeader }}>
                {['주차', '단계', '핵심 목표', '매출 목표'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 16px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: C.textSub,
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(WBS_DATA).map(([weekStr, data], idx) => {
                const weekNum = parseInt(weekStr);
                const isCurrent = weekNum === currentWeek;
                const isPast = weekNum < currentWeek;
                return (
                  <tr
                    key={weekNum}
                    style={{
                      borderTop: idx > 0 ? `1px solid ${C.border}` : 'none',
                      background: isCurrent
                        ? C.accentBg
                        : idx % 2 === 0
                        ? '#fff'
                        : C.tableHeader,
                    }}
                  >
                    <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          fontWeight: 700,
                          color: isCurrent ? C.accent : isPast ? C.textMuted : C.text,
                        }}
                      >
                        {weekNum}주차
                      </span>
                      {isCurrent && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            background: C.accent,
                            color: '#fff',
                            padding: '1px 6px',
                            borderRadius: 10,
                          }}
                        >
                          현재
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 16px', fontWeight: 600, color: isCurrent ? C.accent : C.text }}>
                      {data.title}
                    </td>
                    <td style={{ padding: '10px 16px', color: C.textSub, fontSize: 12 }}>
                      {data.goal}
                    </td>
                    <td style={{ padding: '10px 16px', fontWeight: 600, color: C.text }}>
                      {data.revenueTarget}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── 메인 PlanClient 컴포넌트 ────────────────────────────────────
type TabId = 'today' | 'daily' | 'progress' | 'winner' | 'keyword';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

export default function PlanClient() {
  const [activeTab, setActiveTab] = useState<TabId>('today');
  const currentWeek = useMemo(() => getCurrentWeek(), []);

  const tabs: Tab[] = [
    { id: 'today', label: '오늘 할 일', icon: <CheckSquare size={15} /> },
    { id: 'daily', label: '일일 실적 기록', icon: <Calendar size={15} /> },
    { id: 'progress', label: '목표 진행도', icon: <TrendingUp size={15} /> },
    { id: 'winner' as const, label: '위너 선별', icon: <Target size={15} /> },
    { id: 'keyword' as const, label: '틈새 키워드 발굴', icon: <Search size={15} /> },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: 'Pretendard, -apple-system, sans-serif' }}>
      {/* 네비게이션 */}
      <nav
        style={{
          background: C.card,
          borderBottom: `1px solid ${C.border}`,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          height: 52,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 16, color: C.text, marginRight: 32, letterSpacing: -0.3 }}>
          Smart<span style={{ color: C.accent }}>Seller</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/plan';
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? C.accent : C.textSub,
                  borderRadius: 6,
                  textDecoration: 'none',
                  background: isActive ? C.accentBg : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* 페이지 헤더 */}
      <div
        style={{
          padding: '28px 32px 0',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: 0, letterSpacing: -0.5 }}>
              3개월 매출 목표 플랜
            </h1>
            <p style={{ fontSize: 14, color: C.textSub, margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ChevronRight size={14} />
              현재 <strong style={{ color: C.accent }}>{currentWeek}주차</strong> &nbsp;·&nbsp;
              {WBS_DATA[currentWeek]?.title} &nbsp;·&nbsp; 목표 매출 {WBS_DATA[currentWeek]?.revenueTarget}
            </p>
          </div>
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: '10px 20px',
              fontSize: 13,
              color: C.textSub,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Target size={14} color={C.accent} />
            최종 목표: <strong style={{ color: C.text }}>월 1,000만원</strong>
          </div>
        </div>

        {/* 탭 */}
        <div style={{ display: 'flex', gap: 4, marginTop: 24, borderBottom: `1px solid ${C.border}` }}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 18px',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? C.accent : C.textSub,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: isActive ? `2px solid ${C.accent}` : '2px solid transparent',
                  marginBottom: -1,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  borderRadius: '4px 4px 0 0',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px 48px' }}>
        {activeTab === 'today' && <TodayTab />}
        {activeTab === 'daily' && <DailyTab />}
        {activeTab === 'progress' && <ProgressTab />}
        {activeTab === 'winner' && <WinnerTab />}
        {activeTab === 'keyword' && <KeywordTab />}
      </div>
    </div>
  );
}
