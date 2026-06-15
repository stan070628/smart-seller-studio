'use client';

import React, { useState } from 'react';
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
}

export default function DetailMakerThumbnailPanel({
  refImageUrls,
  isGenerating,
  error,
  onGenerate,
}: Props) {
  const [direction, setDirection] = useState('');
  const hasRef = refImageUrls.length > 0;
  const canGenerate = hasRef && direction.trim().length >= 5 && !isGenerating;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
      {/* 섹션 제목 */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>AI 썸네일 생성</div>

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
        {hasRef ? `참조 사진 ${Math.min(refImageUrls.length, 3)}장 사용` : '참고 이미지를 먼저 업로드하세요'}
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
