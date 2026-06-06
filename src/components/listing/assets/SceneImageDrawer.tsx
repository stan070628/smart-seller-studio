'use client';

import React, { useRef } from 'react';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';

// 역할별 한국어 레이블
const ROLE_LABELS: Record<AiImageSlot['role'], string> = {
  hero: '메인 히어로',
  lifestyle: '라이프스타일',
  detail: '소재·디테일',
  feature: '기능 강조',
};

interface SceneImageDrawerProps {
  slots: AiImageSlot[];
  activeIndex: number;
  uploadedImages: string[];
  onReplace: (index: number, newUrl: string, isReplaced: boolean) => void;
  onClose: () => void;
  onSelectScene: (index: number) => void;
}

export default function SceneImageDrawer({
  slots,
  activeIndex,
  uploadedImages,
  onReplace,
  onClose,
  onSelectScene,
}: SceneImageDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  // activeIndex가 범위 밖이면 렌더링 생략
  const activeSlot = slots[activeIndex];
  if (!activeSlot) return null;

  // 파일 선택 핸들러 — base64 변환 후 서버 API 호출
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/image/upload-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: reader.result,
            mimeType: file.type,
            role: activeSlot.role,
          }),
        });
        const data = await res.json() as { success: boolean; url?: string };
        if (data.success && data.url) {
          onReplace(activeIndex, data.url, true);
          onClose();
        }
      } catch {
        // 업로드 오류는 조용히 무시
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 이미 업로드된 이미지 선택 시 즉시 교체
  const handleUploadedImageSelect = (url: string) => {
    onReplace(activeIndex, url, true);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: '380px',
        backgroundColor: '#fff',
        borderLeft: '1px solid #e5e7eb',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* 헤더: 뒤로가기 + 현재 씬 레이블 */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#6b7280',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ←
        </button>
        <span style={{ fontWeight: 700, fontSize: '14px', color: '#111827' }}>
          {ROLE_LABELS[activeSlot.role]} 교체
        </span>
      </div>

      {/* 현재 씬 이미지 미리보기 */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f3f4f6',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', marginBottom: '8px' }}>
          현재 이미지
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeSlot.url}
          alt={ROLE_LABELS[activeSlot.role]}
          style={{
            width: '100%',
            height: '200px',
            objectFit: 'cover',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
          }}
        />
        {activeSlot.isReplaced && (
          <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '4px' }}>✓ 교체됨</div>
        )}
      </div>

      {/* 씬 전환 탭 — 슬롯이 2개 이상일 때만 표시 */}
      {slots.length > 1 && (
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid #f3f4f6',
            display: 'flex',
            gap: '6px',
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          {slots.map((slot, idx) => (
            <button
              key={slot.role}
              onClick={() => onSelectScene(idx)}
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                borderRadius: '6px',
                border: idx === activeIndex ? '1px solid #7c3aed' : '1px solid #e5e7eb',
                background: idx === activeIndex ? '#f5f3ff' : '#fff',
                color: idx === activeIndex ? '#7c3aed' : '#6b7280',
                cursor: 'pointer',
                fontWeight: idx === activeIndex ? 700 : 400,
              }}
            >
              {ROLE_LABELS[slot.role]}
            </button>
          ))}
        </div>
      )}

      {/* 업로드된 이미지 그리드 선택 */}
      {uploadedImages.length > 0 && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #f3f4f6',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
            내 업로드 이미지
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
            }}
          >
            {uploadedImages.map((url, idx) => (
              <button
                key={idx}
                onClick={() => handleUploadedImageSelect(url)}
                style={{
                  padding: 0,
                  border: '2px solid transparent',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  background: 'none',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`업로드 이미지 ${idx + 1}`}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 새 파일 첨부 버튼 */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
          새 파일 첨부
        </div>
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => { void handleFileSelect(e); }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            width: '100%',
            padding: '10px',
            border: '1.5px dashed #d1d5db',
            borderRadius: '8px',
            background: '#f9fafb',
            color: '#6b7280',
            fontSize: '13px',
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? '업로드 중...' : '+ 내 기기에서 이미지 선택'}
        </button>
      </div>
    </div>
  );
}
