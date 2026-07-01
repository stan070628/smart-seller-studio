'use client';

import React, { useRef, useState } from 'react';
import ImageCleanupModal from '@/components/common/ImageCleanupModal';
import { Wand2, Loader2 } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import type { TextBadgeOptions } from '@/lib/detail-page/thumbnail-flow';

type BadgePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

const DIRECTION_EXAMPLES = [
  '화이트 스튜디오 배경, 조명 강조',
  '자연광 야외 라이프스타일 컷',
  '1번·2번 사진을 나란히 합성, 미니멀',
  '그라데이션 배경, 제품 클로즈업',
];

const BADGE_POSITIONS: { label: string; value: BadgePosition }[] = [
  { label: '우상단', value: 'top-right' },
  { label: '좌상단', value: 'top-left' },
  { label: '우하단', value: 'bottom-right' },
  { label: '좌하단', value: 'bottom-left' },
];

function loadStorage(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return localStorage.getItem(key) ?? fallback;
}

interface Props {
  refImageUrls: string[];
  isGenerating: boolean;
  error: string | null;
  onGenerate: (direction: string, textBadge?: TextBadgeOptions) => void;
  // 썸네일 탭 전용 참조 이미지
  extraRefUrls?: string[];
  uploadingExtraRef?: boolean;
  onUploadExtraRef?: (files: FileList | File[]) => void;
  onRemoveExtraRef?: (idx: number) => void;
  onReplaceExtraRef?: (idx: number, newUrl: string) => void;
  onAddExtraRef?: (newUrl: string) => void;
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
  onReplaceExtraRef,
  onAddExtraRef,
}: Props) {
  const [direction, setDirection] = useState('');
  const [cleanupExtraIdx, setCleanupExtraIdx] = useState<number | null>(null);
  const [watermarkExtraIdx, setWatermarkExtraIdx] = useState<number | null>(null);
  const [coupangConvertIdx, setCoupangConvertIdx] = useState<number | null>(null);
  const [coupangPreview, setCoupangPreview] = useState<{ idx: number; blobUrl: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 텍스트 뱃지 상태 (localStorage 영속화)
  const [badgeEnabled, setBadgeEnabled] = useState(false);
  const [badgeText, setBadgeText] = useState(() => loadStorage('thumbnailBadgeText', ''));
  const [badgePosition, setBadgePosition] = useState<BadgePosition>(
    () => loadStorage('thumbnailBadgePosition', 'top-right') as BadgePosition,
  );

  function handleBadgeTextChange(v: string) {
    setBadgeText(v);
    if (typeof window !== 'undefined') localStorage.setItem('thumbnailBadgeText', v);
  }

  function handleBadgePositionChange(v: BadgePosition) {
    setBadgePosition(v);
    if (typeof window !== 'undefined') localStorage.setItem('thumbnailBadgePosition', v);
  }

  async function handleCoupangConvert(url: string, idx: number) {
    setCoupangConvertIdx(idx);
    try {
      const res = await fetch('/api/image/coupang-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '변환 실패' })) as { error?: string };
        alert(err.error ?? '쿠팡 변환에 실패했습니다.');
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setCoupangPreview({ idx, blobUrl });
    } catch {
      alert('쿠팡 변환 중 오류가 발생했습니다.');
    } finally {
      setCoupangConvertIdx(null);
    }
  }

  function handleGenerate() {
    const badge: TextBadgeOptions | undefined =
      badgeEnabled && badgeText.trim()
        ? { text: badgeText.trim(), position: badgePosition }
        : undefined;
    onGenerate(direction.trim(), badge);
  }

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
                {/* 쿠팡 변환 버튼 */}
                <button
                  onClick={() => handleCoupangConvert(url, idx)}
                  disabled={coupangConvertIdx === idx}
                  aria-label="쿠팡 규격 변환"
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: 2,
                    background: coupangConvertIdx === idx ? 'rgba(0,0,0,0.4)' : 'rgba(190,0,20,0.85)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '9px',
                    padding: '2px 4px',
                    cursor: coupangConvertIdx === idx ? 'wait' : 'pointer',
                    lineHeight: 1,
                    fontWeight: 700,
                  }}
                >
                  {coupangConvertIdx === idx ? '...' : '쿠팡'}
                </button>

                {/* 하단 버튼 행: 한자 | WM */}
                <div style={{ position: 'absolute', bottom: 2, left: 2, right: 2, display: 'flex', gap: 2 }}>
                  <button
                    onClick={() => setCleanupExtraIdx(idx)}
                    aria-label="한자 제거"
                    style={{
                      flex: 1,
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '10px',
                      padding: '2px 0',
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                  >
                    한자
                  </button>
                  <button
                    onClick={() => setWatermarkExtraIdx(idx)}
                    aria-label="워터마크 제거"
                    style={{
                      flex: 1,
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '10px',
                      padding: '2px 0',
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                  >
                    WM
                  </button>
                </div>

                {/* 한자 모달 */}
                {cleanupExtraIdx === idx && (
                  <ImageCleanupModal
                    imageUrl={url}
                    onReplace={newUrl => {
                      onReplaceExtraRef?.(idx, newUrl);
                      setCleanupExtraIdx(null);
                    }}
                    onAdd={newUrl => {
                      onAddExtraRef?.(newUrl);
                      setCleanupExtraIdx(null);
                    }}
                    onClose={() => setCleanupExtraIdx(null)}
                    canAdd={true}
                  />
                )}

                {/* WM 모달 */}
                {watermarkExtraIdx === idx && (
                  <ImageCleanupModal
                    imageUrl={url}
                    mode="watermark"
                    onReplace={newUrl => {
                      onReplaceExtraRef?.(idx, newUrl);
                      setWatermarkExtraIdx(null);
                    }}
                    onAdd={newUrl => {
                      onAddExtraRef?.(newUrl);
                      setWatermarkExtraIdx(null);
                    }}
                    onClose={() => setWatermarkExtraIdx(null)}
                    canAdd={true}
                  />
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

      {/* 텍스트 뱃지 토글 */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
            cursor: 'pointer', background: badgeEnabled ? 'rgba(190,0,20,0.04)' : 'transparent',
          }}
        >
          <input
            type="checkbox"
            checked={badgeEnabled}
            onChange={e => setBadgeEnabled(e.target.checked)}
            style={{ accentColor: '#be0014', width: 14, height: 14, flexShrink: 0 }}
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>텍스트 뱃지 삽입</span>
          <span style={{ fontSize: 11, color: C.textSub, marginLeft: 'auto' }}>둥근 흰색 박스</span>
        </label>
        {badgeEnabled && (
          <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="text"
              value={badgeText}
              onChange={e => handleBadgeTextChange(e.target.value)}
              placeholder="예: 32매 세트"
              maxLength={20}
              style={{
                width: '100%', padding: '6px 8px', fontSize: 12, color: '#111827',
                border: `1px solid ${C.border}`, borderRadius: 6, outline: 'none',
                boxSizing: 'border-box', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {BADGE_POSITIONS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handleBadgePositionChange(p.value)}
                  style={{
                    flex: 1, padding: '4px 0', fontSize: 11, borderRadius: 4,
                    border: `1px solid ${badgePosition === p.value ? '#be0014' : C.border}`,
                    background: badgePosition === p.value ? 'rgba(190,0,20,0.06)' : 'none',
                    color: badgePosition === p.value ? '#be0014' : C.textSub,
                    cursor: 'pointer', fontWeight: badgePosition === p.value ? 600 : 400,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 생성 버튼 */}
      <button
        type="button"
        onClick={handleGenerate}
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

      {/* 쿠팡 변환 미리보기 모달 */}
      {coupangPreview && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => {
            URL.revokeObjectURL(coupangPreview.blobUrl);
            setCoupangPreview(null);
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, padding: 20,
              maxWidth: 320, width: '90vw',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>쿠팡 썸네일 변환 결과</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                1200 × 1200px · 흰 배경 · 상품 92% fill
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coupangPreview.blobUrl}
              alt="쿠팡 변환 결과"
              style={{
                width: '100%', aspectRatio: '1', objectFit: 'contain',
                border: '1px solid #e5e7eb', borderRadius: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <a
                href={coupangPreview.blobUrl}
                download="thumbnail-coupang.jpg"
                style={{ flex: 1, textDecoration: 'none' }}
              >
                <button
                  style={{
                    width: '100%', padding: '8px 0',
                    background: '#be0014', color: '#fff',
                    border: 'none', borderRadius: 8,
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  다운로드
                </button>
              </a>
              <button
                onClick={() => {
                  URL.revokeObjectURL(coupangPreview.blobUrl);
                  setCoupangPreview(null);
                }}
                style={{
                  flex: 1, padding: '8px 0',
                  background: '#f3f4f6', color: '#374151',
                  border: 'none', borderRadius: 8,
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
