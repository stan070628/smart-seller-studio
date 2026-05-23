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
  type OrdersSummaryData,
  type ProductCountData,
} from '@/lib/dashboard/types';
import { WBS_DATA, WEEKLY_TARGETS } from '@/lib/plan/constants';
import { getCurrentWeek, getDaysIntoWeek } from '@/lib/plan/week';
import { loadDailyRecords, sumWeekRevenue, computeCumulativeActual } from '@/lib/plan/daily-records';


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
  const [orders, setOrders] = useState<OrdersSummaryData | null>(null);
  const [productCount, setProductCount] = useState<ProductCountData | null>(null);
  const [planData, setPlanData] = useState<PlanLocalData | null>(null);
  const [isOrdersLoading, setIsOrdersLoading] = useState(true);
  const [isProductCountLoading, setIsProductCountLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // 플랜 데이터는 client side localStorage에서만
  useEffect(() => {
    setPlanData(readPlanLocalData());
  }, []);

  const fetchOrders = async (p: Period) => {
    setIsOrdersLoading(true);
    setOrdersError(null);
    try {
      const res = await fetch(`/api/dashboard/orders-summary?period=${p}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '요청 실패');
      setOrders(json.data);
    } catch (err) {
      setOrdersError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setIsOrdersLoading(false);
    }
  };

  const fetchProductCount = async () => {
    setIsProductCountLoading(true);
    try {
      const res = await fetch('/api/dashboard/product-count');
      const json = await res.json();
      if (json.success) setProductCount(json.data);
    } catch {
      // 상품 수 조회 실패는 위젯 자체를 dim 처리. 큰 흐름은 차단하지 않음.
    } finally {
      setIsProductCountLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders(period);
  }, [period]);

  // product-count는 period와 무관하므로 마운트 시 1회만.
  useEffect(() => {
    fetchProductCount();
  }, []);

  const refreshAll = () => {
    fetchOrders(period);
    fetchProductCount();
  };

  const chartActual = useMemo(() => {
    const apiActual = orders?.revenue12w?.actual;
    if (apiActual?.some((v) => v !== null)) return apiActual;
    return planData?.cumulativeActual ?? new Array(12).fill(null);
  }, [orders, planData]);

  return (
    <div style={{ backgroundColor: '#f5f5f7', minHeight: '100%' }}>
      {/* ── 메인 ─────────────────── */}
      <main style={{ width: '100%', padding: '28px 24px' }}>
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
          <div style={{ flex: 1 }} />
          <button
            onClick={refreshAll}
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

          {/* 등록 상품 위젯 — 자체 로딩/소스 표기 */}
          {productCount ? (
            <ProductCountWidget coupang={productCount.coupang} naver={productCount.naver} />
          ) : isProductCountLoading ? (
            <ProductCountSkeleton />
          ) : null}

          {/* 주문 파이프라인 — 자체 로딩/에러 분기 */}
          {isOrdersLoading && !orders ? (
            <LoadingCard />
          ) : ordersError && !orders ? (
            <ErrorCard error={ordersError} onRetry={() => fetchOrders(period)} />
          ) : orders ? (
            <>
              <OrderPipeline
                coupang={orders.pipeline.coupang}
                naver={orders.pipeline.naver}
                rg={orders.pipeline.rg}
                period={period}
                onPeriodChange={setPeriod}
                coupangDimmed={(productCount?.coupang ?? 0) === 0}
                naverDimmed={(productCount?.naver ?? 0) === 0}
              />
              <RevenueChart
                weeks={orders.revenue12w.weeks}
                target={orders.revenue12w.target}
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

function ProductCountSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 16,
        backgroundColor: C.card,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
      }}
    >
      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#a1a1aa' }} />
      <span style={{ fontSize: 12, color: '#71717a' }}>등록 상품 수 집계 중…</span>
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
