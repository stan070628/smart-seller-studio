'use client';

import React, { useRef, useState } from 'react';
import { C } from '@/lib/design-tokens';
import type { DetailSection } from '@/types/detail-page';

const BRAND_PURPLE = '#7c3aed';
const MAX_REF = 2;

export interface SceneEditPanelProps {
  section: DetailSection;
  uploadedUrls: string[];
  isEditing: boolean;
  error: string | null;
  prevSceneUrl?: string;
  onEdit: (opts: { instruction: string; referenceImageUrls: string[] }) => Promise<void>;
  onUseAsIs?: (url: string) => void;
  onUndo?: () => void;
  onClose: () => void;
}

export default function SceneEditPanel({
  section,
  uploadedUrls,
  isEditing,
  error,
  prevSceneUrl,
  onEdit,
  onUseAsIs,
  onUndo,
  onClose,
}: SceneEditPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [selectedRefUrls, setSelectedRefUrls] = useState<string[]>([]);
  const [pcUploadedUrls, setPcUploadedUrls] = useState<string[]>([]);
  const [showRefPicker, setShowRefPicker] = useState(false);
  const [pcUploading, setPcUploading] = useState(false);
  const [pcUploadError, setPcUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentImageUrl = section.attachedImages[0]?.url ?? null;
  const allRefUrls = [...selectedRefUrls, ...pcUploadedUrls];
  const canAddMore = allRefUrls.length < MAX_REF;
  const hasCurrentImage = !!currentImageUrl;

  // 레퍼런스 이미지 선택/해제 토글
  function toggleRefUrl(url: string) {
    setSelectedRefUrls(prev => {
      if (prev.includes(url)) return prev.filter(u => u !== url);
      if (prev.length + pcUploadedUrls.length >= MAX_REF) return prev;
      return [...prev, url];
    });
  }

  // PC 업로드 이미지 제거
  function removePcUrl(url: string) {
    setPcUploadedUrls(prev => prev.filter(u => u !== url));
  }

  // PC 파일 업로드 처리
  async function handlePcFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0 || !canAddMore) return;
    setPcUploading(true);
    setPcUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', files[0]);
      fd.append('usageContext', 'scene_reference');
      const res = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
      const json = await res.json() as { success: boolean; data?: { url: string }; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? '업로드 실패');
      setPcUploadedUrls(prev => [...prev, json.data!.url].slice(0, MAX_REF));
    } catch (err) {
      setPcUploadError(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.');
    } finally {
      setPcUploading(false);
    }
  }

  // 생성/수정 제출
  async function handleSubmit() {
    if (isEditing) return;
    await onEdit({ instruction: instruction.trim(), referenceImageUrls: allRefUrls });
  }

  const submitLabel = hasCurrentImage ? '✨ 이미지 수정 재생성' : '✨ 씬 이미지 새로 생성';
  const asIsSourceUrl = allRefUrls[0] ?? uploadedUrls[0] ?? null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ padding: '14px 14px 16px', background: '#faf9ff', borderTop: `2px solid ${BRAND_PURPLE}22` }}
    >
      {/* 현재 이미지 미리보기 or 안내 배너 */}
      {hasCurrentImage ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentImageUrl}
              alt="현재 씬 이미지"
              style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }}
            />
            <span style={{
              position: 'absolute', bottom: -4, right: -4,
              background: BRAND_PURPLE, color: '#fff', fontSize: 8,
              padding: '1px 4px', borderRadius: 3, fontWeight: 700,
            }}>현재</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 }}>현재 AI 생성 이미지</div>
            <div style={{ fontSize: 10, color: C.textSub, lineHeight: 1.4 }}>
              이 이미지를 기반으로 수정합니다. 레퍼런스와 지시어로 원하는 방향으로 변경하세요.
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6,
          padding: '8px 10px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>💡</span>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e' }}>아직 생성된 이미지가 없어요</div>
            <div style={{ fontSize: 10, color: '#b45309', marginTop: 1 }}>레퍼런스와 방향을 입력하면 새로 만들어드립니다</div>
          </div>
        </div>
      )}

      {/* 레퍼런스 이미지 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          레퍼런스 이미지{' '}
          <span style={{ fontWeight: 400, color: C.textSub }}>(선택 · {allRefUrls.length}/{MAX_REF}장)</span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {uploadedUrls.length > 0 && canAddMore && (
            <button
              type="button"
              onClick={() => setShowRefPicker(v => !v)}
              style={{
                padding: '6px 10px', border: `1.5px dashed ${BRAND_PURPLE}77`,
                borderRadius: 6, background: '#fff', color: BRAND_PURPLE,
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              🗂 참고 이미지에서
            </button>
          )}
          {canAddMore && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pcUploading}
              style={{
                padding: '6px 10px', border: `1.5px dashed ${BRAND_PURPLE}77`,
                borderRadius: 6, background: '#fff', color: BRAND_PURPLE,
                fontSize: 11, fontWeight: 600,
                cursor: pcUploading ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              💻 {pcUploading ? '업로드 중...' : 'PC에서 업로드'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handlePcFileChange}
          />
        </div>

        {/* 레퍼런스 이미지 그리드 (참고 이미지에서 버튼 클릭 시 노출) */}
        {showRefPicker && uploadedUrls.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
            {uploadedUrls.map(url => {
              const selected = selectedRefUrls.includes(url);
              const disabled = !selected && allRefUrls.length >= MAX_REF;
              return (
                <button
                  key={url}
                  type="button"
                  onClick={() => !disabled && toggleRefUrl(url)}
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-label={`레퍼런스 이미지 ${selectedRefUrls.indexOf(url) + 1 || ''}`}
                  style={{
                    position: 'relative',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    display: 'block',
                    width: '100%',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    role="img"
                    style={{
                      width: '100%', aspectRatio: '1', objectFit: 'cover',
                      borderRadius: 4, border: `2px solid ${selected ? BRAND_PURPLE : C.border}`,
                    }}
                  />
                  {selected && (
                    <div style={{
                      position: 'absolute', top: 2, right: 2,
                      width: 14, height: 14, borderRadius: '50%',
                      background: BRAND_PURPLE, color: '#fff',
                      fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                    }}>✓</div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 선택된 레퍼런스 이미지 프리뷰 */}
        {allRefUrls.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {allRefUrls.map(url => (
              <div key={url} style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: `1px solid ${C.border}` }} />
                <button
                  type="button"
                  onClick={() => {
                    if (selectedRefUrls.includes(url)) toggleRefUrl(url);
                    else removePcUrl(url);
                  }}
                  style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#ef4444', color: '#fff', border: 'none',
                    fontSize: 8, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {pcUploadError && (
          <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }}>{pcUploadError}</div>
        )}
      </div>

      {/* 지시어 입력 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>
          {hasCurrentImage ? '수정 지시어' : '생성 방향'}{' '}
          <span style={{ fontWeight: 400, color: C.textSub }}>(선택)</span>
        </div>
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder={hasCurrentImage ? '예) 배경을 더 밝게, 야외 카페 분위기로 바꿔줘' : '예) 밝고 화사한 야외 카페 분위기'}
          rows={2}
          maxLength={500}
          style={{
            width: '100%', padding: '8px 10px', fontSize: 11,
            color: '#111827', border: `1px solid ${BRAND_PURPLE}55`,
            borderRadius: 6, resize: 'vertical', outline: 'none',
            lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff',
          }}
        />
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div style={{
          padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 6, fontSize: 11, color: '#dc2626', marginBottom: 10,
        }}>
          {error}
        </div>
      )}

      {/* 원본 그대로 사용 버튼 */}
      {onUseAsIs && (
        <div style={{ marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => asIsSourceUrl && onUseAsIs(asIsSourceUrl)}
            disabled={!asIsSourceUrl || isEditing}
            style={{
              width: '100%', padding: '8px', border: `1px solid ${asIsSourceUrl && !isEditing ? '#16a34a' : C.border}`,
              borderRadius: 7, background: asIsSourceUrl && !isEditing ? '#f0fdf4' : '#f9fafb',
              color: asIsSourceUrl && !isEditing ? '#16a34a' : C.textSub,
              fontSize: 12, fontWeight: 600, cursor: asIsSourceUrl && !isEditing ? 'pointer' : 'not-allowed',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            {asIsSourceUrl ? '🖼 원본 이미지 그대로 사용' : '🖼 원본 사용 (이미지를 먼저 선택하세요)'}
          </button>
        </div>
      )}

      {/* 액션 버튼 영역 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {prevSceneUrl && onUndo && (
          <button
            type="button"
            onClick={onUndo}
            style={{
              padding: '9px 10px', border: `1px solid ${C.border}`,
              borderRadius: 7, background: '#fff', color: C.text,
              fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            ↩ 되돌리기
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '9px 12px', border: `1px solid ${C.border}`,
            borderRadius: 7, background: '#fff', color: C.text,
            fontSize: 12, cursor: 'pointer',
          }}
        >
          닫기
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isEditing}
          style={{
            flex: 1, padding: '9px', border: 'none',
            background: isEditing ? C.border : BRAND_PURPLE,
            color: isEditing ? C.textSub : '#fff',
            borderRadius: 7, fontSize: 12, fontWeight: 700,
            cursor: isEditing ? 'not-allowed' : 'pointer',
          }}
        >
          {isEditing ? '⏳ 생성 중...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
