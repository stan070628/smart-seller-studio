'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { C } from '@/lib/design-tokens';

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/label', label: '라벨 인쇄' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
  { href: '/roi', label: 'ROI 관리' },
];

export default function AppNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

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
    </header>
  );
}
