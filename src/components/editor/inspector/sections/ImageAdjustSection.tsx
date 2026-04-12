'use client';

/**
 * ImageAdjustSection.tsx
 * 인스펙터 패널 — 이미지 조정 섹션
 *
 * - activeSlotKey를 받아 슬롯별로 독립적인 fit/scale/x/y 관리
 * - fit 토글: cover / contain (두 버튼, 선택된 것 강조)
 * - scale 슬라이더: 0.5 ~ 3.0 (step 0.1)
 * - X 위치 슬라이더: 0 ~ 100 (%)
 * - Y 위치 슬라이더: 0 ~ 100 (%)
 * - "초기화" 버튼 (cover, scale 1, x 50, y 50) — 현재 슬롯만 리셋
 * - 각 슬라이더 현재 값 라벨 표시
 */

import type { FrameType } from '@/types/frames';
import useEditorStore from '@/store/useEditorStore';

interface ImageAdjustSectionProps {
  frameType: FrameType;
  /** 프레임 인스턴스 고유 ID */
  frameId: string;
  activeSlotKey: string;
}

const ImageAdjustSection: React.FC<ImageAdjustSectionProps> = ({ frameType: _frameType, frameId, activeSlotKey }) => {
  const frameImageFit = useEditorStore((s) => s.frameImageFit);
  const setFrameImageFit = useEditorStore((s) => s.setFrameImageFit);
  const frameImageSettings = useEditorStore((s) => s.frameImageSettings);
  const setFrameImageSettings = useEditorStore((s) => s.setFrameImageSettings);

  // 현재 슬롯의 값 (기본값 적용)
  const currentFit = frameImageFit[frameId]?.[activeSlotKey] ?? 'cover';
  const currentSettings = frameImageSettings[frameId]?.[activeSlotKey] ?? { scale: 1, x: 50, y: 50 };
  const scale = currentSettings.scale ?? 1;
  const x = currentSettings.x ?? 50;
  const y = currentSettings.y ?? 50;

  // 현재 슬롯만 리셋
  const handleReset = () => {
    setFrameImageFit(frameId, activeSlotKey, 'cover');
    setFrameImageSettings(frameId, activeSlotKey, { scale: 1, x: 50, y: 50 });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* 섹션 라벨 */}
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          color: '#926f6b',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        이미지 조정
      </span>

      {/* fit 토글 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <span style={{ fontSize: '11px', color: '#926f6b', fontWeight: 500 }}>
          채우기 방식
        </span>
        <div
          style={{
            display: 'flex',
            gap: '6px',
          }}
        >
          {(['cover', 'contain'] as const).map((fitOption) => {
            const isActive = currentFit === fitOption;
            return (
              <button
                key={fitOption}
                onClick={() => setFrameImageFit(frameId, activeSlotKey, fitOption)}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: '6px',
                  border: isActive ? '1px solid #926f6b' : '1px solid #eeeeee',
                  backgroundColor: isActive ? 'rgba(146, 111, 107, 0.12)' : 'transparent',
                  color: isActive ? '#926f6b' : '#1a1c1c',
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {fitOption === 'cover' ? 'Cover' : 'Contain'}
              </button>
            );
          })}
        </div>
      </div>

      {/* 슬라이더 목록 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* 크기 슬라이더 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#926f6b', fontWeight: 500 }}>크기</span>
            <span style={{ fontSize: '11px', color: '#926f6b', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(scale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={3.0}
            step={0.1}
            value={scale}
            onChange={(e) =>
              setFrameImageSettings(frameId, activeSlotKey, { scale: parseFloat(e.target.value) })
            }
            style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}
          />
        </div>

        {/* X 위치 슬라이더 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#926f6b', fontWeight: 500 }}>X 위치</span>
            <span style={{ fontSize: '11px', color: '#926f6b', fontVariantNumeric: 'tabular-nums' }}>
              {x}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={x}
            onChange={(e) =>
              setFrameImageSettings(frameId, activeSlotKey, { x: parseFloat(e.target.value) })
            }
            style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}
          />
        </div>

        {/* Y 위치 슬라이더 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#926f6b', fontWeight: 500 }}>Y 위치</span>
            <span style={{ fontSize: '11px', color: '#926f6b', fontVariantNumeric: 'tabular-nums' }}>
              {y}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={y}
            onChange={(e) =>
              setFrameImageSettings(frameId, activeSlotKey, { y: parseFloat(e.target.value) })
            }
            style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}
          />
        </div>
      </div>

      {/* 초기화 버튼 — 현재 슬롯만 리셋 */}
      <button
        onClick={handleReset}
        style={{
          width: '100%',
          padding: '7px',
          borderRadius: '6px',
          border: '1px solid #eeeeee',
          backgroundColor: 'transparent',
          color: '#926f6b',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#926f6b';
          (e.currentTarget as HTMLButtonElement).style.color = '#1a1c1c';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#eeeeee';
          (e.currentTarget as HTMLButtonElement).style.color = '#926f6b';
        }}
      >
        초기화
      </button>
    </div>
  );
};

export default ImageAdjustSection;
