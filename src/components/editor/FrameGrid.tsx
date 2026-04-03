'use client';

/**
 * FrameGrid.tsx
 * 활성화된 프레임들을 세로 단일 컬럼으로 표시하는 컴포넌트
 *
 * - useEditorStore에서 frames, uploadedImages 구독
 * - skip !== true인 프레임만 표시
 * - 세로 단일 컬럼으로 FrameCard 렌더링 (한 화면에 한 템플릿)
 * - 빈 상태 UI 포함
 */

import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { Layers } from 'lucide-react';
import useEditorStore from '@/store/useEditorStore';
import FrameCard from './FrameCard';
import type { GeneratedFrame } from '@/types/frames';

// ---------------------------------------------------------------------------
// DownloadAllButton에서 ref로 각 FrameCard의 template DOM에 접근할 수 있도록
// ---------------------------------------------------------------------------

export interface FrameGridHandle {
  /** 활성화된 프레임 목록 (skip !== true) */
  activeFrames: GeneratedFrame[];
  /** 각 프레임 인덱스 → 해당 templateRef DOM 노드 */
  getTemplateNode: (index: number) => HTMLDivElement | null;
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

const FrameGrid = forwardRef<FrameGridHandle>((_, ref) => {
  const frames = useEditorStore((s) => s.frames);
  const uploadedImages = useEditorStore((s) => s.uploadedImages);

  // 기본 이미지 URL - 첫 번째 업로드 이미지 (프레임별 지정이 없을 때 사용)
  const defaultImageUrl =
    uploadedImages.length > 0
      ? (uploadedImages[0].storageUrl ?? uploadedImages[0].url)
      : null;

  // 활성화 프레임 필터
  const activeFrames = frames.filter((f) => f.skip !== true);

  // 각 FrameCard 내부의 template DOM에 접근하기 위한 ref 배열
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // DownloadAllButton이 외부에서 접근할 핸들 노출
  useImperativeHandle(ref, () => ({
    activeFrames,
    getTemplateNode: (index: number) => cardRefs.current[index] ?? null,
  }));

  // -----------------------------------------------------------------------
  // 빈 상태 UI
  // -----------------------------------------------------------------------
  if (activeFrames.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: '20px',
          padding: '60px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '80px',
            height: '80px',
            backgroundColor: '#18181b',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #27272a',
          }}
        >
          <Layers size={36} color="#3f3f46" />
        </div>
        <div>
          <p
            style={{
              color: '#71717a',
              fontSize: '16px',
              fontWeight: '500',
              margin: '0 0 8px 0',
            }}
          >
            아직 생성된 프레임이 없습니다
          </p>
          <p style={{ color: '#52525b', fontSize: '14px', margin: 0, lineHeight: '1.6' }}>
            좌측 사이드바에서 리뷰를 입력하고
            <br />
            AI 카피 생성 버튼을 눌러보세요
          </p>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // 세로 단일 컬럼 렌더
  // -----------------------------------------------------------------------
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '48px',
        padding: '32px',
        alignItems: 'stretch',
      }}
    >
      {activeFrames.map((frame, idx) => (
        <FrameCard
          key={frame.frameType}
          ref={(node) => {
            cardRefs.current[idx] = node;
          }}
          frame={frame}
          defaultImageUrl={defaultImageUrl}
          uploadedImages={uploadedImages}
          frameIndex={idx + 1}
        />
      ))}
    </div>
  );
});

FrameGrid.displayName = 'FrameGrid';

export default FrameGrid;
