'use client';

/**
 * ListingDashboard.tsx
 * 오픈마켓 상품 자동등록 메인 클라이언트 컴포넌트
 *
 * 레이아웃: 헤더 → 플랫폼 탭 → 빈 상태 or 등록 테이블
 * 스타일: 인라인 style 사용 (밝은 테마)
 */

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useListingStore } from '@/store/useListingStore';
import { PLATFORMS } from '@/types/listing';
import type { PlatformId, ListingStatus, ProductListing } from '@/types/listing';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  rowHover: '#f5f5f5',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 날짜 포맷
// ─────────────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 숫자 포맷 (천 단위 구분)
// ─────────────────────────────────────────────────────────────────────────────
function formatPrice(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

// ─────────────────────────────────────────────────────────────────────────────
// 상태 뱃지
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: '초안',
  pending: '대기중',
  uploading: '업로드중',
  registered: '등록완료',
  failed: '실패',
  deleted: '삭제됨',
};

const STATUS_COLORS: Record<ListingStatus, { bg: string; text: string }> = {
  draft: { bg: '#f3f3f3', text: '#71717a' },
  pending: { bg: '#fef9c3', text: '#92400e' },
  uploading: { bg: '#dbeafe', text: '#1d4ed8' },
  registered: { bg: '#dcfce7', text: '#15803d' },
  failed: { bg: '#fee2e2', text: '#b91c1c' },
  deleted: { bg: '#f3f3f3', text: '#9ca3af' },
};

