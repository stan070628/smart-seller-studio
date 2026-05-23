# Full-Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 페이지에 다크 사이드바 + 풀블리드 라이트 메인 레이아웃을 통일 적용하고, Pretendard 폰트와 새 컬러 토큰으로 전체 UI를 리프레시한다.

**Architecture:** 탑 바(AppNav)를 좌측 220px 다크 사이드바로 교체한다. `AppShell` 컴포넌트가 사이드바 + 메인 영역을 감싸는 단일 shell이 되고, 9개의 `layout.tsx` 파일이 모두 이를 사용한다. 페이지 레벨 `maxWidth` 제약을 제거해 콘텐츠가 화면을 꽉 채우게 한다. 색상 토큰 1개 파일(`design-tokens.ts`) 수정만으로 31개 컴포넌트 전체에 새 팔레트가 적용된다.

**Tech Stack:** Next.js App Router, React, TypeScript, inline styles (현재 패턴 유지), Pretendard Variable CDN

---

## 파일 맵

| 파일 | 변경 유형 | 목적 |
|------|-----------|------|
| `src/lib/design-tokens.ts` | 수정 | 새 컬러 팔레트 + 사이드바 토큰 추가 |
| `src/app/globals.css` | 수정 | Pretendard 폰트 로드, body font-family 업데이트 |
| `src/app/layout.tsx` | 수정 | Noto Sans KR 제거, Pretendard CDN 링크 교체 |
| `src/components/AppShell.tsx` | 신규 생성 | 다크 사이드바 + 메인 영역 shell |
| `src/components/AppNav.tsx` | 수정 | 탑바 → 사이드바로 교체 (AppShell 내부로 흡수) |
| `src/app/dashboard/layout.tsx` | 수정 | AppShell 사용 |
| `src/app/sourcing/layout.tsx` | 수정 | AppShell 사용 |
| `src/app/orders/layout.tsx` | 수정 | AppShell 사용 |
| `src/app/listing/layout.tsx` | 수정 | AppShell 사용 |
| `src/app/plan/layout.tsx` | 수정 | AppShell 사용 |
| `src/app/label/layout.tsx` | 수정 | AppShell 사용 (overflow: hidden) |
| `src/app/editor/layout.tsx` | 수정 | AppShell 사용 (overflow: hidden) |
| `src/app/ad-strategy/layout.tsx` | 수정 | AppShell 사용 |
| `src/app/calculator/layout.tsx` | 수정 | AppShell 사용 |
| `src/app/detail/layout.tsx` | 수정 | AppShell 사용 |
| `src/components/dashboard/DashboardClient.tsx` | 수정 | maxWidth: 1200 제거 |
| `src/components/orders/OrdersClient.tsx` | 수정 | maxWidth: 1100 제거 |
| `src/components/plan/PlanClient.tsx` | 수정 | maxWidth: 1100 제거 (2곳) |
| `src/components/listing/ListingDashboard.tsx` | 수정 | maxWidth: 1100 제거 |

---

## Task 1: design-tokens.ts 업데이트

**Files:**
- Modify: `src/lib/design-tokens.ts`

- [ ] **Step 1: 파일 교체**

```typescript
// src/lib/design-tokens.ts
export const C = {
  // ── 메인 영역 (라이트) ──────────────────────────
  bg:          '#f4f4f5',   // zinc-100 (이전: #f9f9f9)
  card:        '#ffffff',
  border:      '#e4e4e7',   // zinc-200 (이전: #eeeeee)
  text:        '#18181b',   // zinc-900 (이전: #1a1c1c)
  textSub:     '#71717a',   // zinc-500 (이전: #926f6b 핑크빛 제거)
  textMuted:   '#a1a1aa',   // zinc-400
  accent:      '#be0014',
  accentBg:    'rgba(190,0,20,0.07)',
  accentBorder:'rgba(190,0,20,0.15)',
  tableHeader: '#f4f4f5',
  rowHover:    '#f9f9f9',

  // ── 사이드바 (다크) ──────────────────────────────
  sidebarBg:           '#0a0a0a',
  sidebarBorder:       '#242424',
  sidebarHover:        '#1c1c1c',
  sidebarActiveAccent: '#1f0004',
  sidebarText:         '#d4d4d8',   // 다크 배경 위 선명한 텍스트
  sidebarTextActive:   '#ffffff',

  // ── 채널 ────────────────────────────────────────
  coupang: '#be0014',
  naver:   '#03c75a',

  // ── 시맨틱 ──────────────────────────────────────
  success: '#16a34a',
  warning: '#d97706',
  info:    '#2563eb',
} as const;

export type DesignTokens = typeof C;
```

