'use client';

/**
 * PromptSection.tsx
 * 인스펙터 패널 AI 프롬프트 섹션
 * - frame.imagePrompt textarea 표시 (수정 가능)
 * - 클립보드 복사 버튼
 * - imagePrompt 없으면 안내 문구
 */

import React, { useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { GeneratedFrame, FrameType } from '@/types/frames';
import useEditorStore from '@/store/useEditorStore';

interface PromptSectionProps {
  frame: GeneratedFrame;
}

const PromptSection: React.FC<PromptSectionProps> = ({ frame }) => {
  const updateFrame = useEditorStore((s) => s.updateFrame);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateFrame(frame.frameType as FrameType, { imagePrompt: value });
    }, 300);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = '#3f3f46';
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    updateFrame(frame.frameType as FrameType, { imagePrompt: e.target.value });
  };

  const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = '#6366f1';
  };

  const handleCopy = () => {
    if (!frame.imagePrompt) return;
    navigator.clipboard.writeText(frame.imagePrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch((err) => {
      console.error('[PromptSection] 클립보드 복사 오류:', err);
    });
  };

  return (
    <section style={{ borderBottom: '1px solid #3f3f46' }}>
      {/* 섹션 헤더 */}
      <div
        style={{
          padding: '12px 16px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#71717a',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          AI 이미지 프롬프트
        </span>

        {/* 클립보드 복사 버튼 */}
        {frame.imagePrompt && (
          <button
            onClick={handleCopy}
            title="클립보드에 복사"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: copied ? '#4ade80' : '#71717a',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!copied) (e.currentTarget as HTMLButtonElement).style.color = '#e4e4e7';
            }}
            onMouseLeave={(e) => {
              if (!copied) (e.currentTarget as HTMLButtonElement).style.color = '#71717a';
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? '복사됨' : '복사'}
          </button>
        )}
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        {frame.imagePrompt != null ? (
          <textarea
            key={frame.id ?? frame.frameType}
            defaultValue={frame.imagePrompt}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={{
              backgroundColor: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              padding: '8px',
              color: '#e4e4e7',
              width: '100%',
              fontSize: '12px',
              lineHeight: 1.6,
              resize: 'vertical',
              minHeight: '120px',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <p
            style={{
              fontSize: '12px',
              color: '#52525b',
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            AI 프롬프트가 아직 생성되지 않았습니다.
          </p>
        )}
      </div>
    </section>
  );
};

export default PromptSection;
