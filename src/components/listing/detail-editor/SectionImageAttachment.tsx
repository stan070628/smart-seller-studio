'use client';
/**
 * SectionImageAttachment
 *
 * 섹션 카드 하단에 표시되는 이미지 첨부 패널입니다.
 * 최대 3장까지 업로드 가능하며, 처리 모드(bg_composed / bg_removed / original)를 선택할 수 있습니다.
 */

import React, { useState, useRef } from 'react';
import { Upload, X, Loader2, FolderOpen } from 'lucide-react';
import type { AttachedImage, ImageProcessingMode, PaletteName } from '@/types/detail-page';
import { useListingStore } from '@/store/useListingStore';

// ─────────────────────────────────────────
// Props
// ─────────────────────────────────────────

interface SectionImageAttachmentProps {
  images: AttachedImage[];
  palette: PaletteName;
  onChange: (images: AttachedImage[]) => void;
  onAiEdit?: (imageUrl: string, index: number) => void;
}

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const MAX_IMAGES = 2;

const MODE_LABELS: Record<ImageProcessingMode, string> = {
  bg_composed: '배경 합성',
  bg_removed: '배경 제거',
  original: '원본',
};

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

/**
 * File 객체를 base64 문자열(data URL prefix 제거)로 변환합니다.
 */
const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// ─────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────