- [ ] **Step 2: 빌드 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

`C.green`, `C.red`, `C.greenBg`, `C.surface` 등 기존에 없던 키를 일부 컴포넌트가 참조할 수 있다. 오류가 나오면 해당 컴포넌트에서 대체 값을 인라인으로 넣는다.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/design-tokens.ts
git commit -m "design: 새 컬러 토큰 — zinc 팔레트 + 사이드바 토큰 추가"
```

---

## Task 2: 폰트 교체 — Pretendard Variable

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: layout.tsx에서 Noto Sans KR 링크 제거하고 Pretendard로 교체**

`src/app/layout.tsx`에서 `<head>` 블록을 아래로 교체한다:

```tsx
<head>
  <link rel="preconnect" href="https://cdn.jsdelivr.net" />
  <link
    href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
    rel="stylesheet"
  />
</head>
```

- [ ] **Step 2: globals.css body font-family 업데이트**

`globals.css`의 `body` 블록을 아래로 교체한다:

```css
body {
  background: var(--background);
  color: var(--foreground);
  font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont,
    'Apple SD Gothic Neo', sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 3: @theme inline에 폰트 변수 업데이트**

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: var(--font-geist-mono);
}
```

- [ ] **Step 4: 커밋**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "design: Pretendard Variable 폰트 적용 — Noto Sans KR 제거"
```

---

## Task 3: AppShell 컴포넌트 신규 생성

**Files:**
- Create: `src/components/AppShell.tsx`

이 컴포넌트가 모든 레이아웃의 뼈대가 된다. 사이드바(220px 다크) + 메인(flex-1 라이트)을 수평 배치한다.

- [ ] **Step 1: AppShell.tsx 작성**

```tsx
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
      // 알림 배지는 부가 기능
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

        {/* 알림 + 유저 영역 */}
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
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/AppShell.tsx
git commit -m "feat: AppShell — 다크 사이드바 + 풀블리드 메인 레이아웃 shell"
```

---

## Task 4: 모든 layout.tsx 파일 AppShell로 교체

**Files:**
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/app/sourcing/layout.tsx`
- Modify: `src/app/orders/layout.tsx`
- Modify: `src/app/listing/layout.tsx`
- Modify: `src/app/plan/layout.tsx`
- Modify: `src/app/ad-strategy/layout.tsx`
- Modify: `src/app/calculator/layout.tsx`
- Modify: `src/app/detail/layout.tsx`
- Modify: `src/app/label/layout.tsx`
- Modify: `src/app/editor/layout.tsx`

**overflow: auto 페이지** (dashboard, sourcing, orders, listing, plan, ad-strategy, calculator, detail) — 아래 패턴 사용:

```tsx
import AppShell from '@/components/AppShell';

export default function XxxLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

**overflow: hidden 페이지** (label — 인쇄 레이아웃 고정):

```tsx
import AppShell from '@/components/AppShell';

export default function LabelLayout({ children }: { children: React.ReactNode }) {
  return <AppShell mainOverflow="hidden">{children}</AppShell>;
}
```

**overflow: hidden + flex 페이지** (editor — Fabric.js 캔버스):

```tsx
import AppShell from '@/components/AppShell';

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <AppShell mainOverflow="hidden" mainDisplay="flex">{children}</AppShell>;
}
```

- [ ] **Step 1: dashboard, sourcing, orders, listing, plan, ad-strategy, calculator, detail layout.tsx 교체 (auto 패턴)**

각 파일 내용을 위 auto 패턴으로 교체한다. 파일 목록:
- `src/app/dashboard/layout.tsx`
- `src/app/sourcing/layout.tsx`
- `src/app/orders/layout.tsx`
- `src/app/listing/layout.tsx`
- `src/app/plan/layout.tsx`
- `src/app/ad-strategy/layout.tsx`
- `src/app/calculator/layout.tsx`
- `src/app/detail/layout.tsx`

- [ ] **Step 2: label/layout.tsx 교체 (overflow: hidden)**

```tsx
import AppShell from '@/components/AppShell';

export default function LabelLayout({ children }: { children: React.ReactNode }) {
  return <AppShell mainOverflow="hidden">{children}</AppShell>;
}
```

- [ ] **Step 3: editor/layout.tsx 교체 (overflow: hidden + flex)**

```tsx
import AppShell from '@/components/AppShell';

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <AppShell mainOverflow="hidden" mainDisplay="flex">{children}</AppShell>;
}
```

- [ ] **Step 4: AppNav.tsx 삭제 — AppShell이 대체**

AppShell이 AppNav의 모든 기능(네비게이션, 알림)을 흡수했으므로 AppNav.tsx를 삭제한다.

