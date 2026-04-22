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
  Save,
  Calendar,
  BarChart2,
  Zap,
  Trash2,
} from 'lucide-react';
import { C as BASE_C } from '@/lib/design-tokens';

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

// ─── 타입 정의 ──────────────────────────────────────────────────
interface WbsTask {
  id: string;
  text: string;
}

interface WeekData {
  title: string;
  goal: string;
  revenueTarget: string;
  tasks: WbsTask[];
}

interface DailyRecord {
  date: string;       // YYYY-MM-DD
  revenue: number;    // 만원
  adSpend: number;    // 만원
  newProducts: number;
  winnerNote: string;
  blockerNote: string;
  week: number;
}

// ─── WBS 데이터 (하드코딩) ──────────────────────────────────────
const WBS_DATA: Record<number, WeekData> = {
  1: {
    title: '기반 세팅',
    goal: '100개 상품 등록, 첫 판매 발생',
    revenueTarget: '50만원',
    tasks: [
      { id: 'w1-1', text: '아이템스카우트(itemscout.io) 가입 및 사용법 숙지' },
      { id: 'w1-2', text: '틈새 키워드 발굴 — 월 검색량 3,000~30,000 / 경쟁상품 500개 미만 / 리뷰 50개 미만' },
      { id: 'w1-3', text: '발굴 키워드 30개 목록 작성' },
      { id: 'w1-4', text: '도매꾹 위 키워드 매칭 상품 100개 선별 (마진 30% 이상 / 위탁 가능 / 배송 3일 이내)' },
      { id: 'w1-5', text: '코스트코 주말 방문: 온라인 미출시 상품 10개 스캔 (경쟁 셀러 3개 미만)' },
      { id: 'w1-6', text: 'Smart Seller Studio 도매꾹 대량 등록 기능 완성 (타이틀/카테고리/이미지/가격 자동 입력)' },
      { id: 'w1-7', text: '스마트스토어 소개/로고/배너 정비' },
      { id: 'w1-8', text: 'CS 자동 응답 메시지 설정' },
    ],
  },
  2: {
    title: '첫 판매 달성',
    goal: '100개 등록, 광고 시작',
    revenueTarget: '100만원',
    tasks: [
      { id: 'w2-1', text: 'Smart Seller Studio로 스마트스토어에 50개 등록' },
      { id: 'w2-2', text: '나머지 50개 추가 등록 (총 100개)' },
      { id: 'w2-3', text: '각 상품 AI 상세페이지 생성 (Step3 활용)' },
      { id: 'w2-4', text: '상품 타이틀 키워드 최적화 (메인+세부키워드)' },
      { id: 'w2-5', text: '네이버 검색광고 계정 세팅' },
      { id: 'w2-6', text: '쇼핑 키워드 광고 캠페인 생성 (일 3만원, 키워드 10개)' },
      { id: 'w2-7', text: '쿠팡 스폰서드 프로덕트 5개 (일 1만원)' },
      { id: 'w2-8', text: '첫 2주 가격: 경쟁자 최저가보다 5~10% 저렴하게' },
      { id: 'w2-9', text: '지인/가족 5명 구매 부탁 → 첫 리뷰 5개 확보' },
    ],
  },
  3: {
    title: '위너 발굴 1',
    goal: '팔리는 상품 TOP 5 발굴',
    revenueTarget: '200만원',
    tasks: [
      { id: 'w3-1', text: '상품별 CTR 확인 → 1% 미만 상품 타이틀/이미지 교체' },
      { id: 'w3-2', text: '전환율 확인 → 클릭 있는데 구매 없는 상품 가격/상세페이지 수정' },
      { id: 'w3-3', text: '광고 ROAS 계산 (목표 300% 이상)' },
      { id: 'w3-4', text: '성과 하위 30개 상품 새 키워드 상품으로 교체' },
      { id: 'w3-5', text: '추가 50개 등록 (총 150개)' },
      { id: 'w3-6', text: '새 카테고리 1개 탐색' },
      { id: 'w3-7', text: '구매자 리뷰 요청 메시지 발송' },
      { id: 'w3-8', text: '상품별 리뷰 5개 이상 확보 목표' },
    ],
  },
  4: {
    title: '위너 발굴 2',
    goal: '위너 상품 5개 확정, 사입 준비',
    revenueTarget: '300만원',
    tasks: [
      { id: 'w4-1', text: '2주 누적 데이터로 판매량 TOP 5 상품 선정' },
      { id: 'w4-2', text: 'TOP 5 기준: 2주 내 3건 이상 / ROAS 300% 이상 / 리뷰 3개 이상' },
      { id: 'w4-3', text: 'TOP 5 광고 예산 2배 확대' },
      { id: 'w4-4', text: 'TOP 5 상세페이지 전면 리뉴얼' },
      { id: 'w4-5', text: 'TOP 5 쿠팡에도 등록' },
      { id: 'w4-6', text: '사입 시 마진 30% 이상 상품 파악' },
      { id: 'w4-7', text: '소량 테스트 사입 결정 (10~20개)' },
    ],
  },
  5: {
    title: '사입 실행',
    goal: '사입 시작, 마진 개선',
    revenueTarget: '400만원',
    tasks: [
      { id: 'w5-1', text: 'TOP 3 상품 사입 발주 (예산 100만원)' },
      { id: 'w5-2', text: '사입 상품 스마트스토어 재등록 (직접 배송 강조)' },
      { id: 'w5-3', text: '사입 상품 쿠팡 로켓그로스 등록 시도' },
      { id: 'w5-4', text: '스마트스토어 광고 일 예산 5만원으로 증액' },
      { id: 'w5-5', text: '쿠팡 광고 사입 상품 중심 일 3만원' },
      { id: 'w5-6', text: '스마트스토어 플러스 스토어 지원 조건 확인' },
      { id: 'w5-7', text: '리뷰 20개 이상 확보' },
    ],
  },
  6: {
    title: '사입 스케일',
    goal: '월 300만원 페이스',
    revenueTarget: '500만원',
    tasks: [
      { id: 'w6-1', text: '사입 상품 vs 위탁 마진 비교 분석' },
      { id: 'w6-2', text: '실패 사입 상품 즉시 가격 인하 or 재판매' },
      { id: 'w6-3', text: '위탁 중 꾸준한 상품 추가 사입 검토' },
      { id: 'w6-4', text: '번들 구성 (TOP 상품 + 관련 상품 세트)' },
      { id: 'w6-5', text: '번들로 객단가 20~30% 상승 목표' },
    ],
  },
  7: {
    title: '채널 다변화',
    goal: '월 500만원 달성',
    revenueTarget: '600만원',
    tasks: [
      { id: 'w7-1', text: '도매토피아 / 오너클랜 / 1688.com 탐색' },
      { id: 'w7-2', text: '코스트코 주말 2회 방문 → 추가 틈새 상품 발굴' },
      { id: 'w7-3', text: '계절 상품 / 특정 취미 상품 조사' },
      { id: 'w7-4', text: '위탁 상품 총 200개 이상 등록 유지' },
    ],
  },
  8: {
    title: '광고 최적화',
    goal: '월 500~600만원',
    revenueTarget: '700만원',
    tasks: [
      { id: 'w8-1', text: '광고 ROAS 300% 이상 확인 후 예산 확대' },
      { id: 'w8-2', text: '사입 상품 재고 회전 확인 (재발주 타이밍)' },
      { id: 'w8-3', text: '실패 상품 정리 → 예산 위너에 집중' },
    ],
  },
  9: {
    title: '공격적 확장',
    goal: '월 700만원',
    revenueTarget: '800만원',
    tasks: [
      { id: 'w9-1', text: '광고비 일 10만원으로 확대 (ROAS 300% 이상 확인 후)' },
      { id: 'w9-2', text: '카카오쇼핑 채널 등록' },
      { id: 'w9-3', text: '인스타그램 쇼핑 연동' },
      { id: 'w9-4', text: '11번가 / 위메프 추가 등록' },
      { id: 'w9-5', text: '검증 위너 추가 사입 (예산 50만원)' },
      { id: 'w9-6', text: '5~6월 시즌 상품 소싱' },
    ],
  },
  10: {
    title: '스케일업 중',
    goal: '월 800만원',
    revenueTarget: '900만원',
    tasks: [
      { id: 'w10-1', text: '일 매출 25만원 이상 안정적 발생 확인' },
      { id: 'w10-2', text: '리뷰 50개 이상 확보' },
      { id: 'w10-3', text: '스마트스토어 기획전 참여 신청' },
    ],
  },
  11: {
    title: '최종 스케일',
    goal: '월 900만원',
    revenueTarget: '950만원',
    tasks: [
      { id: 'w11-1', text: '광고 ROAS 기반 예산 최대 투입' },
      { id: 'w11-2', text: '쿠팡 로켓그로스 추가 상품 입고' },
      { id: 'w11-3', text: 'Smart Seller Studio 상품 등록 완전 자동화 완성' },
    ],
  },
  12: {
    title: '목표 달성',
    goal: '월 1,000만원',
    revenueTarget: '1,000만원',
    tasks: [
      { id: 'w12-1', text: '반품/교환 처리 프로세스 문서화' },
      { id: 'w12-2', text: '재고 회전 관리 시스템 구축' },
      { id: 'w12-3', text: '다음 달 소싱 계획 수립' },
      { id: 'w12-4', text: '월 매출 1,000만원 달성 확인' },
    ],
  },
};

