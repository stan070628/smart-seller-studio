'use client';

/**
 * AIGenerateSection.tsx
 * 인스펙터 패널 — AI 이미지 생성 섹션
 *
 * - "AI 이미지 생성" 버튼 (Wand2 아이콘)
 * - generateFrameImage(frameType) 액션 호출
 * - 로딩 중: 버튼 disabled + Loader2 스피너
 * - 성공: 1.5초 초록 테두리/배경 flash
 * - 에러: 빨간 배경 박스 + X 버튼으로 닫기
 * - imagePrompt 없으면 안내 메시지 + 버튼 disabled
 */

import { useState } from 'react';
import { Wand2, Loader2, X } from 'lucide-react';
import type { FrameType } from '@/types/frames';
import useEditorStore from '@/store/useEditorStore';

interface AIGenerateSectionProps {
  frameType: FrameType;
  imagePrompt?: string;
}

const AIGenerateSection: React.FC<AIGenerateSectionProps> = ({ frameType, imagePrompt }) => {
  const [aiGenError, setAiGenError] = useState<string | null>(null);
  const [aiGenSuccess, setAiGenSuccess] = useState(false);

  const generatingImageForFrame = useEditorStore((s) => s.generatingImageForFrame);
  const generateFrameImage = useEditorStore((s) => s.generateFrameImage);

  // 현재 이 프레임이 생성 중인지 여부
  const isGeneratingThisFrame = generatingImageForFrame === frameType;
  // 다른 프레임 생성 중 (동시 생성 1개 제한)
  const isAnotherFrameGenerating = generatingImageForFrame !== null && !isGeneratingThisFrame;

  const hasPrompt = !!imagePrompt;

  const handleGenerate = async () => {
    if (!hasPrompt || isGeneratingThisFrame || isAnotherFrameGenerating) return;
    setAiGenError(null);
    try {
      await generateFrameImage(frameType);
      // 성공 피드백: 1.5초간 초록 flash
      setAiGenSuccess(true);
      setTimeout(() => setAiGenSuccess(false), 1500);
    } catch (err) {
      console.error('[AIGenerateSection] AI 이미지 생성 오류:', err);
      setAiGenError(err instanceof Error ? err.message : '이미지 생성에 실패했습니다.');
    }
  };

  const isDisabled = !hasPrompt || isGeneratingThisFrame || isAnotherFrameGenerating;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* 섹션 라벨 */}
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          color: '#818cf8',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        AI 이미지 생성
      </span>

      {/* imagePrompt 없을 때 안내 메시지 */}
      {!hasPrompt && (
        <p
          style={{
            margin: 0,
            padding: '10px 12px',
            backgroundColor: '#27272a',
            border: '1px solid #3f3f46',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#71717a',
            lineHeight: '1.5',
          }}
        >
          먼저 AI 프롬프트를 생성해주세요.
          <br />
          상세페이지 전체 생성 후 사용 가능합니다.
        </p>
      )}

      {/* 에러 메시지 */}
      {aiGenError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '10px 12px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '8px',
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: '12px',
              color: '#fca5a5',
              lineHeight: '1.5',
              wordBreak: 'break-word',
            }}
          >
            {aiGenError}
          </span>
          <button
            onClick={() => setAiGenError(null)}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#f87171',
              padding: '1px',
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* AI 이미지 생성 버튼 */}
      <button
        onClick={handleGenerate}
        disabled={isDisabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '7px',
          width: '100%',
          padding: '10px 16px',
          borderRadius: '8px',
          border: aiGenSuccess
            ? '1px solid #34d399'
            : isDisabled
              ? '1px solid #3f3f46'
              : '1px solid #6366f1',
          backgroundColor: aiGenSuccess
            ? 'rgba(52, 211, 153, 0.12)'
            : isDisabled
              ? 'rgba(63, 63, 70, 0.3)'
              : 'rgba(99, 102, 241, 0.15)',
          color: aiGenSuccess
            ? '#34d399'
            : isDisabled
              ? '#52525b'
              : '#818cf8',
          fontSize: '13px',
          fontWeight: 600,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {isGeneratingThisFrame ? (
          <>
            <Loader2
              size={14}
              style={{
                animation: 'spin 1s linear infinite',
              }}
            />
            생성 중...
          </>
        ) : (
          <>
            <Wand2 size={14} />
            AI 이미지 생성
          </>
        )}
      </button>

      {/* 다른 프레임 생성 중일 때 안내 */}
      {isAnotherFrameGenerating && (
        <p
          style={{
            margin: 0,
            fontSize: '11px',
            color: '#71717a',
            textAlign: 'center',
          }}
        >
          다른 프레임 이미지 생성 중... 잠시 기다려주세요.
        </p>
      )}

      {/* CSS 애니메이션 (spin) */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default AIGenerateSection;
