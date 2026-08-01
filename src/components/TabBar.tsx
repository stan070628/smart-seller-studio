'use client';

/**
 * TabBar.tsx
 * 메인 영역 최상단 가로 탭 바
 *
 * 탭 상태만 알고 캐시는 모른다. 둘의 연결은 tab-cache-bridge가 맡는다.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { C } from '@/lib/design-tokens';
import { useTabStore } from '@/store/useTabStore';

export const TAB_BAR_HEIGHT = 36;

export default function TabBar() {
  const router = useRouter();
  const tabs = useTabStore((s) => s.tabs);
  const activeId = useTabStore((s) => s.activeId);
  const closeTab = useTabStore((s) => s.closeTab);

  // 서버에는 localStorage가 없어 탭이 0개인데 클라이언트는 복원된 탭을 그린다.
  // 마운트 전에는 탭을 그리지 않아 하이드레이션 불일치를 막는다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 마운트 전(서버 렌더·하이드레이션 직후)에도 자리는 잡아둔다.
  // 여기서 null을 반환하면 탭이 나타나는 순간 본문 전체가 36px 밀려 내려간다.
  // Task 6에서 AppShell이 주소마다 openTab을 부르므로 tabs=[] 상태는
  // 사실상 "마운트 직후 한 프레임"에만 존재하지만, 그 한 프레임에서도
  // 레이아웃 점프가 나면 안 된다.
  if (!mounted || tabs.length === 0) {
    return (
      <div
        style={{
          height: TAB_BAR_HEIGHT,
          flexShrink: 0,
          backgroundColor: C.bg,
          borderBottom: `1px solid ${C.border}`,
        }}
      />
    );
  }

  function handleClose(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const wasActive = activeId === id;
    closeTab(id);
    if (wasActive) {
      const next = useTabStore.getState();
      router.push(next.tabs.find((t) => t.id === next.activeId)?.href ?? '/dashboard');
    }
  }

  return (
    <div
      data-testid="tab-bar"
      style={{
        height: TAB_BAR_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        backgroundColor: C.bg,
        borderBottom: `1px solid ${C.border}`,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            onClick={() => router.push(tab.href)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px 0 12px',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? C.text : C.textSub,
              backgroundColor: active ? C.card : 'transparent',
              borderRight: `1px solid ${C.border}`,
              borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {tab.isDirty && (
              <span aria-label="편집 중" style={{ color: C.accent, fontSize: 14, lineHeight: 1 }}>
                ●
              </span>
            )}
            <span
              title={tab.label}
              style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {tab.label}
            </span>
            <button
              type="button"
              aria-label={`${tab.label} 탭 닫기`}
              onClick={(e) => handleClose(e, tab.id)}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: C.textMuted,
                fontSize: 13,
                lineHeight: 1,
                padding: '2px 3px',
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

// 마지막 갱신 시각 표시는 Task 9에서 캐시가 생긴 뒤 붙인다. 지금은 표시할 값이 없다.
