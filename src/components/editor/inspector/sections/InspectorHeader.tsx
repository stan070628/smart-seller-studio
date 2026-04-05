'use client';

/**
 * InspectorHeader.tsx
 * 인스펙터 패널 상단 헤더 — 프레임 번호, 한글 이름, 닫기 버튼, skip 뱃지
 */

import { X } from 'lucide-react';
import type { GeneratedFrame, FrameType } from '@/types/frames';
import { FRAME_LABEL_KO } from '@/components/templates';
import useEditorStore from '@/store/useEditorStore';

// 프레임 타입 → 정렬 순서 (1-based)
const FRAME_ORDER: FrameType[] = [
  'hero',
  'pain_point',
  'solution',
  'usp',
  'detail_1',
  'detail_2',
  'how_to_use',
  'before_after',
  'target',
  'spec',
  'faq',
  'social_proof',
  'cta',
  'custom_3col',
  'custom_gallery',
  'custom_notice',
  'custom_return_notice',
  'custom_privacy',
];

interface InspectorHeaderProps {
  frame: GeneratedFrame;
  /** 프레임 목록에서의 실제 인덱스 (1-based) */
  frameIndex: number;
}

const InspectorHeader: React.FC<InspectorHeaderProps> = ({ frame, frameIndex }) => {
  const setSelectedFrameType = useEditorStore((s) => s.setSelectedFrameType);

  const labelKo = FRAME_LABEL_KO[frame.frameType] ?? frame.frameType;
  const indexLabel = String(frameIndex).padStart(2, '0');

  return (
    <div
      style={{
        padding: '16px',
        borderBottom: '1px solid #eeeeee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      }}
    >
      {/* 왼쪽: 번호 + 이름 + skip 뱃지 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {/* 프레임 번호 */}
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#926f6b',
            letterSpacing: '0.05em',
            flexShrink: 0,
          }}
        >
          {indexLabel}
        </span>

        {/* 한글 프레임 이름 */}
        <span
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#1a1c1c',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {labelKo}
        </span>

        {/* skip 뱃지 */}
        {frame.skip && (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 500,
              color: '#926f6b',
              backgroundColor: '#f3f3f3',
              borderRadius: '4px',
              padding: '2px 6px',
              flexShrink: 0,
            }}
          >
            건너뜀
          </span>
        )}
      </div>

      {/* 오른쪽: 닫기 버튼 */}
      <button
        onClick={() => setSelectedFrameType(null)}
        title="패널 닫기"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: 'transparent',
          color: '#926f6b',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background-color 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f3f3f3';
          (e.currentTarget as HTMLButtonElement).style.color = '#1a1c1c';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.color = '#926f6b';
        }}
      >
        <X size={15} />
      </button>
    </div>
  );
};

export default InspectorHeader;
