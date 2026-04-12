'use client';

/**
 * ThumbnailGenerateSection.tsx
 * 썸네일 프레임 전용 인스펙터 섹션
 *
 * 흐름:
 *  1. 오른쪽 패널 ImageSection에서 ref1/ref2/ref3 사진 업로드
 *  2. 이 섹션에서 연출 방향 입력 + "AI 썸네일 생성" 버튼 클릭
 *  3. POST /api/ai/generate-thumbnail 호출 → 결과를 main 슬롯에 저장
 */

import React, { useState } from 'react';
import { Wand2, Loader2, X, RefreshCw } from 'lucide-react';
import type { FrameType } from '@/types/frames';
import useEditorStore from '@/store/useEditorStore';

// ─────────────────────────────────────────────────────────────
// 이미지 URL → base64 변환
// ─────────────────────────────────────────────────────────────

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp';

function inferMime(url: string): AllowedMime {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function urlToBase64(url: string): Promise<{ imageBase64: string; mimeType: AllowedMime }> {
  if (url.startsWith('data:')) {
    const [header, imageBase64] = url.split(',');
    const mimeMatch = header.match(/data:(image\/\w+);/);
    const raw = (mimeMatch?.[1] ?? 'image/jpeg') as AllowedMime;
    return { imageBase64, mimeType: raw };
  }
  const res = await fetch(url);
  const blob = await res.blob();
  const mimeType = (blob.type as AllowedMime) || inferMime(url);
  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < uint8.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
  }
  return { imageBase64: btoa(binary), mimeType };
}

// ─────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────

interface Props {
  frameType: FrameType;
  /** 프레임 인스턴스 고유 ID */
  frameId: string;
}

const DIRECTION_EXAMPLES = [
  '화이트 스튜디오 배경, 조명 강조',
  '자연광 야외 라이프스타일 컷',
  '1번·2번 사진을 나란히 합성, 미니멀',
  '그라데이션 배경, 제품 클로즈업',
];

const ThumbnailGenerateSection: React.FC<Props> = ({ frameType, frameId }) => {
  const frameImages = useEditorStore((s) => s.frameImages);
  const setFrameImage = useEditorStore((s) => s.setFrameImage);

  const [direction, setDirection] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // 현재 업로드된 참조 사진 (ref1/ref2/ref3)
  const slotMap = frameImages[frameId] ?? {};
  const refEntries = (['ref1', 'ref2', 'ref3'] as const)
    .map((k) => ({ key: k, url: slotMap[k] ?? null }))
    .filter((e) => e.url !== null) as { key: string; url: string }[];

  const hasRef = refEntries.length > 0;
  const hasMain = !!slotMap['main'];

  const handleGenerate = async () => {
    if (isLoading) return;
    if (!hasRef) {
      setError('참조 사진을 최소 1장 업로드해주세요.');
      return;
    }
    if (!direction.trim()) {
      setError('연출 방향을 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // 참조 사진 base64 변환 (병렬)
      const refImages = await Promise.all(
        refEntries.map(({ url }) => urlToBase64(url)),
      );

      const res = await fetch('/api/ai/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refImages, direction: direction.trim() }),
      });

      const json = (await res.json()) as
        | { success: true; data: { imageBase64: string; mimeType: string } }
        | { success: false; error: string };

      if (!json.success) throw new Error(json.error);

      // 생성 결과를 main 슬롯에 저장
      const dataUrl = `data:${json.data.mimeType};base64,${json.data.imageBase64}`;
      setFrameImage(frameId, 'main', dataUrl);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '생성 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setFrameImage(frameId, 'main', null);
    setError(null);
  };

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 섹션 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#1a1c1c' }}>
          AI 썸네일 생성
        </p>
        {hasMain && (
          <button
            onClick={handleReset}
            title="생성된 이미지 초기화"
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#9ca3af', fontSize: '11px', padding: '2px 4px',
            }}
          >
            <RefreshCw size={11} />
            초기화
          </button>
        )}
      </div>

      {/* 참조 사진 상태 표시 */}
      <div style={{
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: hasRef ? 'rgba(22,163,74,0.06)' : '#f9f9f9',
        border: `1px solid ${hasRef ? 'rgba(22,163,74,0.2)' : '#eeeeee'}`,
        fontSize: '12px',
        color: hasRef ? '#16a34a' : '#9ca3af',
      }}>
        {hasRef
          ? `참조 사진 ${refEntries.length}장 준비됨 (ref${refEntries.map((_, i) => i + 1).join(', ref')})`
          : '위 이미지 섹션에서 참조 사진(ref1~ref3)을 먼저 업로드하세요'}
      </div>

      {/* 연출 방향 입력 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: '#4b5563' }}>
          연출 방향
        </label>
        <textarea
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="예: 스튜디오 조명, 화이트 배경으로 1·2번 사진 합성"
          rows={3}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: '12px',
            color: '#111827',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            resize: 'vertical',
            outline: 'none',
            lineHeight: 1.5,
            boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
        />

        {/* 예시 태그 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {DIRECTION_EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setDirection(ex)}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                border: '1px solid #e5e7eb',
                borderRadius: '20px',
                background: 'none',
                cursor: 'pointer',
                color: '#6b7280',
                lineHeight: 1.4,
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '8px',
          padding: '10px 12px',
          backgroundColor: 'rgba(220,38,38,0.06)',
          border: '1px solid rgba(220,38,38,0.2)',
          borderRadius: '8px',
        }}>
          <span style={{ fontSize: '12px', color: '#dc2626', flex: 1, lineHeight: 1.5 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#dc2626' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* 생성 버튼 */}
      <button
        onClick={handleGenerate}
        disabled={isLoading || !hasRef}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: '11px',
          borderRadius: '8px',
          border: 'none',
          cursor: isLoading || !hasRef ? 'not-allowed' : 'pointer',
          backgroundColor: success ? '#16a34a' : isLoading || !hasRef ? '#e5e7eb' : '#be0014',
          color: isLoading || !hasRef ? '#9ca3af' : '#ffffff',
          fontWeight: 700,
          fontSize: '13px',
          transition: 'all 0.2s',
        }}
      >
        {isLoading ? (
          <>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            생성 중...
          </>
        ) : success ? (
          '생성 완료!'
        ) : (
          <>
            <Wand2 size={15} />
            AI 썸네일 생성
          </>
        )}
      </button>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default ThumbnailGenerateSection;
