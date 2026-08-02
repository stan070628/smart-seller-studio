'use client';

/**
 * TabBar.tsx
 * 메인 영역 최상단 가로 탭 바
 *
 * 탭 상태만 알고 캐시는 모른다. 둘의 연결은 tab-cache-bridge가 맡는다.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { C } from '@/lib/design-tokens';
import { useTabStore } from '@/store/useTabStore';
import { useCacheStore } from '@/store/useCacheStore';

export const TAB_BAR_HEIGHT = 36;

/** useHasHydrated가 구독할 것이 없다는 뜻으로 넘기는 빈 구독 함수 */
function noopSubscribe() {
  return () => {};
}

/**
 * 하이드레이션을 통과했는지 판정한다.
 * 서버 스냅샷은 항상 false, 클라이언트 스냅샷은 항상 true다.
 * React가 하이드레이션 커밋 직후 클라이언트 스냅샷으로 자동 재렌더하므로,
 * 최초 마운트(서버 HTML을 이어받는 하이드레이션)에서만 false→true로 한 번
 * 바뀐다. AppShell이 라우트마다 재마운트돼도 그건 하이드레이션이 아니라
 * 순수 클라이언트 렌더라 처음부터 true — setState를 쓰는 effect나
 * 모듈 스코프 변수 없이도 "재마운트마다 한 프레임 깜빡임" 문제가 없다.
 */
function useHasHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export default function TabBar() {
  const router = useRouter();
  const tabs = useTabStore((s) => s.tabs);
  const activeId = useTabStore((s) => s.activeId);
  const closeTab = useTabStore((s) => s.closeTab);

  // 서버에는 localStorage가 없어 탭이 0개인데 클라이언트는 복원된 탭을 그린다.
  // 마운트 전에는 탭을 그리지 않아 하이드레이션 불일치를 막는다.
  const mounted = useHasHydrated();

  const entries = useCacheStore((s) => s.entries);
  const [now, setNow] = useState(() => Date.now());

  // 상대 시각 표시를 30초마다 갱신한다.
  // 렌더 중에 Date.now()를 직접 부르면 react-hooks/purity에 걸리고
  // (React Compiler가 켜지면 시각이 얼어붙는다), 시각 자체를 상태로 둔다.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      />
    );
  }

  /**
   * 해당 라우트에서 가장 오래된 캐시 키의 갱신 시각.
   * 낡음 경고는 "지금 보는 값 중 가장 오래된 것"을 알려야 한다.
   * 키가 여럿일 때 가장 최근 것을 보여주면(Math.max) 화면이 실제로는
   * 갖고 있지 않은 신선도를 탭이 주장하게 된다.
   */
  function lastFetchedAt(routeId: string): number | null {
    const times = Object.entries(entries)
      .filter(([k]) => k.startsWith(`${routeId}:`))
      .map(([, e]) => e.fetchedAt);
    return times.length ? Math.min(...times) : null;
  }

  function relative(ts: number): string {
    // 로컬 시계가 뒤로 가도 음수가 나오지 않게 막는다.
    // 음수면 "방금"이 나와 낡은 데이터를 최신으로 오판하게 되므로,
    // 그 방향의 오차보다는 0(방금)에 그대로 머무는 쪽이 안전하다.
    const min = Math.max(0, Math.floor((now - ts) / 60_000));
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    return `${Math.floor(min / 60)}시간 전`;
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
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const stamp = lastFetchedAt(tab.id);
        return (
          <div
            key={tab.id}
            onClick={() => router.push(tab.href)}
            style={{
              display: 'flex',
              alignItems: 'center',
              // 라벨과 닫기 버튼이 붙어 있으면 탭을 누르려다 ✕를 누른다.
              // 간격과 좌우 여백을 함께 벌려 오조작을 줄인다.
              gap: 10,
              padding: '0 12px 0 14px',
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
            {stamp && (
              <span style={{ fontSize: 10, color: C.textMuted }}>· {relative(stamp)}</span>
            )}
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
                // 눌러야 할 곳을 키운다. 작으면 겨냥이 어렵고 빗나가면 탭이 눌린다
                padding: '5px 7px',
                borderRadius: 4,
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
