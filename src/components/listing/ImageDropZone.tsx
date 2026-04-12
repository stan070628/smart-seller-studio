'use client';

/**
 * ImageDropZone.tsx
 * 드래그앤드롭 + 클릭 파일 선택 업로드 존
 *
 * - accept: image/jpeg, image/png, image/webp
 * - multiple 허용
 * - 최대 개수 초과 시 비활성화 + 안내 문구
 * - 드래그 진입 시 테두리 색상 전환
 * - 업로드 중 스피너 오버레이
 */

import React, { useRef, useState, useCallback } from 'react';
import { Upload, Loader2 } from 'lucide-react';

// ─── 색상 상수 (BothRegisterForm 동일) ────────────────────────────────────────
const C = {
  border: '#e5e5e5',
  textSub: '#71717a',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
};

export interface ImageDropZoneProps {
  onFilesSelected: (files: File[]) => void;
  maxCount: number;
  currentCount: number;
  disabled?: boolean;
  isUploading?: boolean;
}

export default function ImageDropZone({
  onFilesSelected,
  maxCount,
  currentCount,
  disabled = false,
  isUploading = false,
}: ImageDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 최대 개수 도달 여부
  const isFull = currentCount >= maxCount;
  const isDisabled = disabled || isFull || isUploading;

  // 선택된 파일을 maxCount 초과분 없이 콜백 전달
  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || isDisabled) return;
      const remaining = maxCount - currentCount;
      const files = Array.from(fileList).slice(0, remaining);
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [isDisabled, maxCount, currentCount, onFilesSelected],
  );

  // ─── 드래그 이벤트 핸들러 ──────────────────────────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDisabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // relatedTarget이 존재하면 자식 요소로 이동한 것이므로 무시
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isDisabled) return;
    handleFiles(e.dataTransfer.files);
  };

  // ─── 클릭으로 파일 선택 ───────────────────────────────────────────────────
  const handleClick = () => {
    if (isDisabled) return;
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    // 동일 파일 재선택 허용을 위해 value 초기화
    e.target.value = '';
  };

  // ─── 동적 스타일 계산 ─────────────────────────────────────────────────────
  const borderColor = isFull
    ? C.border
    : isDragging
      ? C.accent
      : isUploading
        ? '#a1a1aa'
        : C.border;

  const bgColor = isFull
    ? '#fafafa'
    : isDragging
      ? 'rgba(190,0,20,0.04)'
      : C.tableHeader;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      style={{
        position: 'relative',
        border: `2px dashed ${borderColor}`,
        borderRadius: '10px',
        backgroundColor: bgColor,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      {/* 업로드 중 오버레이 */}
      {isUploading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '9px',
            backgroundColor: 'rgba(255,255,255,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <Loader2
            size={24}
            style={{ color: C.accent, animation: 'imageDropZoneSpin 1s linear infinite' }}
          />
        </div>
      )}

      {/* 아이콘 */}
      <Upload
        size={28}
        style={{ color: isFull ? '#a1a1aa' : isDragging ? C.accent : '#a1a1aa' }}
      />

      {/* 안내 문구 */}
      {isFull ? (
        <span style={{ fontSize: '12px', color: '#a1a1aa', textAlign: 'center' }}>
          최대 {maxCount}개까지 등록 가능합니다
        </span>
      ) : (
        <>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: isDragging ? C.accent : '#3f3f46',
              textAlign: 'center',
            }}
          >
            파일을 드래그하거나 클릭해서 선택
          </span>
          <span style={{ fontSize: '11px', color: C.textSub, textAlign: 'center' }}>
            JPG · PNG · WEBP · 최대 10MB · {currentCount}/{maxCount}개 등록됨
          </span>
        </>
      )}

      {/* 숨김 파일 input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={isDisabled}
      />

      {/* 스피너 키프레임 */}
      <style>{`
        @keyframes imageDropZoneSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