function StatusBadge({ status }: { status: ListingStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '100px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: color.bg,
        color: color.text,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 등록 상품 테이블
// ─────────────────────────────────────────────────────────────────────────────
function ListingTable({ listings }: { listings: ProductListing[] }) {
  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: C.tableHeader }}>
            {['상품명', '상태', '플랫폼 상품번호', '가격', '등록일'].map((col) => (
              <th
                key={col}
                style={{
                  padding: '10px 16px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: C.textSub,
                  textAlign: 'left',
                  borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {listings.map((item) => (
            <tr
              key={item.id}
              style={{ borderBottom: `1px solid ${C.border}` }}
            >
              {/* 상품명 */}
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: C.text,
                  maxWidth: '280px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.title}
              </td>
              {/* 상태 */}
              <td style={{ padding: '12px 16px' }}>
                <StatusBadge status={item.status} />
              </td>
              {/* 플랫폼 상품번호 */}
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: item.platformProductId ? C.text : C.textSub,
                  fontFamily: 'monospace',
                }}
              >
                {item.platformProductId ? (
                  item.platformProductUrl ? (
                    <a
                      href={item.platformProductUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: C.accent, textDecoration: 'none' }}
                    >
                      {item.platformProductId}
                    </a>
                  ) : (
                    item.platformProductId
                  )
                ) : (
                  '-'
                )}
              </td>
              {/* 가격 */}
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: C.text,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {formatPrice(item.price)}
              </td>
              {/* 등록일 */}
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: '13px',
                  color: C.textSub,
                  whiteSpace: 'nowrap',
                }}
              >
                {item.registeredAt ? formatDate(item.registeredAt) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 빈 상태: 연동 전
// ─────────────────────────────────────────────────────────────────────────────
function EmptyConnectState({ platformLabel }: { platformLabel: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '80px 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          backgroundColor: 'rgba(190, 0, 20, 0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
        }}
      >
        🔗
      </div>
      <div>
        <p
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: C.text,
            marginBottom: '6px',
          }}
        >
          아직 연동된 플랫폼이 없습니다.
        </p>
        <p style={{ fontSize: '13px', color: C.textSub }}>
          플랫폼 API 키를 등록하면 상품을 자동으로 등록할 수 있습니다.
        </p>
      </div>
      <button
        style={{
          padding: '9px 20px',
          backgroundColor: C.btnPrimaryBg,
          color: C.btnPrimaryText,
          border: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
        onClick={() => alert('Phase 2에서 구현 예정입니다.')}
      >
        {platformLabel} 연동하기
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 빈 상태: 연동 후 등록 상품 없음
// ─────────────────────────────────────────────────────────────────────────────
function EmptyListState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '80px 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          backgroundColor: C.tableHeader,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
        }}
      >
        📦
      </div>
      <div>
        <p
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: C.text,
            marginBottom: '6px',
          }}
        >
          등록된 상품이 없습니다.
        </p>
        <p style={{ fontSize: '13px', color: C.textSub }}>
          소싱 페이지에서 상품을 선택한 후 등록하세요.
        </p>
      </div>
      <Link
        href="/sourcing"
        style={{
          padding: '9px 20px',
          backgroundColor: C.btnSecondaryBg,
          color: C.btnSecondaryText,
          textDecoration: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          border: `1px solid ${C.border}`,
        }}
      >
        소싱 페이지로 이동
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 플랫폼 탭
// ─────────────────────────────────────────────────────────────────────────────
function PlatformTabs({
  activePlatform,
  onSelect,
}: {
  activePlatform: PlatformId;
  onSelect: (id: PlatformId) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0',
        borderBottom: `1px solid ${C.border}`,
        backgroundColor: C.card,
        padding: '0 24px',
      }}
    >
      {PLATFORMS.map((platform) => {
        const isActive = activePlatform === platform.id;
        return (
          <button
            key={platform.id}
            onClick={() => platform.enabled && onSelect(platform.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '12px 16px',
              fontSize: '13px',
              fontWeight: isActive ? 700 : 500,
              color: isActive ? C.accent : C.text,
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: isActive ? `2px solid ${C.accent}` : '2px solid transparent',
              cursor: platform.enabled ? 'pointer' : 'not-allowed',
              opacity: platform.enabled ? 1 : 0.4,
              marginBottom: '-1px',
              transition: 'color 0.15s',
            }}
          >
            <span style={{ fontSize: '16px' }}>{platform.emoji}</span>
            <span>{platform.label}</span>
            {!platform.enabled && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: '#71717a',
                  backgroundColor: '#f3f3f3',
                  border: `1px solid ${C.border}`,
                  borderRadius: '4px',
                  padding: '1px 5px',
                }}
              >
                준비중
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

// Phase 1에서는 연동 상태를 로컬로 관리 (실제 API 연동 전)
const CONNECTED_PLATFORMS = new Set<PlatformId>(); // 연동된 플랫폼 없음

export default function ListingDashboard() {
  const { activePlatform, listings, isLoading, setActivePlatform, fetchListings } =
    useListingStore();

  // 마운트 시 목록 조회
  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const activeMeta = PLATFORMS.find((p) => p.id === activePlatform)!;
  const isConnected = CONNECTED_PLATFORMS.has(activePlatform);
  const filteredListings = listings.filter((l) => l.platformId === activePlatform);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: C.bg,
      }}
    >
      {/* -------------------------------------------------------------------- */}
      {/* 헤더                                                                  */}
      {/* -------------------------------------------------------------------- */}
      <header
        style={{
          flexShrink: 0,
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.card,
          zIndex: 50,
        }}
      >
        {/* 로고 + 탭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                fontSize: '16px',
                fontWeight: 700,
                letterSpacing: '-0.3px',
                color: C.text,
              }}
            >
              Smart
              <span style={{ color: C.accent }}>Seller</span>
              Studio
            </span>
            <span
              style={{
                backgroundColor: 'rgba(190, 0, 20, 0.08)',
                color: C.accent,
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 9px',
                borderRadius: '100px',
                border: '1px solid rgba(190, 0, 20, 0.2)',
              }}
            >
              Beta
            </span>
          </div>

          {/* 네비게이션 탭 */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { href: '/dashboard', label: '대시보드' },
              { href: '/sourcing', label: '소싱' },
              { href: '/editor', label: '에디터' },
              { href: '/listing', label: '상품등록', active: true },
              { href: '/orders', label: '주문/매출' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: item.active ? 600 : 500,
                  color: item.active ? C.accent : C.textSub,
                  textDecoration: 'none',
                  backgroundColor: item.active ? 'rgba(190, 0, 20, 0.07)' : 'transparent',
                  border: item.active ? '1px solid rgba(190, 0, 20, 0.15)' : '1px solid transparent',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* -------------------------------------------------------------------- */}
      {/* 플랫폼 탭                                                              */}
      {/* -------------------------------------------------------------------- */}
      <PlatformTabs activePlatform={activePlatform} onSelect={setActivePlatform} />

      {/* -------------------------------------------------------------------- */}
      {/* 본문                                                                   */}
      {/* -------------------------------------------------------------------- */}
      <main
        style={{
          flex: 1,
          padding: '24px',
          maxWidth: '1200px',
          width: '100%',
          margin: '0 auto',
        }}
      >
        {/* 로딩 */}
        {isLoading && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '80px 24px',
              color: C.textSub,
              fontSize: '14px',
            }}
          >
            불러오는 중...
          </div>
        )}

        {/* 연동 전 빈 상태 */}
        {!isLoading && !isConnected && (
          <EmptyConnectState platformLabel={activeMeta.label} />
        )}

        {/* 연동 후 데이터 없음 */}
        {!isLoading && isConnected && filteredListings.length === 0 && (
          <EmptyListState />
        )}

        {/* 등록 상품 테이블 */}
        {!isLoading && isConnected && filteredListings.length > 0 && (
          <>
            {/* 상단 요약 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}
            >
              <span style={{ fontSize: '13px', color: C.textSub }}>
                총{' '}
                <strong style={{ color: C.text, fontWeight: 600 }}>
                  {filteredListings.length}
                </strong>
                개 상품
              </span>
            </div>
            <ListingTable listings={filteredListings} />
          </>
        )}
      </main>
    </div>
  );
}
