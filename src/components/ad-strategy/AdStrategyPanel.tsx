'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import type { AdStrategyReport, CollectedData } from '@/lib/ad-strategy/types';
import UrgentActionCard from './UrgentActionCard';
import ProductAdTable from './ProductAdTable';
import SourcingAlertList from './SourcingAlertList';

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
  { href: '/ad-strategy', label: '광고전략', active: true },
];

type Status = 'idle' | 'collecting' | 'analyzing' | 'done' | 'error';

const STATUS_MSG: Record<Status, string> = {
  idle: '',
  collecting: '상품 목록 및 광고 현황 수집 중...',
  analyzing: 'AI 전략 분석 중...',
  done: '분석 완료',
  error: '',
};

export default function AdStrategyPanel() {
  const [status, setStatus] = useState<Status>('idle');
  const [report, setReport] = useState<AdStrategyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null);

  const handleAnalyze = useCallback(async (force = false) => {
    setStatus('collecting');
    setError(null);

    try {
      // 1. 수집
      const collectRes = await fetch('/api/ad-strategy/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const collectJson = (await collectRes.json()) as
        | { success: true; data: CollectedData; fromCache: boolean }
        | { success: false; error: string };

      if (!collectJson.success) throw new Error(collectJson.error);

      // 2. 분석
      setStatus('analyzing');
      const analyzeRes = await fetch('/api/ad-strategy/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: collectJson.data }),
      });
      const analyzeJson = (await analyzeRes.json()) as
        | { success: true; report: AdStrategyReport }
        | { success: false; error: string };

      if (!analyzeJson.success) throw new Error(analyzeJson.error);

      setReport(analyzeJson.report);
      setLastAnalyzedAt(new Date().toLocaleString('ko-KR'));
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
      setStatus('error');
    }
  }, []);

  const isLoading = status === 'collecting' || status === 'analyzing';
  const isSessionError =
    error?.includes('쿠키') ||
    error?.includes('세션') ||
    error?.includes('만료');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f5f5f7', fontFamily: "'Noto Sans KR', sans-serif" }}>
      {/* 앱 헤더 */}
      <header
        style={{
          flexShrink: 0,
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: '1px solid #e5e5e5',
          backgroundColor: '#fff',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.3px', color: '#18181b' }}>
              Smart<span style={{ color: '#be0014' }}>Seller</span>Studio
            </span>
            <span style={{ backgroundColor: 'rgba(190,0,20,0.08)', color: '#be0014', fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '100px', border: '1px solid rgba(190,0,20,0.2)' }}>
              Beta
            </span>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: item.active ? 600 : 500,
                  color: item.active ? '#be0014' : '#71717a',
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
      </header>

      {/* 본문 */}
      <main style={{ flex: 1, maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 페이지 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111' }}>
            광고 전략 분석
          </h1>
          {lastAnalyzedAt && (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280' }}>
              마지막 분석: {lastAnalyzedAt}
            </p>
          )}
        </div>
        <button
          onClick={() => handleAnalyze(true)}
          disabled={isLoading}
          style={{
            padding: '10px 20px',
            background: isLoading ? '#9ca3af' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {isLoading ? STATUS_MSG[status] : '분석 시작'}
        </button>
      </div>

      {/* 에러 */}
      {status === 'error' && error && (
        <div
          style={{
            padding: '12px 16px',
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            color: '#b91c1c',
            fontSize: '13px',
          }}
        >
          {isSessionError ? (
            <>
              <strong>세션 오류:</strong> {error}
              <br />
              <small style={{ display: 'block', marginTop: '6px', color: '#991b1b' }}>
                Wing: 터미널에서 <code>$B state save wing-session</code> 을 실행해 세션을 갱신하세요.
                광고센터: <code>.env.local</code>의 <code>COUPANG_ADS_COOKIE</code>를 갱신하세요.
              </small>
            </>
          ) : (
            error
          )}
        </div>
      )}

      {/* 순이익 계산 안내 배너 */}
      <div
        style={{
          padding: '12px 16px',
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '8px',
          fontSize: '13px',
          color: '#1d4ed8',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600 }}>순이익 계산 방법:</span>
        <span>
          상품별 <strong>원가(VAT포함)</strong>를 테이블에서 직접 입력하면
          건당 순이익 · 월 순이익 · 손익분기점 ROAS가 자동 계산됩니다.
        </span>
        <span style={{ color: '#6b7280', fontSize: '12px' }}>
          수수료율 기본값: 10.8% (로켓그로스) | 원가는 브라우저에 저장됩니다
        </span>
      </div>

      {/* 빈 상태 */}
      {status === 'idle' && !report && (
        <div
          style={{
            padding: '48px',
            textAlign: 'center',
            color: '#9ca3af',
            border: '2px dashed #e5e7eb',
            borderRadius: '12px',
          }}
        >
          <p style={{ margin: 0, fontSize: '15px', lineHeight: '1.6' }}>
            "분석 시작" 버튼을 클릭하면 쿠팡 윙스 + 광고센터 데이터를 수집하고
            <br />
            돈버는하마 노하우 기반 AI 전략을 생성합니다.
          </p>
        </div>
      )}

      {/* 결과 */}
      {report && (
        <>
          {/* 캠페인 요약 수치 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {[
              {
                label: '주간 광고비',
                value: report.campaignSummary.totalBudget.toLocaleString('ko-KR') + '원',
                alert: false,
              },
              {
                label: '전체 ROAS',
                value: report.campaignSummary.totalRoas + '%',
                alert: false,
              },
              {
                label: '운영 캠페인',
                value: report.campaignSummary.activeCampaigns + '개',
                alert: false,
              },
              {
                label: '이미지 차단',
                value: report.campaignSummary.blockedProducts + '개',
                alert: report.campaignSummary.blockedProducts > 0,
              },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  padding: '16px',
                  background: item.alert ? '#fee2e2' : '#f9fafb',
                  border: `1px solid ${item.alert ? '#fca5a5' : '#e5e7eb'}`,
                  borderRadius: '8px',
                }}
              >
                <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#6b7280' }}>
                  {item.label}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: '20px',
                    fontWeight: 700,
                    color: item.alert ? '#b91c1c' : '#111',
                  }}
                >
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {/* AI 한 줄 요약 */}
          <div
            style={{
              padding: '14px 18px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              fontSize: '14px',
              color: '#1d4ed8',
            }}
          >
            {report.summary}
          </div>

          {/* 즉시 실행 */}
          {report.urgentActions.length > 0 && (
            <section>
              <h2
                style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#dc2626' }}
              >
                즉시 실행 {report.urgentActions.length}건
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                {report.urgentActions.map((a, i) => (
                  <UrgentActionCard key={i} action={a} />
                ))}
              </div>
            </section>
          )}

          {/* 상품별 광고 등급 */}
          <section>
            <h2
              style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#374151' }}
            >
              상품별 광고 등급
            </h2>
            <ProductAdTable products={report.productAdRanking} />
          </section>

          {/* 소싱 경보 */}
          <section>
            <h2
              style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#374151' }}
            >
              소싱 경보
            </h2>
            <SourcingAlertList alerts={report.sourcingAlerts} />
          </section>
        </>
      )}
      </div>
      </main>
    </div>
  );
}
