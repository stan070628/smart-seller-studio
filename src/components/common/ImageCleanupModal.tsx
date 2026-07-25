'use client';

import React, { useRef, useState } from 'react';

interface ImageCleanupModalProps {
  /** 표시용 이미지. blob: URL 허용 */
  imageUrl: string;
  /** 있으면 API 호출에 imageUrl 대신 사용 (업로드 전 File 대응) */
  imageBase64?: string;
  mimeType?: string;
  onReplace: (newUrl: string) => void;
  /** 있으면 Storage 업로드를 건너뛰고 결과 base64를 그대로 넘긴다 */
  onResultBase64?: (base64: string, mimeType: string) => void;
  onAdd: (newUrl: string) => void;
  onClose: () => void;
  canAdd: boolean;
  mode?: 'chinese' | 'watermark';
}

type Phase = 'select' | 'processing' | 'preview';

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function ImageCleanupModal({
  imageUrl,
  imageBase64,
  mimeType,
  onReplace,
  onResultBase64,
  onAdd,
  onClose,
  canAdd,
  mode = 'chinese',
}: ImageCleanupModalProps) {
  const isWatermark = mode === 'watermark';
  const modalTitle = isWatermark ? '워터마크 제거' : '한자 제거';
  const hintText = isWatermark
    ? '워터마크 영역을 드래그해서 선택하세요. AI가 자동으로 지워드립니다.'
    : '한자 영역을 드래그해서 선택하세요. 주변 한자까지 자동으로 커버됩니다.';
  const apiEndpoint = isWatermark
    ? '/api/ai/remove-watermark-region'
    : '/api/ai/cleanup-image-region';
  const processingText = isWatermark ? '워터마크 제거 중…' : '한자 제거 중…';
  const selectHintText = isWatermark
    ? '워터마크 영역을 더 크게 선택해주세요.'
    : '한자 영역을 더 크게 선택해주세요.';
  const [phase, setPhase] = useState<Phase>('select');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [resultBase64, setResultBase64] = useState<string | null>(null);
  const [resultMime, setResultMime] = useState('image/jpeg');
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  function getNorm(e: React.MouseEvent) {
    if (!imgRef.current) return { x: 0, y: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const { x, y } = getNorm(e);
    setDragStart({ x, y });
    setSelection(null);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragStart) return;
    const { x, y } = getNorm(e);
    setSelection({
      x: Math.min(dragStart.x, x),
      y: Math.min(dragStart.y, y),
      width: Math.abs(x - dragStart.x),
      height: Math.abs(y - dragStart.y),
    });
  }

  function handleMouseUp() {
    setDragStart(null);
  }

  const isSelectionValid =
    selection !== null && selection.width >= 0.02 && selection.height >= 0.02;

  async function handleExecute() {
    if (!selection) return;
    setPhase('processing');
    setError(null);
    try {
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          imageBase64
            ? { imageBase64, mimeType: mimeType ?? 'image/jpeg', region: selection }
            : { imageUrl, region: selection },
        ),
      });
      const data = await res.json() as { imageBase64?: string; mimeType?: string; error?: string };
      if (!res.ok || data.error || !data.imageBase64) {
        setError(data.error ?? '처리 중 오류가 발생했습니다.');
        setPhase('select');
        return;
      }
      setResultBase64(data.imageBase64);
      setResultMime(data.mimeType ?? 'image/jpeg');
      setPhase('preview');
    } catch {
      setError('처리 중 오류가 발생했습니다.');
      setPhase('select');
    }
  }

  async function uploadResult(): Promise<string> {
    const res = await fetch('/api/image/upload-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: resultBase64, mimeType: resultMime }),
    });
    const data = await res.json() as { success: boolean; url?: string };
    if (!data.success || !data.url) throw new Error('업로드 실패');
    return data.url;
  }

  async function handleReplace() {
    if (onResultBase64 && resultBase64) {
      onResultBase64(resultBase64, resultMime);
      return;
    }
    setIsUploading(true);
    try {
      const url = await uploadResult();
      onReplace(url);
    } catch {
      setError('업로드에 실패했습니다. 다시 시도해주세요.');
      setIsUploading(false);
    }
  }

  async function handleAdd() {
    if (!canAdd) return;
    setIsUploading(true);
    try {
      const url = await uploadResult();
      onAdd(url);
    } catch {
      setError('업로드에 실패했습니다. 다시 시도해주세요.');
      setIsUploading(false);
    }
  }

  function handleRetry() {
    setPhase('select');
    setResultBase64(null);
    setError(null);
  }

  const selRect = selection
    ? {
        x: `${selection.x * 100}%`,
        y: `${selection.y * 100}%`,
        width: `${selection.width * 100}%`,
        height: `${selection.height * 100}%`,
      }
    : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#1a1a2e',
          borderRadius: '12px',
          padding: '20px',
          maxWidth: '560px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>{modalTitle}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '18px' }}
          >
            ×
          </button>
        </div>

        {phase === 'select' && (
          <>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '10px' }}>
              {hintText}
            </div>
            <div style={{ position: 'relative', userSelect: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageUrl}
                alt="원본 이미지"
                draggable={false}
                style={{ width: '100%', display: 'block', borderRadius: '6px', cursor: 'crosshair' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              />
              {selRect && (
                <svg
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                >
                  <rect
                    x={selRect.x}
                    y={selRect.y}
                    width={selRect.width}
                    height={selRect.height}
                    fill="rgba(99,102,241,0.15)"
                    stroke="#6366f1"
                    strokeWidth="1.5"
                    strokeDasharray="5,3"
                  />
                </svg>
              )}
            </div>
            {selection && !isSelectionValid && (
              <div style={{ color: '#f87171', fontSize: '11px', marginTop: '6px' }}>
                {selectHintText}
              </div>
            )}
            {error && (
              <div style={{ color: '#f87171', fontSize: '11px', marginTop: '6px' }}>{error}</div>
            )}
            <button
              onClick={handleExecute}
              disabled={!isSelectionValid}
              style={{
                marginTop: '12px',
                width: '100%',
                padding: '10px',
                background: isSelectionValid ? '#6366f1' : '#374151',
                color: isSelectionValid ? '#fff' : '#6b7280',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: isSelectionValid ? 'pointer' : 'not-allowed',
              }}
            >
              제거 실행
            </button>
          </>
        )}

        {phase === 'processing' && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
            {processingText}
          </div>
        )}

        {phase === 'preview' && resultBase64 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>원본</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="원본" style={{ width: '100%', borderRadius: '6px' }} />
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>정리됨</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${resultMime};base64,${resultBase64}`}
                  alt="정리됨"
                  style={{ width: '100%', borderRadius: '6px' }}
                />
              </div>
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '10px' }}>
              결과가 어색하면 박스를 한자에 더 밀착시켜 다시 실행해보세요.
            </div>
            {error && (
              <div style={{ color: '#f87171', fontSize: '11px', marginBottom: '8px' }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleReplace}
                disabled={isUploading}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  opacity: isUploading ? 0.7 : 1,
                }}
              >
                교체
              </button>
              <button
                onClick={handleAdd}
                disabled={isUploading || !canAdd}
                title={!canAdd ? '이미지는 최대 10장입니다' : undefined}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: canAdd ? '#059669' : '#374151',
                  color: canAdd ? '#fff' : '#6b7280',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isUploading || !canAdd ? 'not-allowed' : 'pointer',
                }}
              >
                새로 추가
              </button>
              <button
                onClick={handleRetry}
                disabled={isUploading}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#1e293b',
                  color: '#9ca3af',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  fontSize: '13px',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                }}
              >
                다시 실행
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
