'use client';

import React, { useRef, useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { C } from '@/lib/design-tokens';

const DIRECTION_EXAMPLES = [
  '화이트 스튜디오 배경, 조명 강조',
  '자연광 야외 라이프스타일 컷',
  '1번·2번 사진을 나란히 합성, 미니멀',
  '그라데이션 배경, 제품 클로즈업',
];

interface Props {
  refImageUrls: string[];
  isGenerating: boolean;
  error: string | null;
  onGenerate: (direction: string) => void;
  // 썸네일 탭 전용 참조 이미지
  extraRefUrls?: string[];
  uploadingExtraRef?: boolean;
  onUploadExtraRef?: (files: FileList | File[]) => void;
  onRemoveExtraRef?: (idx: number) => void;
}

export default function DetailMakerThumbnailPanel({
  refImageUrls,
  isGenerating,
  error,
  onGenerate,
  extraRefUrls = [],
  uploadingExtraRef = false,
  onUploadExtraRef,
  onRemoveExtraRef,
}: Props) {
  const [direction, setDirection] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveCount = extraRefUrls.length > 0 ? extraRefUrls.length : Math.min(refImageUrls.length, 3);
  const hasRef = extraRefUrls.length > 0 || refImageUrls.length > 0;
  const canGenerate = hasRef && direction.trim().length >= 5 && !isGenerating;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 섹션 제목 */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>AI 썸네일 생성</div>

      {/* 썸네일 전용 참조 이미지 업로드 */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>
          썸네일 참조 이미지{' '}
          <span style={{ fontSize: 11, color: C.textSub, fontWeight: 400 }}>
            ({extraRefUrls.length}/3) — 없으면 상세페이지 이미지 사용
          </span>
        </div>

        {/* 업로드 영역 */}
        {extraRefUrls.length < 3 && onUploadExtraRef && (
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${C.border}`,
              borderRadius: 8,
              padding: '14px',
              textAlign: 'center',
              cursor: 'pointer',
              background: '#fafafa',
              marginBottom: extraRefUrls.length > 0 ? 8 : 0,
            }}
          >
            {uploadingExtraRef ? (
              <div style={{ fontSize: 12, color: C.textSub }}>업로드 중...</div>
            ) : (
              <>
                <div style={{ fontSize: 20, marginBottom: 2 }}>📷</div>
                <div style={{ fontSize: 11, color: C.textSub }}>
                  클릭하여 이미지 선택 (최대 3장)
                </div>
              </>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files && onUploadExtraRef) onUploadExtraRef(e.target.files);
            e.target.value = '';
          }}
        />

        {/* 업로드된 이미지 그리드 */}
        {extraRefUrls.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {extraRefUrls.map((url, idx) => (
              <div key={url} style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`썸네일 참조 ${idx + 1}`}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    objectFit: 'cover',
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                  }}
                />
                {onRemoveExtraRef && (
                  <button
                    onClick={() => onRemoveExtraRef(idx)}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 참조 이미지 상태 표시 */}
      <div
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          background: hasRef ? 'rgba(22,163,74,0.06)' : '#f9f9f9',
          border: `1px solid ${hasRef ? 'rgba(22,163,74,0.2)' : C.border}`,
          fontSize: 12,
          color: hasRef ? '#16a34a' : '#9ca3af',
        }}
      >
        {extraRefUrls.length > 0
          ? `썸네일 전용 이미지 ${effectiveCount}장 사용`
          : refImageUrls.length > 0
            ? `상세페이지 이미지 ${effectiveCount}장 사용`
            : '참고 이미지를 업로드하세요'}
      </div>

      {/* 연출 방향 입력 */}
      <textarea
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        placeholder="연출 방향 예: 스튜디오 조명, 화이트 배경으로 합성"
        rows={3}
        style={{
          width: '100%', padding: '8px 10px', fontSize: 12, color: '#111827',
          border: `1px solid ${C.border}`, borderRadius: 8, resize: 'vertical', outline: 'none',
          lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />

      {/* 예시 칩 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {DIRECTION_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setDirection(ex)}
            style={{
              padding: '3px 8px', fontSize: 11,
              border: `1px solid ${C.border}`, borderRadius: 20,
              background: 'none', cursor: 'pointer',
              color: '#6b7280', lineHeight: 1.4,
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div style={{ padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* 생성 버튼 */}
      <button
        type="button"
        onClick={() => onGenerate(direction.trim())}
        disabled={!canGenerate}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: 10, borderRadius: 8, border: 'none',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          background: canGenerate ? '#be0014' : C.border,
          color: canGenerate ? '#fff' : C.textSub,
          fontWeight: 700, fontSize: 12,
        }}
      >
        {isGenerating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={14} />}
        {isGenerating ? '생성 중...' : 'AI 썸네일 생성'}
      </button>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
