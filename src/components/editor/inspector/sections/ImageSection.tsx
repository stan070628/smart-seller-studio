'use client';

/**
 * ImageSection.tsx
 * 인스펙터 패널 이미지 섹션
 *
 * 다중 슬롯 지원:
 *  - 슬롯이 0개면 섹션 숨김 (텍스트 전용)
 *  - 슬롯이 1개면 기존처럼 단일 이미지 UI
 *  - 슬롯이 2개 이상이면 각 슬롯을 독립된 카드로 나열 + 활성 슬롯 선택
 */

import React, { useRef } from 'react';
import { Upload, X, Check, ImageIcon } from 'lucide-react';
import type { GeneratedFrame, FrameType } from '@/types/frames';
import type { UploadedImage } from '@/types/editor';
import useEditorStore from '@/store/useEditorStore';
import { getFrameSlots } from '@/lib/constants/image-slots';

/** 이미지 설정 자동 적용 대상 프레임 */
const AUTO_FIT_FRAME_TYPES: FrameType[] = ['custom_3col', 'custom_gallery'];

interface ImageSectionProps {
  frame: GeneratedFrame;
  /** 프레임 인스턴스 고유 ID */
  frameId: string;
  activeSlotKey: string;
  onSlotChange: (slotKey: string) => void;
}

const ImageSection: React.FC<ImageSectionProps> = ({ frame, frameId, activeSlotKey, onSlotChange }) => {
  const uploadedImages = useEditorStore((s) => s.uploadedImages);
  const frameImages = useEditorStore((s) => s.frameImages);
  const addImage = useEditorStore((s) => s.addImage);
  const setFrameImage = useEditorStore((s) => s.setFrameImage);

  const setFrameImageFit = useEditorStore((s) => s.setFrameImageFit);
  const setFrameImageSettings = useEditorStore((s) => s.setFrameImageSettings);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const slots = getFrameSlots(frame.frameType as FrameType);
  if (slots.length === 0) return null;

  const frameType = frame.frameType as FrameType;
  const currentSlotImages = frameImages[frameId] ?? {};
  const customImageUrl = currentSlotImages[activeSlotKey] ?? null;

  /** custom_3col / custom_gallery 슬롯 이미지 설정 시 fit/settings 자동 적용 */
  const applyAutoFitIfNeeded = (ft: FrameType, slotKey: string) => {
    if (AUTO_FIT_FRAME_TYPES.includes(ft)) {
      setFrameImageFit(frameId, slotKey, 'cover');
      setFrameImageSettings(frameId, slotKey, { scale: 1, x: 50, y: 50 });
    }
  };

  const handleSelectImage = (img: UploadedImage) => {
    const url = img.storageUrl ?? img.url;
    setFrameImage(frameId, activeSlotKey, url);
    applyAutoFitIfNeeded(frameType, activeSlotKey);
  };

  const handleReleaseImage = () => {
    setFrameImage(frameId, activeSlotKey, null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const newImg: UploadedImage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      url,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      uploadStatus: 'done',
    };
    addImage(newImg);
    setFrameImage(frameId, activeSlotKey, url);
    applyAutoFitIfNeeded(frameType, activeSlotKey);
    e.target.value = '';
  };

  const isMultiSlot = slots.length >= 2;

  return (
    <section style={{ borderBottom: '1px solid #eeeeee' }}>
      {/* 섹션 헤더 */}
      <div
        style={{
          padding: '12px 16px 8px',
          fontSize: '11px',
          fontWeight: 700,
          color: '#926f6b',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        이미지{isMultiSlot ? ` (${slots.length}장)` : ''}
      </div>

      {/* 다중 슬롯: 슬롯별 미니 카드 가로 나열 */}
      {isMultiSlot && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '0 16px 12px',
          }}
        >
          {slots.map((slot) => {
            const isActive = slot.key === activeSlotKey;
            const slotUrl = currentSlotImages[slot.key] ?? null;
            return (
              <div
                key={slot.key}
                style={{ flex: 1, position: 'relative' }}
              >
                <button
                  onClick={() => onSlotChange(slot.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 4px',
                    borderRadius: '10px',
                    border: isActive ? '2px solid #6366f1' : '2px solid #eeeeee',
                    backgroundColor: isActive ? 'rgba(99,102,241,0.08)' : '#f3f3f3',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {/* 슬롯 썸네일 */}
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16/10',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      backgroundColor: '#eeeeee',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    {slotUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={slotUrl}
                        alt={slot.label}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <ImageIcon size={18} color="#926f6b" />
                    )}
                  </div>

                  {/* 슬롯 라벨 */}
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? '#6366f1' : '#926f6b',
                      lineHeight: 1,
                    }}
                  >
                    {slot.label}
                  </span>
                </button>

                {/* 이미지 삭제 버튼 — 이미지가 있을 때만 표시 */}
                {slotUrl && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFrameImage(frameId, slot.key, null);
                    }}
                    title={`${slot.label} 삭제`}
                    style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      border: 'none',
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                      zIndex: 1,
                    }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 활성 슬롯 편집 영역 */}
      <div style={{ padding: '0 16px 16px' }}>
        {/* 다중 슬롯일 때 현재 편집 중인 슬롯 표시 */}
        {isMultiSlot && (
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#6366f1',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '8px' }}>▶</span>
            {slots.find(s => s.key === activeSlotKey)?.label ?? activeSlotKey} 편집 중
          </div>
        )}

        {/* 현재 적용된 이미지 프리뷰 */}
        {customImageUrl && (
          <div
            style={{
              position: 'relative',
              marginBottom: '12px',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #eeeeee',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={customImageUrl}
              alt="현재 적용된 이미지"
              style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }}
            />
            <button
              onClick={handleReleaseImage}
              title="이미지 해제"
              style={{
                position: 'absolute',
                top: '6px',
                right: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'rgba(0,0,0,0.5)',
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* 업로드된 이미지 그리드 */}
        {uploadedImages.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
              marginBottom: '10px',
            }}
          >
            {uploadedImages.map((img) => {
              const url = img.storageUrl ?? img.url;
              const isSelected = customImageUrl === url;
              return (
                <button
                  key={img.id}
                  onClick={() => handleSelectImage(img)}
                  title={img.name}
                  style={{
                    padding: 0,
                    border: isSelected ? '2px solid #6366f1' : '2px solid transparent',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    backgroundColor: 'transparent',
                    aspectRatio: '1',
                    outline: 'none',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={img.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: '12px', color: '#926f6b', lineHeight: 1.5, margin: '0 0 10px' }}>
            사이드바에서 이미지를 업로드하거나, 아래 버튼으로 직접 추가하세요.
          </p>
        )}

        {/* PC에서 업로드 버튼 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            width: '100%',
            padding: '8px 12px',
            backgroundColor: '#f3f3f3',
            border: '1px solid #eeeeee',
            borderRadius: '8px',
            color: '#926f6b',
            fontSize: '13px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#eeeeee';
            (e.currentTarget as HTMLButtonElement).style.color = '#1a1c1c';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f3f3f3';
            (e.currentTarget as HTMLButtonElement).style.color = '#926f6b';
          }}
        >
          <Upload size={14} />
          PC에서 업로드
        </button>
      </div>
    </section>
  );
};

export default ImageSection;
