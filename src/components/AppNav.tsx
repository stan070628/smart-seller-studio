'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { C } from '@/lib/design-tokens';
import AlertList from '@/components/alerts/AlertList';

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/label', label: '라벨 인쇄' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
];

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export default function AppNav() {
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
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 52,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        borderBottom: `1px solid ${C.border}`,
        backgroundColor: C.card,
        gap: 24,
      }}
    >
      <Link
        href="/dashboard"
        style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
      >
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
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? C.accent : '#71717a',
                textDecoration: 'none',
                backgroundColor: active ? 'rgba(190,0,20,0.07)' : 'transparent',
                border: active ? '1px solid rgba(190,0,20,0.15)' : '1px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 알림 배지 */}
      <div ref={badgeRef} style={{ marginLeft: 'auto', position: 'relative' }}>
        <button
          type="button"
          onClick={() => {
            setShowAlerts((v) => !v);
            if (!showAlerts) fetchUnreadCount();
          }}
          style={{
            position: 'relative',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: `1px solid ${C.border}`,
            backgroundColor: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
          title="알림"
        >
          🔔
          {unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: C.accent,
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 3px',
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
              top: '100%',
              right: 0,
              marginTop: 8,
              width: 360,
              maxHeight: 480,
              overflowY: 'auto',
              backgroundColor: '#fff',
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                padding: '12px 16px',
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
    </header>
  );
}
