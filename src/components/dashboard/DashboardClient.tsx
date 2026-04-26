'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import PlanProgressCard from './PlanProgressCard';
import ProductCountWidget from './ProductCountWidget';
import OrderPipeline from './OrderPipeline';
import RevenueChart from './RevenueChart';
import {
  type Period,
  type DashboardSummaryData,
} from '@/lib/dashboard/types';
import { WBS_DATA, WEEKLY_TARGETS } from '@/lib/plan/constants';
import { getCurrentWeek, getDaysIntoWeek } from '@/lib/plan/week';
import { loadDailyRecords, sumWeekRevenue, computeCumulativeActual } from '@/lib/plan/daily-records';

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', active: true },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
];

interface PlanLocalData {
  weekNumber: number;
  weekTitle: string;
  weekTargetMan: number;
  weekActualMan: number;
  daysIntoWeek: number;
  keyMission: string | null;
  cumulativeActual: (number | null)[];
}

function readPlanLocalData(): PlanLocalData | null {
  if (typeof window === 'undefined') return null;
  const records = loadDailyRecords();
  const week = getCurrentWeek();
  const weekData = WBS_DATA[week];
  if (!weekData) return null;

  const weekTargetMan =
    week === 1 ? WEEKLY_TARGETS[0] : WEEKLY_TARGETS[week - 1] - WEEKLY_TARGETS[week - 2];
  const weekActualMan = sumWeekRevenue(records, week);

  // 핵심 미션: 첫 미완료 WBS task
  const checks = (() => {
    try {
      const raw = localStorage.getItem('plan_wbs_tasks');
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {} as Record<string, boolean>;
    }
  })();
  const firstIncomplete = weekData.tasks.find((t) => !checks[t.id]);

  return {
    weekNumber: week,
    weekTitle: weekData.title,
    weekTargetMan,
    weekActualMan,
    daysIntoWeek: getDaysIntoWeek(),
    keyMission: firstIncomplete?.text ?? null,
    cumulativeActual: computeCumulativeActual(records, week),
  };
}

export default function DashboardClient() {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<DashboardSummaryData | null>(null);
  const [planData, setPlanData] = useState<PlanLocalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 플랜 데이터는 client side localStorage에서만
  useEffect(() => {
    setPlanData(readPlanLocalData());
  }, []);

  const fetchSummary = async (p: Period) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/summary?period=${p}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '요청 실패');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary(period);
  }, [period]);

  const chartActual = useMemo(() => {
    return planData?.cumulativeActual ?? new Array(12).fill(null);
  }, [planData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflowY: 'auto', backgroundColor: '#f5f5f7' }}>
      {/* ── 헤더 (기존 유지) ─────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.card,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px', color: C.text }}>
              Smart<span style={{ color: C.accent }}>Seller</span>Studio
            </span>
            <span
              style={{
                backgroundColor: 'rgba(190,0,20,0.08)',
                color: C.accent,
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 9px',
                borderRadius: 100,
                border: '1px solid rgba(190,0,20,0.2)',
              }}
            >
              Beta
            </span>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: item.active ? 600 : 500,
                  color: item.active ? C.accent : '#71717a',
                  textDecoration: 'none',
                  backgroundColor: item.active ? 'rgba(190,0,20,0.07)' : 'transparent',
                  border: item.active ? '1px solid rgba(190,0,20,0.15)' : '1px solid transparent',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <button
          onClick={() => fetchSummary(period)}
          aria-label="새로고침"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            backgroundColor: C.card,
            cursor: 'pointer',
            fontSize: 12,
            color: C.text,
          }}
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </header>

      {/* ── 메인 ─────────────────── */}
      <main style={{ flex: 1, maxWidth: 1200, width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        {/* 타이틀 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: 'rgba(190,0,20,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LayoutDashboard size={18} color={C.accent} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>운영 대시보드</h1>
            <p style={{ fontSize: 12, color: '#71717a', margin: 0 }}>
              플랜 진행 · 등록 상품 · 주문 파이프라인 한눈에
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 플랜 카드 (또는 비어있음 안내) */}
          {planData ? (
            <PlanProgressCard
              weekNumber={planData.weekNumber}
              weekTitle={planData.weekTitle}
              weekTargetMan={planData.weekTargetMan}
              weekActualMan={planData.weekActualMan}
              daysIntoWeek={planData.daysIntoWeek}
              keyMission={planData.keyMission}
            />
          ) : (
            <PlanEmptyCard />
          )}

          {/* 등록 상품 위젯 */}
          {data && (
            <ProductCountWidget coupang={data.products.coupang} naver={data.products.naver} />
          )}

          {/* 로딩 / 에러 / 정상 분기 */}
          {isLoading && !data ? (
            <LoadingCard />
          ) : error && !data ? (
            <ErrorCard error={error} onRetry={() => fetchSummary(period)} />
          ) : data ? (
            <>
              <OrderPipeline
                coupang={data.pipeline.coupang}
                naver={data.pipeline.naver}
                period={period}
                onPeriodChange={setPeriod}
                coupangDimmed={data.products.coupang === 0}
                naverDimmed={data.products.naver === 0}
              />
              <RevenueChart
                weeks={data.revenue12w.weeks}
                target={data.revenue12w.target}
                actual={chartActual}
                currentWeek={planData?.weekNumber ?? 1}
              />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function LoadingCard() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 64,
        backgroundColor: C.card,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
      }}
    >
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: '#a1a1aa' }} />
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 32,
        backgroundColor: C.card,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
      }}
    >
      <AlertTriangle size={24} color="#d97706" />
      <p style={{ fontSize: 13, color: '#71717a', margin: 0 }}>데이터를 불러오지 못했습니다: {error}</p>
      <button
        onClick={onRetry}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 16px',
          borderRadius: 8,
          cursor: 'pointer',
          border: `1px solid ${C.border}`,
          backgroundColor: '#fafafa',
          fontSize: 12,
          fontWeight: 500,
          color: C.text,
        }}
      >
        <RefreshCw size={13} /> 다시 시도
      </button>
    </div>
  );
}

function PlanEmptyCard() {
  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: 14,
        padding: '24px 28px',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 13, color: '#71717a', margin: '0 0 12px' }}>
        아직 진행 중인 플랜이 없습니다.
      </p>
      <Link
        href="/plan"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 18px',
          borderRadius: 8,
          backgroundColor: C.accent,
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        플랜 시작하기
      </Link>
    </div>
  );
}
