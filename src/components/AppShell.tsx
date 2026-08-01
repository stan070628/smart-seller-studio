'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { C } from '@/lib/design-tokens';
import AlertList from '@/components/alerts/AlertList';
import { NAV_ITEMS } from '@/lib/nav-items';
import TabBar from '@/components/TabBar';
import { useTabStore } from '@/store/useTabStore';
import { startTabCacheBridge } from '@/store/tab-cache-bridge';

/**
 * 주소 변화를 탭에 반영한다.
 * useSearchParams를 쓰므로 정적 프리렌더를 막지 않도록 Suspense 안에 격리한다.
 * AppShell 본체에 그대로 두면 AppShell을 쓰는 10개 레이아웃 전부가
 * 프리렌더에서 bail out한다 (빌드 실패의 원인이었다).
 */
function TabSync() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openTab = useTabStore((s) => s.openTab);

  // 사이드바 클릭·router.push·뒤로가기가 모두 여기로 모인다.
  useEffect(() => {
    const qs = searchParams.toString();
    openTab(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, searchParams, openTab]);

  return null;
}

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

  // 탭이 사라지면 그 라우트의 캐시를 해제한다.
  // effect가 아니라 렌더 중에 건다 — 자식 TabSync의 effect가 부모보다 먼저
  // 실행되므로, effect에 두면 첫 밀어내기를 놓친다. startTabCacheBridge는
  // 멱등해 여러 번 불려도 구독은 하나만 생긴다.
  // useTabStore는 모듈 스코프 zustand라 서버에서도 존재하며, 서버 렌더에서
  // 이 줄이 실행돼도 요청마다 새 프로세스/모듈 인스턴스이므로 누적되지 않는다.
  startTabCacheBridge();

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
            const childActive = item.children?.some((c) => isActive(c.href)) ?? false;
            const parentActive = active || childActive;
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 16px',
                    fontSize: 13,
                    fontWeight: parentActive ? 600 : 400,
                    color: parentActive ? C.sidebarTextActive : C.sidebarText,
                    textDecoration: 'none',
                    backgroundColor: parentActive ? C.sidebarActiveAccent : 'transparent',
                    position: 'relative',
                  }}
                >
                  {parentActive && (
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
                  <span style={{ opacity: parentActive ? 1 : 0.6, flexShrink: 0, display: 'flex' }}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
                {item.children?.map((child) => {
                  const cActive = isActive(child.href);
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 16px 6px 36px',
                        fontSize: 12,
                        fontWeight: cActive ? 600 : 400,
                        color: cActive ? C.sidebarTextActive : C.sidebarText,
                        textDecoration: 'none',
                        backgroundColor: cActive ? C.sidebarActiveAccent : 'transparent',
                        position: 'relative',
                      }}
                    >
                      {cActive && (
                        <span
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 4,
                            bottom: 4,
                            width: 3,
                            background: C.accent,
                            borderRadius: '0 2px 2px 0',
                          }}
                        />
                      )}
                      <span style={{ opacity: cActive ? 1 : 0.6, flexShrink: 0, display: 'flex' }}>
                        {child.icon}
                      </span>
                      {child.label}
                    </Link>
                  );
                })}
              </div>
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
        <Suspense fallback={null}>
          <TabSync />
        </Suspense>
        <TabBar />
        {children}
      </div>
    </div>
  );
}
