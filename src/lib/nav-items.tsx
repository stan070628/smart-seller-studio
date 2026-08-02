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

/**
 * 쿼리·해시를 떼고 경로를 정규화한다.
 * routeIdOf와 labelForHref가 같은 기준을 쓰게 하는 유일한 지점이다.
 */
function normalize(href: string): { id: string; path: string } {
  const segments = href.split(/[?#]/)[0].split('/').filter(Boolean);
  if (segments.length === 0) return { id: 'dashboard', path: '/dashboard' };
  const path = `/${segments.join('/')}`;
  return { id: path.slice(1), path };
}

/**
 * NAV_ITEMS에 없는 하위 경로의 라벨.
 * 사이드바에는 노출하고 싶지 않지만(NAV_ITEMS에 넣으면 사이드바에도 나타난다)
 * 탭에서는 구분되는 이름이 필요한 화면들이다. 동적 세그먼트가 낀 경로는
 * 정확 매칭 대신 정규식으로 잡는다 (예: /listing/<상품id>/detail-maker-pro).
 */
const EXTRA_LABEL_RULES: { test: RegExp; label: string }[] = [
  { test: /^\/listing\/auto-register$/, label: '쿠팡 자동등록' },
  { test: /^\/listing\/import-1688$/, label: '1688에서 가져오기' },
  { test: /^\/listing\/[^/]+\/detail-maker-pro$/, label: 'PRO 상세페이지 만들기' },
  { test: /^\/sourcing\/margin-calculator$/, label: '1688 사입 마진 계산기' },
  { test: /^\/sourcing\/trademark-precheck$/, label: '1688 발주 사전체크' },
  { test: /^\/sourcing\/inbound-checklist\/print$/, label: '1688 입고 체크리스트 (인쇄)' },
  { test: /^\/sourcing\/inbound-checklist$/, label: '1688 입고 체크리스트' },
  { test: /^\/plan\/alerts$/, label: '알림' },
  { test: /^\/plan\/retro$/, label: '회고' },
  { test: /^\/label\/event$/, label: '이벤트 라벨' },
];

/**
 * 경로에서 탭 식별자(쿼리·해시를 뗀 경로 전체)를 얻는다. 캐시 키 접두사와 같은 값이다.
 *
 * 2026-08-02 이전에는 첫 세그먼트만 썼다 — `/listing`과 `/listing/detail-maker`가
 * 같은 식별자('listing')를 나눠 써서 탭 하나를 두고 서로 덮어썼다. 상세만들기로
 * 작업하다 사이드바에서 상품등록을 누르면 상세만들기 탭 자체가 사라지는 버그였다.
 * 이제 경로 전체를 식별자로 써서 하위 경로마다 별개 탭을 갖는다.
 * (docs/superpowers/specs/2026-08-01-tab-navigation-design.md 참고)
 */
export function routeIdOf(href: string): string {
  return normalize(href).id;
}

/**
 * 경로에 맞는 탭 라벨을 얻는다.
 * 우선순위: NAV_ITEMS 하위 항목 → EXTRA_LABEL_RULES → NAV_ITEMS 최상위 항목 → 식별자 그대로.
 * EXTRA_LABEL_RULES를 최상위 항목의 접두사 매칭보다 먼저 보는 이유 —
 * 그러지 않으면 `/listing/auto-register`가 `/listing` 접두사에 먼저 걸려
 * "상품등록"이라는 부모 라벨을 갖게 되고, 하위 경로가 여럿 열려도 전부
 * 같은 이름으로 보이게 된다.
 */
export function labelForHref(href: string): string {
  const { id, path } = normalize(href);

  for (const item of NAV_ITEMS) {
    for (const child of item.children ?? []) {
      if (path === child.href || path.startsWith(`${child.href}/`)) return child.label;
    }
  }
  for (const rule of EXTRA_LABEL_RULES) {
    if (rule.test.test(path)) return rule.label;
  }
  for (const item of NAV_ITEMS) {
    if (path === item.href || path.startsWith(`${item.href}/`)) return item.label;
  }
  return id;
}
