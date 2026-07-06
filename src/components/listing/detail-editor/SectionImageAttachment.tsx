'use client';
/**
 * SectionImageAttachment
 *
 * 섹션 카드 하단에 표시되는 이미지 첨부 패널입니다.
 * 섹션 타입별 최대 개수(image_grid 6장, 그 외 2장)까지 업로드 가능하며,
 * 처리 모드(bg_composed / bg_removed / original)를 선택할 수 있습니다.
 */

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Upload, X, Loader2, FolderOpen } from 'lucide-react';
import type { AttachedImage, ImageProcessingMode, PaletteName, SectionType } from '@/types/detail-page';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
import { useListingStore } from '@/store/useListingStore';

// ─────────────────────────────────────────
// Props
// ─────────────────────────────────────────

interface SectionImageAttachmentProps {
  images: AttachedImage[];
  palette: PaletteName;
  sectionType?: SectionType;
  onChange: (images: AttachedImage[]) => void;
  onAiEdit?: (imageUrl: string, index: number) => void;
  /** DetailMaker에서 AI 씬 생성에 사용되는 참조(상품) 이미지 URLs */
  referenceUrls?: string[];
}

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const DEFAULT_MAX_IMAGES = 2;
const IMAGE_GRID_MAX_IMAGES = 6; // 렌더 API Zod .max(6)과 동기화

const MODE_LABELS: Record<ImageProcessingMode, string> = {
  bg_composed: '배경 합성',
  bg_removed: '배경 제거',
  original: '원본',
};


// ─────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────

