'use client';

/**
 * FrameCardPreview.tsx
 * 읽기 전용 프레임 미리보기 카드
 *
 * - 편집 UI(버튼, 팝오버, 슬라이더 등) 없음
 * - 카드 클릭 시 store의 setSelectedFrameType 호출
 * - selectedFrameType 일치 시 파란 테두리
 * - generatingImageForFrame 일치 시 로딩 오버레이
 * - hasCustomImage 시 뱃지 표시
 * - TemplateRefContext의 registerRef로 templateRef 등록
 */

import React, { useRef, useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { FrameType, GeneratedFrame } from '@/types/frames';
import type { UploadedImage } from '@/types/editor';
import { TEMPLATE_MAP, FRAME_LABEL_KO } from '@/components/templates';
import useEditorStore from '@/store/useEditorStore';
import { useTemplateRefs } from './inspector/TemplateRefContext';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const TEMPLATE_W = 780;
const TEMPLATE_H = 1100;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FrameCardPreviewProps {
  frame: GeneratedFrame;
  frameIndex: number;
  defaultImageUrl?: string | null;
  uploadedImages: UploadedImage[];
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

export default function FrameCardPreview({
  frame,
  frameIndex,
  defaultImageUrl,
  uploadedImages: _uploadedImages, // 현재 프리뷰에서는 미사용, API 일관성 유지
}: FrameCardPreviewProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [containerWidth, setContainerWidth] = useState(560);

  const containerRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // store 구독
  const frameImages = useEditorStore((s) => s.frameImages);
  const theme = useEditorStore((s) => s.theme);
  const frameImageFit = useEditorStore((s) => s.frameImageFit);
  const frameImageSettings = useEditorStore((s) => s.frameImageSettings);
  const generatingImageForFrame = useEditorStore((s) => s.generatingImageForFrame);
  const selectedFrameId = useEditorStore((s) => s.selectedFrameId);
  const setSelectedFrame = useEditorStore((s) => s.setSelectedFrame);
  const updateFrame = useEditorStore((s) => s.updateFrame);
  const addImage = useEditorStore((s) => s.addImage);
  const setFrameImage = useEditorStore((s) => s.setFrameImage);

  // TemplateRefContext 연동
  const { registerRef } = useTemplateRefs();

  // 프레임 인스턴스 ID (id가 없는 레거시 프레임은 frameType으로 fallback)
  const frameId = frame.id ?? frame.frameType;

  // 슬롯 전체 맵 구성
  const frameSlots = frameImages[frameId] ?? {};
  const assignedImageUrl = frameSlots['main'] ?? defaultImageUrl ?? null;
  const hasCustomImage = !!frameSlots['main'];

  // imageUrls: 슬롯 맵 그대로 복사 후 main 슬롯 기본값 보정
  const imageUrls: Record<string, string> = { ...frameSlots };
  if (!imageUrls['main'] && defaultImageUrl) {
    imageUrls['main'] = defaultImageUrl;
  }

  // 슬롯별 이미지 설정 (fit, scale, offset)
  const slotSettings = frameImageSettings[frameId] ?? {};

  const TemplateComponent = TEMPLATE_MAP[frame.frameType];
  const labelKo = FRAME_LABEL_KO[frame.frameType] ?? frame.frameType;
  const indexLabel = String(frameIndex).padStart(2, '0');

  // 선택 상태 (frameId 기준)
  const isSelected = selectedFrameId === frameId;

  // AI 이미지 생성 진행 중 여부
  const isGeneratingThisFrame = generatingImageForFrame === frameId;

  // 프레임 타입별 실제 템플릿 높이 (thumbnail은 정사각형 780px)
  const templateH = frame.frameType === 'thumbnail' ? TEMPLATE_W : TEMPLATE_H;

  // 동적 scale 계산 (최대 0.55)
  const scale = Math.min(0.55, containerWidth / TEMPLATE_W);
  const previewWidth = Math.round(containerWidth);
  const previewHeight = Math.round(templateH * scale);

  // -----------------------------------------------------------------------
  // ResizeObserver: 컨테이너 너비 측정
  // -----------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    });

    observer.observe(el);
    setContainerWidth(el.getBoundingClientRect().width || 560);

    return () => {
      observer.disconnect();
    };
  }, []);

  // -----------------------------------------------------------------------
  // ImagePlaceholder 클릭: 파일 선택 다이얼로그 열기
  // -----------------------------------------------------------------------
  const handleImageAdd = () => {
    if (!isSelected) {
      setSelectedFrame(frame.frameType as FrameType, frameId);
    }
    imageInputRef.current?.click();
  };

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    addImage({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      url,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      uploadStatus: 'done' as const,
    });
    setFrameImage(frameId, 'main', url);
    e.target.value = '';
  };

  // -----------------------------------------------------------------------
  // 카드 클릭: 선택 상태 토글
  // -----------------------------------------------------------------------
  const handleCardClick = () => {
    setSelectedFrame(
      isSelected ? null : (frame.frameType as FrameType),
      isSelected ? null : frameId,
    );
  };

  // -----------------------------------------------------------------------
  // 텍스트 편집 핸들러 (EditableText → store)
  // -----------------------------------------------------------------------
  const handleFieldChange = (field: string, value: unknown) => {
    const strValue = String(value ?? '');
    // metadata 중첩 필드 지원: "metadata.painPoints.0" → updateFrame
    if (field.startsWith('metadata.')) {
      const parts = field.split('.');
      // parts: ['metadata', 'painPoints', '0'] 또는 ['metadata', 'solutions', '0', 'problem']
      const metaKey = parts[1];
      const currentMeta = { ...(frame.metadata ?? {}) };

      if (parts.length === 3) {
        // metadata.array.index (예: metadata.painPoints.0)
        const idx = parseInt(parts[2], 10);
        const arr = Array.isArray(currentMeta[metaKey]) ? [...(currentMeta[metaKey] as unknown[])] : [];
        arr[idx] = strValue;
        currentMeta[metaKey] = arr;
      } else if (parts.length === 4) {
        // metadata.array.index.field (예: metadata.solutions.0.problem)
        const idx = parseInt(parts[2], 10);
        const subField = parts[3];
        const arr = Array.isArray(currentMeta[metaKey]) ? [...(currentMeta[metaKey] as Record<string, unknown>[])] : [];
        arr[idx] = { ...(arr[idx] ?? {}), [subField]: strValue };
        currentMeta[metaKey] = arr;
      } else {
        // metadata.simpleKey
        currentMeta[metaKey] = strValue;
      }
      updateFrame(frame.frameType as FrameType, { metadata: currentMeta });
    } else {
      // 최상위 필드 (headline, subheadline, bodyText 등)
      updateFrame(frame.frameType as FrameType, { [field]: strValue });
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        position: 'relative',
        maxWidth: '960px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* 카드 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 2px' }}>
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#6366f1',
            fontWeight: '700',
          }}
        >
          {indexLabel}
        </span>
        <span style={{ fontSize: '13px', color: '#1a1c1c', fontWeight: '500' }}>
          {labelKo}
        </span>

        {/* 커스텀 이미지 뱃지 */}
        {hasCustomImage && (
          <span
            style={{
              fontSize: '10px',
              color: '#059669',
              backgroundColor: '#d1fae5',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: '600',
            }}
          >
            커스텀
          </span>
        )}

        {/* AI 생성 중 뱃지 */}
        {isGeneratingThisFrame && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: '#6366f1',
              backgroundColor: 'rgba(99,102,241,0.10)',
              padding: '1px 6px',
              borderRadius: '4px',
              fontWeight: '600',
            }}
          >
            <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
            생성 중
          </span>
        )}
      </div>

      {/* 미리보기 래퍼 — 컨테이너 너비 측정용 */}
      <div ref={containerRef} style={{ width: '100%' }}>
        <div
          onClick={(e) => {
            // 선택된 상태에서 내부 편집 요소(contenteditable 등) 클릭 시 선택 해제 방지
            if (isSelected) {
              const target = e.target as HTMLElement;
              if (target.isContentEditable || target.closest('[contenteditable]')) return;
            }
            handleCardClick();
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            position: 'relative',
            width: `${previewWidth}px`,
            height: `${previewHeight}px`,
            borderRadius: '10px',
            overflow: 'hidden',
            cursor: isSelected ? 'default' : 'pointer',
            border: isSelected
              ? '2px solid #6366f1'
              : hasCustomImage
                ? '1px solid #059669'
                : '1px solid #eeeeee',
            boxShadow: isSelected
              ? '0 0 0 2px rgba(99,102,241,0.15)'
              : '0 2px 8px rgba(0,0,0,0.06)',
            transition: 'border 0.2s, box-shadow 0.2s, background-color 0.2s',
            backgroundColor: isHovered && !isSelected ? 'rgba(0,0,0,0.01)' : 'transparent',
          }}
        >
          {/* 실제 780×1100 템플릿 (scale로 축소 표시) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transformOrigin: 'top left',
              transform: `scale(${scale})`,
              width: `${TEMPLATE_W}px`,
              height: `${templateH}px`,
              // 선택된 프레임은 텍스트 편집 허용, 미선택은 클릭 이벤트 차단
              pointerEvents: isSelected ? 'auto' : 'none',
              userSelect: isSelected ? 'text' : 'none',
            }}
          >
            <div
              ref={(el) => {
                // templateRef 로컬 관리 + TemplateRefContext 등록
                templateRef.current = el;
                registerRef(frame.frameType as FrameType, el);
              }}
              style={{ width: `${TEMPLATE_W}px`, height: `${templateH}px` }}
            >
              <TemplateComponent
                frame={frame}
                imageUrl={assignedImageUrl}
                imageUrls={imageUrls}
                isEditable={isSelected}
                onFieldChange={isSelected ? handleFieldChange : undefined}
                onImageAdd={isSelected ? handleImageAdd : undefined}
                theme={theme}
                imageFit={frameImageFit[frameId]?.['main'] ?? 'cover'}
                imageScale={slotSettings['main']?.scale ?? 1}
                imageOffsetX={slotSettings['main']?.x ?? 50}
                imageOffsetY={slotSettings['main']?.y ?? 50}
                imageSlotSettings={slotSettings}
              />
            </div>
          </div>

          {/* AI 이미지 생성 중 로딩 오버레이 */}
          {isGeneratingThisFrame && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.55)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                zIndex: 10,
              }}
            >
              <Loader2
                size={32}
                color="#818cf8"
                style={{ animation: 'spin 1s linear infinite' }}
              />
              <span
                style={{
                  fontSize: '13px',
                  color: '#c7d2fe',
                  fontWeight: '600',
                }}
              >
                AI 이미지 생성 중...
              </span>
            </div>
          )}

          {/* 호버 시 선택 유도 힌트 오버레이 (선택 전, 생성 중 아닐 때) */}
          {isHovered && !isSelected && !isGeneratingThisFrame && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(99,102,241,0.06)',
                zIndex: 5,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>
      {/* 숨겨진 file input — ImagePlaceholder 클릭 시 트리거 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageFileSelect}
      />
    </div>
  );
}
