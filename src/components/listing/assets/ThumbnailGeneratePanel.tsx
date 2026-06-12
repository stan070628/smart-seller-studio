// src/components/listing/assets/ThumbnailGeneratePanel.tsx
'use client';

/**
 * ThumbnailGeneratePanel.tsx
 * assets 탭(상품상세 자동만들기)의 AI 썸네일 생성 패널.
 *
 * 흐름:
 *  1. 업로드/크롤링한 이미지(thumbnailFiles → detailFiles → generatedThumbnails)를 참조(최대 3장)로 사용
 *  2. 연출 방향 입력 + "AI 썸네일 생성" 클릭
 *  3. POST /api/ai/generate-thumbnail { refImageUrls, direction }
 *  4. 결과 base64 → POST /api/image/upload-ai → generatedThumbnails에 append
 */

import React, { useState } from 'react';
import { Wand2, Loader2, X } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';

const DIRECTION_EXAMPLES = [
  '화이트 스튜디오 배경, 조명 강조',
  '자연광 야외 라이프스타일 컷',
  '1번·2번 사진을 나란히 합성, 미니멀',
  '그라데이션 배경, 제품 클로즈업',
];

export default function ThumbnailGeneratePanel() {
  const { assetsDraft, updateAssetsDraft } = useListingStore();
  const { mode, thumbnailFiles, detailFiles, generatedThumbnails } = assetsDraft;

  const [direction, setDirection] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 참조 URL 수집 (최대 3장)
  const refImageUrls = (
    mode === 'url'
      ? generatedThumbnails
      : thumbnailFiles.length > 0
        ? thumbnailFiles
        : detailFiles
  )
    .filter(Boolean)
    .slice(0, 3);

  const hasRef = refImageUrls.length > 0;
  const canGenerate = hasRef && direction.trim().length >= 5 && !isLoading;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    try {
      const genRes = await fetch('/api/ai/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refImageUrls, direction: direction.trim() }),
      });
      const genData = (await genRes.json()) as
        | { success: true; data: { imageBase64: string; mimeType: string } }
        | { success: false; error: string };
      if (!genRes.ok || !genData.success) {
        throw new Error(genData.success === false ? genData.error : '썸네일 생성 실패');
      }

      // Supabase 영속화 (role 생략 — upload-ai role enum은 hero/lifestyle/detail/feature만 허용)
      const uploadRes = await fetch('/api/image/upload-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: genData.data.imageBase64,
          mimeType: genData.data.mimeType,
        }),
      });
      const uploadData = (await uploadRes.json()) as { success: boolean; url?: string; error?: string };
      if (!uploadRes.ok || !uploadData.success || !uploadData.url) {
        throw new Error(uploadData.error ?? '이미지 업로드 실패');
      }

      updateAssetsDraft({ generatedThumbnails: [...generatedThumbnails, uploadData.url] });
    } catch (err) {
      setError(err instanceof Error ? err.message : '생성 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1a1c1c' }}>AI 썸네일 생성</p>

      <div style={{
        padding: '8px 10px',
        borderRadius: 8,
        backgroundColor: hasRef ? 'rgba(22,163,74,0.06)' : '#f9f9f9',
        border: `1px solid ${hasRef ? 'rgba(22,163,74,0.2)' : '#eee'}`,
        fontSize: 12,
        color: hasRef ? '#16a34a' : '#9ca3af',
      }}>
        {hasRef ? `참조 사진 ${refImageUrls.length}장 준비됨` : '이미지를 먼저 업로드하거나 URL에서 가져오세요'}
      </div>

      <textarea
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        placeholder="예: 스튜디오 조명, 화이트 배경으로 1·2번 사진 합성"
        rows={3}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 12, color: '#111827',
          border: '1px solid #e5e7eb', borderRadius: 8, resize: 'vertical', outline: 'none',
          lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {DIRECTION_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setDirection(ex)}
            style={{ padding: '3px 8px', fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 20, background: 'none', cursor: 'pointer', color: '#6b7280', lineHeight: 1.4 }}
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: '#dc2626', flex: 1, lineHeight: 1.5 }}>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#dc2626' }}>
            <X size={14} />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={!canGenerate}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: 11, borderRadius: 8, border: 'none',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          backgroundColor: canGenerate ? '#be0014' : '#e5e7eb',
          color: canGenerate ? '#fff' : '#9ca3af',
          fontWeight: 700, fontSize: 13,
        }}
      >
        {isLoading ? (
          <>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            생성 중...
          </>
        ) : (
          <>
            <Wand2 size={15} />
            AI 썸네일 생성
          </>
        )}
      </button>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