export default function SectionImageAttachment({
  images,
  palette,
  sectionType,
  onChange,
  onAiEdit,
  referenceUrls = [],
}: SectionImageAttachmentProps) {
  // 섹션 타입별 최대 첨부 개수 — image_grid는 6장, 그 외 2장
  const maxImages = sectionType === 'image_grid' ? IMAGE_GRID_MAX_IMAGES : DEFAULT_MAX_IMAGES;
  // 현재 선택된 처리 모드
  const [processingMode, setProcessingMode] = useState<ImageProcessingMode>('bg_composed');
  // 업로드 진행 중 여부
  const [isUploading, setIsUploading] = useState(false);
  // 업로드 에러 메시지
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 소스 이미지 픽커 모달
  const [showPicker, setShowPicker] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mergeFileInputRef = useRef<HTMLInputElement>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const { sharedDraft, assetsDraft } = useListingStore();
  const aiImageSlots: AiImageSlot[] = assetsDraft.aiImageSlots ?? [];
  const sourceImages = [
    ...sharedDraft.thumbnailImages,
    ...sharedDraft.detailImages,
    ...sharedDraft.pickedDetailImages,
    ...assetsDraft.thumbnailFiles,
    ...assetsDraft.detailFiles,
    ...assetsDraft.generatedThumbnails,
  ].filter((url, idx, arr) => url && arr.indexOf(url) === idx);

  const canAddMore = images.length < maxImages;

  // 파일 선택 → 업로드 처리
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    // 최대 개수 초과 방어
    const slots = maxImages - images.length;
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

        // Step 1: FormData로 /api/listing/upload-image 업로드 (서버에서 2000px 리사이즈 + JPEG 변환, 최대 10MB)
        const fd = new FormData();
        fd.append('file', file);
        fd.append('usageContext', 'listing_detail');
        const uploadRes = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
        if (!uploadRes.ok) {
          if (uploadRes.status === 413) throw new Error('이미지 파일이 너무 큽니다 (최대 10MB).');
          const err = await uploadRes.json().catch(() => ({ error: '업로드 실패' }));
          throw new Error((err as { error?: string }).error ?? `업로드 실패 (${uploadRes.status})`);
        }
        const { data: uploadData } = await uploadRes.json() as { data: { url: string } };

        // Step 2: 업로드된 URL로 process-image 호출 (처리 모드 적용)
        const processRes = await fetch('/api/detail-page/process-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: uploadData.url, processingMode, palette }),
        });
        if (!processRes.ok) {
          if (processRes.status === 413) throw new Error('이미지 파일이 너무 큽니다 (최대 10MB).');
          const errJson = await processRes.json().catch(() => ({ error: '알 수 없는 오류' }));
          throw new Error((errJson as { error?: string }).error ?? `처리 실패 (${processRes.status})`);
        }
        const data = await processRes.json() as { url: string; processingMode: ImageProcessingMode };

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

  // 파일 선택 → merge-vertical → 섹션 이미지로 추가 (원본 그대로, Gemini 없음)
  const handleMergeFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (mergeFileInputRef.current) mergeFileInputRef.current.value = '';
    if (!files || files.length < 2) {
      setMergeError('2장 이상 선택하세요 (Ctrl/Cmd + 클릭으로 다중 선택)');
      return;
    }
    setIsMerging(true);
    setMergeError(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      const res = await fetch('/api/image/merge-vertical', { method: 'POST', body: fd });
      const json = await res.json() as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setMergeError(json.error ?? '합치기 실패');
        return;
      }
      onChange([...images, { url: json.url, order: images.length, processingMode: 'original' }]);
    } catch {
      setMergeError('이미지 합치기 중 오류가 발생했습니다.');
    } finally {
      setIsMerging(false);
    }
  };

  // AI 생성 이미지 직접 추가 — process-image 없이 원본 URL 그대로 추가
  const handleAiImageDirectAdd = (slot: AiImageSlot) => {
    setShowPicker(false);
    if (images.length >= maxImages) return;
    onChange([...images, { url: slot.url, order: images.length, processingMode: 'original' }]);
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
    if (images.length >= maxImages) return;

    setIsUploading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/detail-page/process-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, processingMode, palette }),
      });
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error('이미지 파일이 너무 큽니다 (최대 5MB 이하 권장).');
        }
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
        {/* 기존 이미지 썸네일 — url 없는 슬롯(ClaudeLayoutEditor gemini 슬롯 등)은 건너뜀 */}
        {images.map((img, idx) => img.url ? (
          <div
            key={img.url || idx}
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

            {/* 다운로드 버튼 */}
            <button
              type="button"
              aria-label="이미지 다운로드"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const res = await fetch(img.url);
                  const blob = await res.blob();
                  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
                  const objUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = objUrl;
                  a.download = `section-image-${idx + 1}.${ext}`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(objUrl);
                } catch {
                  window.open(img.url, '_blank', 'noopener,noreferrer');
                }
              }}
              title="다운로드"
              style={{
                position: 'absolute',
                bottom: 2,
                right: 2,
                background: 'rgba(0,0,0,0.6)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '2px 5px',
              }}
            >
              <span style={{ fontSize: 9, color: '#fff', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}>↓</span>
            </button>

            {/* AI 편집 버튼 */}
            {onAiEdit && (
              <button
                type="button"
                aria-label="AI로 편집"
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
        ) : null)}

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
            {(referenceUrls.length > 0 || sourceImages.length > 0 || aiImageSlots.length > 0) && (
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

            {/* 세로 합치기 버튼 — 2장 이상 선택해 하나로 합침 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                mergeFileInputRef.current?.click();
              }}
              disabled={isMerging}
              title="이미지 2장 이상을 세로로 합치기"
              style={{
                width: 60,
                height: 60,
                borderRadius: 6,
                border: `1.5px dashed ${isMerging ? '#cccccc' : '#86efac'}`,
                background: isMerging ? '#f9fafb' : '#f0fdf4',
                cursor: isMerging ? 'wait' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                flexShrink: 0,
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!isMerging) {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#16a34a';
                  (e.currentTarget as HTMLButtonElement).style.background = '#dcfce7';
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#86efac';
                (e.currentTarget as HTMLButtonElement).style.background = '#f0fdf4';
              }}
            >
              {isMerging
                ? <Loader2 size={16} color="#16a34a" style={{ animation: 'siaSpinAnim 1s linear infinite' }} />
                : <span style={{ fontSize: 18, lineHeight: 1, color: '#16a34a' }}>↕</span>
              }
              <span style={{ fontSize: 10, color: '#16a34a', fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 600 }}>
                {isMerging ? '합치는중' : '합치기'}
              </span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <input
              ref={mergeFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={handleMergeFiles}
            />
          </>
        )}
      </div>

      {/* 소스 이미지 픽커 모달 — sticky 스태킹 컨텍스트 탈출을 위해 portal 사용 */}
      {showPicker && createPortal(
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
            <div style={{ padding: 12, overflowY: 'auto' }}>
              {/* 참조 이미지 섹션 */}
              {referenceUrls.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#059669', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                    참조 이미지
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {referenceUrls.map((url) => (
                      <button
                        key={url}
                        onClick={() => handleSourceImageSelect(url)}
                        style={{
                          padding: 0,
                          border: '2px solid #a7f3d0',
                          borderRadius: 8,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          aspectRatio: '1',
                          background: '#ecfdf5',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#059669';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#a7f3d0';
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url || undefined}
                          alt="참조 이미지"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </button>
                    ))}
                  </div>
                  {(aiImageSlots.length > 0 || sourceImages.length > 0) && (
                    <hr style={{ margin: '12px 0 0', border: 'none', borderTop: '1px solid #eeeeee' }} />
                  )}
                </div>
              )}
              {/* AI 생성 이미지 섹션 */}
              {aiImageSlots.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#7c3aed', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                    AI 생성 이미지
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {aiImageSlots.map((slot) => (
                      <button
                        key={slot.url}
                        onClick={() => handleAiImageDirectAdd(slot)}
                        title={slot.role}
                        style={{
                          padding: 0,
                          border: '2px solid #ede9fe',
                          borderRadius: 8,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          aspectRatio: '1',
                          background: '#faf5ff',
                          position: 'relative',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#7c3aed';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#ede9fe';
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={slot.url}
                          alt={slot.role}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          background: 'rgba(124,58,237,0.75)',
                          fontSize: 9,
                          color: '#fff',
                          textAlign: 'center',
                          padding: '2px 0',
                          fontFamily: 'system-ui, sans-serif',
                          fontWeight: 600,
                        }}>
                          {slot.role === 'hero' ? '히어로' : slot.role === 'lifestyle' ? '라이프' : slot.role === 'detail' ? '디테일' : '특징'}
                        </div>
                      </button>
                    ))}
                  </div>
                  {sourceImages.length > 0 && (
                    <hr style={{ margin: '12px 0 0', border: 'none', borderTop: '1px solid #eeeeee' }} />
                  )}
                </div>
              )}

              {/* 업로드 이미지 그리드 */}
              {sourceImages.length > 0 && (
                <div>
                  {aiImageSlots.length > 0 && (
                    <p style={{ margin: '8px 0 6px', fontSize: 11, fontWeight: 700, color: '#888888', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                      업로드 이미지
                    </p>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
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
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 에러 메시지 */}
      {(errorMsg || mergeError) && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 11,
            color: '#e53e3e',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {errorMsg ?? mergeError}
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