// 주차별 누적 매출 목표 (만원)
const WEEKLY_TARGETS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000];

// 플랜 시작일 (고정)
const PLAN_START = new Date('2026-04-22T00:00:00+09:00');

// ─── 유틸: 현재 주차 계산 ────────────────────────────────────────
function getCurrentWeek(): number {
  const now = new Date();
  const diffMs = now.getTime() - PLAN_START.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(week, 1), 12);
}

// ─── 유틸: 날짜에서 주차 계산 ───────────────────────────────────
function getWeekForDate(dateStr: string): number {
  const date = new Date(dateStr + 'T00:00:00+09:00');
  const diffMs = date.getTime() - PLAN_START.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(week, 1), 12);
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

function loadDailyRecords(): DailyRecord[] {
  try {
    const raw = localStorage.getItem('plan_daily_records');
    return raw ? (JSON.parse(raw) as DailyRecord[]) : [];
  } catch {
    return [];
  }
}

function saveDailyRecords(records: DailyRecord[]): void {
  localStorage.setItem('plan_daily_records', JSON.stringify(records));
}

// ─── 탭 A: 오늘 할 일 ───────────────────────────────────────────
function TodayTab() {
  const currentWeek = useMemo(() => getCurrentWeek(), []);
  const weekData = WBS_DATA[currentWeek];
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

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
            return (
              <li
                key={task.id}
                onClick={() => toggleTask(task.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 24px',
                  borderBottom: idx < weekData.tasks.length - 1 ? `1px solid ${C.border}` : 'none',
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
                <span
                  style={{
                    fontSize: 14,
                    color: done ? C.textMuted : C.text,
                    textDecoration: done ? 'line-through' : 'none',
                    lineHeight: 1.6,
                  }}
                >
                  {task.text}
                </span>
              </li>
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
type TabId = 'today' | 'daily' | 'progress' | 'winner';

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
      </div>
    </div>
  );
}