```bash
git rm src/components/AppNav.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add src/app/*/layout.tsx src/app/editor/layout.tsx
git commit -m "feat: 모든 layout.tsx AppShell로 교체 — 사이드바 네비게이션 통일 적용"
```

---

## Task 5: 페이지 레벨 maxWidth 제거

각 페이지의 최상위 `<main>` 또는 wrapper div에서 `max-width` 제약과 `margin: 0 auto` 를 제거한다. 콘텐츠 내부(모달, 테이블 셀)의 maxWidth는 건드리지 않는다.

**Files:**
- Modify: `src/components/dashboard/DashboardClient.tsx:127`
- Modify: `src/components/orders/OrdersClient.tsx:22`
- Modify: `src/components/plan/PlanClient.tsx:1715,1782`
- Modify: `src/components/listing/ListingDashboard.tsx:2250`

- [ ] **Step 1: DashboardClient.tsx — maxWidth 제거**

`DashboardClient.tsx:127` 줄의 `<main>` 태그를 찾아 교체:

변경 전:
```tsx
<main style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: '28px 24px' }}>
```
변경 후:
```tsx
<main style={{ width: '100%', padding: '28px 24px' }}>
```

- [ ] **Step 2: OrdersClient.tsx — maxWidth 제거**

`OrdersClient.tsx:22` 줄:

변경 전:
```tsx
<main style={{ maxWidth: '1100px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
```
변경 후:
```tsx
<main style={{ width: '100%', padding: '28px 24px' }}>
```

- [ ] **Step 3: PlanClient.tsx — maxWidth 2곳 제거**

`PlanClient.tsx`에서 `maxWidth: 1100`이 있는 두 곳을 찾아 제거한다. 해당 줄의 `maxWidth: 1100,`과 `margin: '0 auto',` 를 제거한다.

- [ ] **Step 4: ListingDashboard.tsx — maxWidth 제거**

`ListingDashboard.tsx:2250`의 wrapper div에서 `maxWidth: '1100px'`과 `margin: '0 auto'`를 제거한다.

- [ ] **Step 5: 커밋**

```bash
git add src/components/dashboard/DashboardClient.tsx \
        src/components/orders/OrdersClient.tsx \
        src/components/plan/PlanClient.tsx \
        src/components/listing/ListingDashboard.tsx
git commit -m "design: 페이지 레벨 maxWidth 제거 — 풀블리드 레이아웃 완성"
```

---

## Task 6: 시각적 검증

- [ ] **Step 1: dev 서버 시작**

```bash
npm run dev
```

- [ ] **Step 2: 각 페이지 확인 체크리스트**

브라우저에서 아래 경로를 순서대로 열고 확인한다:

| URL | 확인 항목 |
|-----|-----------|
| `/dashboard` | 사이드바 표시, 메인 콘텐츠 풀블리드 |
| `/sourcing` | 사이드바 active 상태 정확, 콘텐츠 풀블리드 |
| `/orders` | 테이블 화면 폭 활용 |
| `/listing` | 상품 목록 폭 확장 |
| `/plan` | 플랜 콘텐츠 폭 확장 |
| `/label` | 인쇄 레이아웃 깨지지 않음 (overflow: hidden 유지) |
| `/editor` | Fabric.js 캔버스 정상, 에디터 사이드바 공존 |
| `/orders` (원가관리 탭) | 숫자 폰트 Pretendard tabular-nums 선명 |

- [ ] **Step 3: TypeScript 오류 없음 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 최종 커밋**

```bash
git add -p  # 남은 변경사항 있으면 스테이징
git commit -m "design: 전체 UI 리디자인 완료 — 다크 사이드바 + 풀블리드 + Pretendard"
```

---

## 자기 검토 (Self-Review)

**스펙 커버리지:**
- ✅ 다크 사이드바 (220px, #0a0a0a) → Task 3
- ✅ 풀블리드 메인 — maxWidth 제거 → Task 4, 5
- ✅ Pretendard 폰트 → Task 2
- ✅ 새 컬러 토큰 (zinc 팔레트, sidebarText 선명) → Task 1
- ✅ 모든 9개 layout.tsx 통일 → Task 4
- ✅ editor/label overflow 보존 → Task 4

**플레이스홀더 없음** ✅

**타입 일관성:**
- `AppShell` props: `mainOverflow: 'auto' | 'hidden'`, `mainDisplay: 'block' | 'flex'` — Task 3에서 정의, Task 4에서 동일하게 사용
- `C.sidebarBg`, `C.sidebarBorder` 등 — Task 1에서 정의, Task 3에서 사용
