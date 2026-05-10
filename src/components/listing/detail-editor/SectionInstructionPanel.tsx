'use client';
import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import type { SectionType } from '@/types/detail-page';

interface SectionInstructionPanelProps {
  sectionType: SectionType;
  initialInstruction?: string;
  isLoading?: boolean;
  onSubmit: (instruction: string) => void;
}

// 섹션 타입별 추천 칩셋
const INSTRUCTION_CHIPS: Partial<Record<SectionType, string[]>> = {
  hero: ['더 강렬하게', '감성적인 톤으로', '간결하게'],
  selling_points: ['포인트 추가', '가성비 강조', '3개로 줄이기'],
  features: ['더 자세하게', '간결하게'],
  stats: ['더 임팩트있게', '숫자 추가'],
  cta: ['더 설득력있게', '선물용으로'],
};
const DEFAULT_CHIPS = ['다시 생성', '더 간결하게', '더 자세하게'];

export default function SectionInstructionPanel({
  sectionType,
  initialInstruction = '',
  isLoading = false,
  onSubmit,
}: SectionInstructionPanelProps) {
  const [value, setValue] = useState(initialInstruction);

  const chips = INSTRUCTION_CHIPS[sectionType] ?? DEFAULT_CHIPS;

  // 칩 클릭 시 입력창에 텍스트 설정
  const handleChipClick = (chip: string) => {
    setValue(chip);
  };

  // 전송 처리
  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed);
    setValue('');
  };

  // Enter 키 전송 (Shift+Enter는 줄바꿈)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      style={{
        padding: '12px 14px',
        borderTop: `1px solid ${C.border}`,
        background: '#fafafa',
      }}
    >
      {/* 추천 칩 목록 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {chips.map((chip) => (
          <button
            key={chip}
            onClick={() => handleChipClick(chip)}
            disabled={isLoading}
            style={{
              padding: '3px 10px',
              fontSize: 12,
              borderRadius: 20,
              border: `1px solid ${C.border}`,
              background: value === chip ? C.accent : '#ffffff',
              color: value === chip ? '#ffffff' : C.text,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              transition: 'background 0.15s, color 0.15s',
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* 입력창 + 전송 버튼 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="AI에게 수정 지시를 입력하세요..."
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            padding: '8px 10px',
            fontSize: 13,
            lineHeight: 1.5,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            background: '#ffffff',
            color: C.text,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none',
            opacity: isLoading ? 0.5 : 1,
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading || !value.trim()}
          style={{
            width: 36,
            height: 36,
            borderRadius: 6,
            border: 'none',
            background: isLoading || !value.trim() ? '#dddddd' : C.accent,
            color: '#ffffff',
            cursor: isLoading || !value.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
          aria-label="전송"
        >
          {isLoading ? (
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>

      {/* Loader2 spin 키프레임 — 전역 스타일 없이 인라인으로 처리 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
