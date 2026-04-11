'use client';

/**
 * 공용 모바일 바텀시트 컴포넌트
 * 외부 라이브러리 없이 직접 구현
 * - iOS 네이티브 느낌의 cubic-bezier transition
 * - 스와이프 다운으로 닫기 (50px 임계값)
 * - 내부 스크롤과 드래그 제스처 충돌 방지
 */

import React, { useRef, useCallback, useEffect } from 'react';

export interface MobileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** 바텀시트 최대 높이 (vh). 기본 80 */
  maxHeight?: number;
  /** 배경 탭 시 닫기 허용. 기본 true */
  closeOnBackdrop?: boolean;
  /** 드래그 핸들 표시 여부. 기본 true */
  showHandle?: boolean;
  children: React.ReactNode;
  /** 바텀시트 타이틀 (옵션) */
  title?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수
// ─────────────────────────────────────────────────────────────────────────────
const COLOR = {
  bg: '#ffffff',
  handle: '#d1d5db',
  backdrop: 'rgba(0,0,0,0.4)',
  title: '#1a1c1c',
  closeBtn: '#6b7280',
} as const;

export default function MobileBottomSheet({
  isOpen,
  onClose,
  maxHeight = 80,
  closeOnBackdrop = true,
  showHandle = true,
  children,
  title,
}: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // 드래그 상태 (ref로 관리하여 렌더링 트리거 없이 실시간 처리)
  const dragState = useRef({
    isDragging: false,
    startY: 0,
    currentDeltaY: 0,
  });

  // 드래그 중 translateY 직접 DOM 조작 (리렌더 없이 부드럽게)
  const setSheetTranslate = useCallback((y: number) => {
    if (!sheetRef.current) return;
    sheetRef.current.style.transform = `translateY(${y}px)`;
    sheetRef.current.style.transition = 'none';
  }, []);

  const resetSheetTranslate = useCallback((animate: boolean) => {
    if (!sheetRef.current) return;
    sheetRef.current.style.transition = animate
      ? 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
      : 'none';
    sheetRef.current.style.transform = 'translateY(0)';
  }, []);

  // ─── 터치 이벤트 핸들러 ───────────────────────────────────────────────────

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    dragState.current.isDragging = true;
    dragState.current.startY = e.touches[0].clientY;
    dragState.current.currentDeltaY = 0;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!dragState.current.isDragging) return;

      const deltaY = e.touches[0].clientY - dragState.current.startY;

      // 내부 스크롤이 상단(scrollTop=0)일 때만 다운 드래그 허용
      const scrollTop = scrollAreaRef.current?.scrollTop ?? 0;
      if (deltaY > 0 && scrollTop > 0) {
        // 스크롤 영역 안에서 위쪽 콘텐츠가 남아있으면 드래그 무시
        dragState.current.isDragging = false;
        return;
      }

      // 위로 당기는 방향(음수)은 무시
      if (deltaY <= 0) return;

      dragState.current.currentDeltaY = deltaY;

      // rubber band: 드래그 거리의 루트를 취해 저항감 표현
      const rubberDelta = Math.sqrt(deltaY) * 4;
      const appliedDelta = deltaY > 20 ? rubberDelta + 20 : deltaY;
      setSheetTranslate(appliedDelta);

      // 스크롤 이벤트가 페이지로 전파되지 않도록
      e.preventDefault();
    },
    [setSheetTranslate],
  );

  const handleTouchEnd = useCallback(() => {
    if (!dragState.current.isDragging) return;
    dragState.current.isDragging = false;

    if (dragState.current.currentDeltaY >= 50) {
      // 50px 이상 드래그 → 닫기
      onClose();
    } else {
      // 원위치 복구
      resetSheetTranslate(true);
    }

    dragState.current.currentDeltaY = 0;
  }, [onClose, resetSheetTranslate]);

  // isOpen 상태 변경 시 트랜지션 복구
  useEffect(() => {
    if (isOpen) {
      resetSheetTranslate(true);
    }
  }, [isOpen, resetSheetTranslate]);

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeOnBackdrop ? onClose : undefined}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: COLOR.backdrop,
          zIndex: 200,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      />

      {/* 바텀시트 패널 */}
      <div
        ref={sheetRef}
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: isOpen ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)',
          width: '100%',
          maxWidth: '480px',
          maxHeight: `${maxHeight}vh`,
          backgroundColor: COLOR.bg,
          borderRadius: '16px 16px 0 0',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          visibility: isOpen ? 'visible' : 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
          // 바텀시트 자체의 transform은 translateX + translateY 합산
          // isOpen 토글 후 JS에서 덮어쓰지 않도록 초기값 설정
        }}
      >
        {/* 드래그 핸들 영역 — 터치 이벤트 수신 */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            flexShrink: 0,
            paddingTop: '12px',
            paddingBottom: title ? '8px' : '12px',
            cursor: 'grab',
          }}
        >
          {showHandle && (
            <div
              style={{
                width: '32px',
                height: '4px',
                backgroundColor: COLOR.handle,
                borderRadius: '2px',
                margin: '0 auto',
              }}
            />
          )}

          {/* 타이틀 + X 버튼 */}
          {title && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px 0',
              }}
            >
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: COLOR.title,
                  letterSpacing: '-0.3px',
                }}
              >
                {title}
              </span>

              <button
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '4px',
                  cursor: 'pointer',
                  color: COLOR.closeBtn,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
                aria-label="닫기"
              >
                {/* X 아이콘 (SVG 인라인) */}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M15 5L5 15M5 5l10 10"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* 내부 스크롤 영역 */}
        <div
          ref={scrollAreaRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            // iOS 관성 스크롤
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
