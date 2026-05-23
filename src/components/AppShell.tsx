'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { C } from '@/lib/design-tokens';
import AlertList from '@/components/alerts/AlertList';

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: '대시보드',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    href: '/sourcing',
    label: '소싱',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" strokeWidth="1.5" />
        <path d="M20 20l-3-3" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/editor',
    label: '에디터',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/listing',
    label: '상품등록',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M20 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1z" strokeWidth="1.5" />
        <path d="M16 3l-4 4-4-4" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/label',
    label: '라벨 인쇄',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="4" y="5" width="16" height="16" rx="2" strokeWidth="1.5" />
        <path d="M16 3v4M8 3v4M4 9h16" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/orders',
    label: '주문/매출',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/plan',
    label: '플랜',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const POLL_INTERVAL_MS = 5 * 60 * 1000;

interface AppShellProps {
  children: React.ReactNode;
  mainOverflow?: 'auto' | 'hidden';
  mainDisplay?: 'block' | 'flex';
}

export default function AppShell({
  children,
  mainOverflow = 'auto',
  mainDisplay = 'block',
}: AppShellProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAlerts, setShowAlerts] = useState(false);
  const badgeRef = useRef<HTMLDivElement>(null);

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  async function fetchUnreadCount() {
    try {
      const res = await fetch('/api/alerts?unread=true');
      const data = await res.json();
      if (data.success) setUnreadCount((data.rows as unknown[]).length);
    } catch {
      // 알림 배지는 부가 기능 — 실패해도 무시
    }
  }

  useEffect(() => {
    fetchUnreadCount();
    const id = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!showAlerts) return;
    const handler = (e: MouseEvent) => {
      if (badgeRef.current && !badgeRef.current.contains(e.target as Node)) {
        setShowAlerts(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAlerts]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* ── 사이드바 ── */}
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          backgroundColor: C.sidebarBg,
          borderRight: `1px solid ${C.sidebarBorder}`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 로고 */}
        <div
          style={{
            padding: '16px 18px 14px',
            borderBottom: `1px solid ${C.sidebarBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              background: C.accent,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 800,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            S
          </div>
          <Link href="/dashboard" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.sidebarTextActive, letterSpacing: '-0.3px' }}>
              Smart<span style={{ color: C.accent }}>Seller</span>Studio
            </span>
          </Link>
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              background: C.sidebarActiveAccent,
              color: C.accent,
              borderRadius: 3,
              border: `1px solid rgba(190,0,20,0.3)`,
              fontWeight: 600,
              letterSpacing: '0.05em',
              flexShrink: 0,
            }}
          >
            Beta
          </span>
        </div>

        {/* 네비게이션 */}
        <nav style={{ padding: '8px 0', flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? C.sidebarTextActive : C.sidebarText,
                  textDecoration: 'none',
                  backgroundColor: active ? C.sidebarActiveAccent : 'transparent',
                  position: 'relative',
                }}
              >
                {active && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 5,
                      bottom: 5,
                      width: 3,
                      background: C.accent,
                      borderRadius: '0 2px 2px 0',
                    }}
                  />
                )}
                <span style={{ opacity: active ? 1 : 0.6, flexShrink: 0, display: 'flex' }}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 알림 영역 */}
        <div
          style={{
            padding: '10px 14px',
            borderTop: `1px solid ${C.sidebarBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div ref={badgeRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => {
                setShowAlerts((v) => !v);
                if (!showAlerts) fetchUnreadCount();
              }}
              style={{
                position: 'relative',
                width: 30,
                height: 30,
                borderRadius: 6,
                border: `1px solid ${C.sidebarBorder}`,
                backgroundColor: C.sidebarHover,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                flexShrink: 0,
              }}
              title="알림"
            >
              🔔
              {unreadCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -3,
                    right: -3,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: C.accent,
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 2px',
                  }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {showAlerts && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: 8,
                  width: 360,
                  maxHeight: 480,
                  overflowY: 'auto',
                  backgroundColor: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
                  zIndex: 1000,
                }}
              >
                <div
                  style={{
                    padding: '10px 14px',
                    borderBottom: `1px solid ${C.border}`,
                    fontWeight: 700,
                    fontSize: 13,
                    color: C.text,
                  }}
                >
                  알림
                </div>
                <div style={{ padding: 8 }}>
                  <AlertList unreadOnly={false} />
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── 메인 영역 ── */}
      <div
        style={{
          flex: 1,
          overflow: mainOverflow,
          display: mainDisplay === 'flex' ? 'flex' : undefined,
          flexDirection: mainDisplay === 'flex' ? 'column' : undefined,
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