export default function SectionImageAttachment({
  images,
  palette,
  onChange,
  onAiEdit,
}: SectionImageAttachmentProps) {
  // 현재 선택된 처리 모드
  const [processingMode, setProcessingMode] = useState<ImageProcessingMode>('bg_composed');
  // 업로드 진행 중 여부
  const [isUploading, setIsUploading] = useState(false);
  // 업로드 에러 메시지
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 소스 이미지 픽커 모달
  const [showPicker, setShowPicker] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { sharedDraft } = useListingStore();
  const sourceImages = [
    ...sharedDraft.thumbnailImages,
    ...sharedDraft.detailImages,
    ...sharedDraft.pickedDetailImages,
  ].filter((url, idx, arr) => url && arr.indexOf(url) === idx);

  const canAddMore = images.length < MAX_IMAGES;

  // 파일 선택 → 업로드 처리
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    // 최대 개수 초과 방어
    const slots = MAX_IMAGES - images.length;
    const filesToProcess = files.slice(0, slots);

    // input 초기화 (같은 파일 재선택 가능하도록)
    if (fileInputRef.current) fileInputRef.current.value = '';

    setIsUploading(true);
    setErrorMsg(null);

    try {
      const mimeAllowList = ['image/jpeg', 'image/png', 'image/webp'] as const;
      type AllowedMime = (typeof mimeAllowList)[number];

      const uploaded: AttachedImage[] = [];

      for (const file of filesToProcess) {
        // MIME 타입 검증
        if (!mimeAllowList.includes(file.type as AllowedMime)) {
          throw new Error(`지원하지 않는 이미지 형식입니다: ${file.type}`);
        }

        // base64 변환
        const imageBase64 = await toBase64(file);

        // API 호출 — storagePath는 서버에서 고정 경로 사용, 클라이언트에서 전달하지 않음
        const res = await fetch('/api/detail-page/process-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64,
            processingMode,
            palette,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
          throw new Error((errJson as { error?: string }).error ?? `업로드 실패 (${res.status})`);
        }

        const data = (await res.json()) as { url: string; processingMode: ImageProcessingMode };

        uploaded.push({
          url: data.url,
          order: images.length + uploaded.length,
          processingMode: data.processingMode,
        });
      }

      onChange([...images, ...uploaded]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '이미지 업로드 중 오류가 발생했습니다.';
      setErrorMsg(msg);
    } finally {
      setIsUploading(false);
    }
  };

  // 이미지 삭제 → order 재할당
  const handleRemove = (index: number) => {
    const updated = images
      .filter((_, i) => i !== index)
      .map((img, i) => ({ ...img, order: i }));
    onChange(updated);
  };

  // 소스 이미지 URL 선택 → process-image API 호출
  const handleSourceImageSelect = async (imageUrl: string) => {
    setShowPicker(false);
    if (images.length >= MAX_IMAGES) return;

    setIsUploading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/detail-page/process-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, processingMode, palette }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: '알 수 없는 오류' }));
        throw new Error((errJson as { error?: string }).error ?? `처리 실패 (${res.status})`);
      }
      const data = (await res.json()) as { url: string; processingMode: ImageProcessingMode };
      onChange([...images, { url: data.url, order: images.length, processingMode: data.processingMode }]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '이미지 불러오기 중 오류가 발생했습니다.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid #eeeeee',
        padding: '10px 12px',
        background: '#fafafa',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 헤더 행 — 레이블 + 처리 모드 선택 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#888888',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          섹션 이미지
        </span>

        {/* 처리 모드 선택 */}
        <select
          value={processingMode}
          onChange={(e) => setProcessingMode(e.target.value as ImageProcessingMode)}
          disabled={isUploading}
          style={{
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 4,
            border: '1px solid #dddddd',
            background: '#ffffff',
            color: '#444444',
            cursor: isUploading ? 'not-allowed' : 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none',
          }}
        >
          {(Object.entries(MODE_LABELS) as [ImageProcessingMode, string][]).map(
            ([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ),
          )}
        </select>
      </div>

      {/* 이미지 썸네일 + 업로드 버튼 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {/* 기존 이미지 썸네일 */}
        {images.map((img, idx) => (
          <div
            key={img.url}
            style={{
              position: 'relative',
              width: 60,
              height: 60,
              borderRadius: 6,
              overflow: 'hidden',
              border: '1px solid #dddddd',
              flexShrink: 0,
            }}
          >
            {/* 썸네일 */}
            <img
              src={img.url}
              alt={`첨부 이미지 ${idx + 1}`}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />

            {/* 삭제 버튼 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(idx);
              }}
              title="이미지 삭제"
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <X size={11} color="#ffffff" />
            </button>

            {/* AI 편집 버튼 */}
            {onAiEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAiEdit(img.url, idx);
                }}
                title="AI로 편집"
                style={{
                  position: 'absolute',
                  bottom: 2,
                  left: 2,
                  background: '#7c3aed',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: '2px 5px',
                }}
              >
                <span style={{ fontSize: 9, color: '#fff', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}>🪄</span>
              </button>
            )}
          </div>
        ))}

        {/* 업로드 중 스피너 */}
        {isUploading && (
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 6,
              border: '1px dashed #cccccc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: '#ffffff',
            }}
          >
            <Loader2
              size={20}
              color="#888888"
              style={{ animation: 'siaSpinAnim 1s linear infinite' }}
            />
          </div>
        )}

        {/* 파일 추가 버튼 — 최대 개수 미달 + 업로드 중 아닐 때만 노출 */}
        {canAddMore && !isUploading && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              title="이미지 추가"
              style={{
                width: 60,
                height: 60,
                borderRadius: 6,
                border: '1.5px dashed #cccccc',
                background: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                flexShrink: 0,
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#999999';
                (e.currentTarget as HTMLButtonElement).style.background = '#f5f5f5';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#cccccc';
                (e.currentTarget as HTMLButtonElement).style.background = '#ffffff';
              }}
            >
              <Upload size={16} color="#aaaaaa" />
              <span
                style={{
                  fontSize: 10,
                  color: '#aaaaaa',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                추가
              </span>
            </button>

            {/* 소스 이미지 불러오기 버튼 */}
            {sourceImages.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowPicker(true);
                }}
                title="소스 이미지 불러오기"
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 6,
                  border: '1.5px dashed #93c5fd',
                  background: '#eff6ff',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  flexShrink: 0,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#3b82f6';
                  (e.currentTarget as HTMLButtonElement).style.background = '#dbeafe';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#93c5fd';
                  (e.currentTarget as HTMLButtonElement).style.background = '#eff6ff';
                }}
              >
                <FolderOpen size={16} color="#3b82f6" />
                <span style={{ fontSize: 10, color: '#3b82f6', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                  소스
                </span>
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </>
        )}
      </div>

      {/* 소스 이미지 픽커 모달 */}
      {showPicker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPicker(false);
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 560,
              maxHeight: '80vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            {/* 모달 헤더 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderBottom: '1px solid #eeeeee',
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111111', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                  소스 이미지 불러오기
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#888888', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                  선택 시 현재 처리 모드({MODE_LABELS[processingMode]})로 처리됩니다
                </p>
              </div>
              <button
                onClick={() => setShowPicker(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888888', fontSize: 20, lineHeight: 1, padding: '0 4px' }}
              >
                ×
              </button>
            </div>

            {/* 이미지 그리드 */}
            <div style={{ padding: 12, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {sourceImages.map((url) => (
                <button
                  key={url}
                  onClick={() => handleSourceImageSelect(url)}
                  style={{
                    padding: 0,
                    border: '2px solid transparent',
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    aspectRatio: '1',
                    background: '#f5f5f5',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#3b82f6';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="소스 이미지"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 에러 메시지 */}
      {errorMsg && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 11,
            color: '#e53e3e',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {errorMsg}
        </p>
      )}

      {/* spin 키프레임 (컴포넌트 내 scoped) */}
      <style>{`
        @keyframes siaSpinAnim {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
