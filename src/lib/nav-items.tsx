/**
 * nav-items.tsx
 * 사이드바 내비게이션 항목 정의와 경로→탭 정보 유도 함수
 *
 * AppShell과 TabBar가 함께 쓴다.
 */

export type NavChild = { href: string; label: string; icon: React.ReactNode };
export type NavItem = { href: string; label: string; icon: React.ReactNode; children?: NavChild[] };

export const NAV_ITEMS: NavItem[] = [
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
    href: '/listing',
    label: '상품등록',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M20 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1z" strokeWidth="1.5" />
        <path d="M16 3l-4 4-4-4" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    children: [
      {
        href: '/editor',
        label: '에디터',
        icon: (
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        href: '/listing/detail-maker',
        label: '상품상세 자동만들기',
        icon: (
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="1.5" />
            <path d="M4 9h16M9 9v11" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
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

/** 경로에서 탭 식별자(첫 세그먼트)를 얻는다. 캐시 키 접두사와 같은 값이다. */
export function routeIdOf(href: string): string {
  const path = href.split('?')[0];
  return path.split('/').filter(Boolean)[0] ?? 'dashboard';
}

/**
 * 경로에 맞는 탭 라벨을 얻는다.
 * 하위 항목을 먼저 확인해 더 구체적인 라벨을 고른다.
 */
export function labelForHref(href: string): string {
  const path = href.split('?')[0];

  for (const item of NAV_ITEMS) {
    for (const child of item.children ?? []) {
      if (path === child.href || path.startsWith(`${child.href}/`)) return child.label;
    }
  }
  for (const item of NAV_ITEMS) {
    if (path === item.href || path.startsWith(`${item.href}/`)) return item.label;
  }
  return routeIdOf(href);
}
