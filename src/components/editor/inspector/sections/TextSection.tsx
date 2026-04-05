'use client';

/**
 * TextSection.tsx
 * 인스펙터 패널 텍스트 편집 섹션
 * - headline, subheadline, bodyText, ctaText → 라벨 + 입력 필드
 * - metadata 객체 → 동적 폼 (문자열: input, 배열: textarea 줄바꿈 구분)
 * - 값 변경 시 store의 updateFrame 호출 (debounce 300ms)
 */

import React, { useCallback, useRef } from 'react';
import type { GeneratedFrame, FrameType } from '@/types/frames';
import useEditorStore from '@/store/useEditorStore';

// 이미지 프롬프트와 연관된 텍스트 필드 (변경 시 outdated 플래그 설정)
const PROMPT_RELATED_FIELDS = new Set<keyof GeneratedFrame>([
  'headline',
  'subheadline',
  'bodyText',
]);

// ---------------------------------------------------------------------------
// 공통 스타일
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#a1a1aa',
  marginBottom: '4px',
  display: 'block',
};

const inputStyle: React.CSSProperties = {
  backgroundColor: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: '8px',
  padding: '8px',
  color: '#e4e4e7',
  width: '100%',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: '72px',
  lineHeight: 1.5,
  fontFamily: 'inherit',
};

const fieldWrapStyle: React.CSSProperties = {
  marginBottom: '12px',
};

// ---------------------------------------------------------------------------
// 서브 컴포넌트: 단일 필드 (input 또는 textarea)
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
}

const Field: React.FC<FieldProps> = ({ label, value, multiline = false, onCommit }) => {
  // 로컬 draft 상태 대신 ref 기반 debounce 패턴 사용
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onCommit(next);
    }, 300);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = '#6366f1';
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = '#3f3f46';
    // blur 시 즉시 커밋 (debounce 취소 후)
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onCommit(e.target.value);
  };

  return (
    <div style={fieldWrapStyle}>
      <label style={labelStyle}>{label}</label>
      {multiline ? (
        <textarea
          defaultValue={value}
          style={textareaStyle}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      ) : (
        <input
          type="text"
          defaultValue={value}
          style={inputStyle}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 메인 컴포넌트
// ---------------------------------------------------------------------------

interface TextSectionProps {
  frame: GeneratedFrame;
}

const TextSection: React.FC<TextSectionProps> = ({ frame }) => {
  const updateFrame = useEditorStore((s) => s.updateFrame);
  const addPromptOutdated = useEditorStore((s) => s.addPromptOutdated);

  // 최상위 필드 업데이트
  const handleTopField = useCallback(
    (field: keyof Pick<GeneratedFrame, 'headline' | 'subheadline' | 'bodyText' | 'ctaText'>) =>
      (value: string) => {
        updateFrame(frame.frameType as FrameType, { [field]: value || null } as Partial<GeneratedFrame>);
        // imagePrompt와 연관된 필드가 변경되면 outdated 플래그 설정
        if (PROMPT_RELATED_FIELDS.has(field) && frame.imagePrompt != null) {
          addPromptOutdated(frame.frameType as FrameType);
        }
      },
    [frame.frameType, frame.imagePrompt, updateFrame, addPromptOutdated],
  );

  // metadata 문자열 키 업데이트
  const handleMetaString = useCallback(
    (key: string) => (value: string) => {
      updateFrame(frame.frameType as FrameType, {
        metadata: { ...frame.metadata, [key]: value },
      });
    },
    [frame.frameType, frame.metadata, updateFrame],
  );

  // metadata 배열 키 업데이트 (textarea 줄바꿈 → 배열)
  const handleMetaArray = useCallback(
    (key: string) => (value: string) => {
      const arr = value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      updateFrame(frame.frameType as FrameType, {
        metadata: { ...frame.metadata, [key]: arr },
      });
    },
    [frame.frameType, frame.metadata, updateFrame],
  );

  // metadata 항목을 렌더링하기 위한 타입 분류
  const renderMetadataFields = () => {
    const entries = Object.entries(frame.metadata ?? {});
    if (entries.length === 0) return null;

    return entries.map(([key, val]) => {
      // 배열인 경우: 줄바꿈 구분 textarea
      if (Array.isArray(val)) {
        // 배열의 원소가 객체이면 JSON 표현 (편집 불가 안내)
        if (val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
          return (
            <div key={key} style={fieldWrapStyle}>
              <label style={labelStyle}>{key}</label>
              <textarea
                defaultValue={val
                  .map((item) =>
                    typeof item === 'object'
                      ? Object.values(item as Record<string, unknown>).join(' / ')
                      : String(item),
                  )
                  .join('\n')}
                style={{ ...textareaStyle, color: '#71717a' }}
                readOnly
              />
            </div>
          );
        }
        // 문자열 배열
        return (
          <Field
            key={key}
            label={key}
            value={(val as string[]).join('\n')}
            multiline
            onCommit={handleMetaArray(key)}
          />
        );
      }

      // 문자열 또는 숫자
      if (typeof val === 'string' || typeof val === 'number') {
        const strVal = String(val);
        // 긴 문자열은 textarea
        const isLong = strVal.length > 60 || strVal.includes('\n');
        return (
          <Field
            key={key}
            label={key}
            value={strVal}
            multiline={isLong}
            onCommit={handleMetaString(key)}
          />
        );
      }

      // 그 외 타입은 표시 생략
      return null;
    });
  };

  return (
    <section style={{ borderBottom: '1px solid #3f3f46' }}>
      {/* 섹션 헤더 */}
      <div
        style={{
          padding: '12px 16px 8px',
          fontSize: '11px',
          fontWeight: 700,
          color: '#71717a',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        텍스트
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        {/* headline: 항상 표시 */}
        <Field
          label="헤드라인"
          value={frame.headline ?? ''}
          onCommit={handleTopField('headline')}
        />

        {/* subheadline: 값이 있을 때만 */}
        {frame.subheadline != null && (
          <Field
            label="서브 헤드라인"
            value={frame.subheadline}
            onCommit={handleTopField('subheadline')}
          />
        )}

        {/* bodyText: 값이 있을 때만 */}
        {frame.bodyText != null && (
          <Field
            label="본문"
            value={frame.bodyText}
            multiline
            onCommit={handleTopField('bodyText')}
          />
        )}

        {/* ctaText: 값이 있을 때만 */}
        {frame.ctaText != null && (
          <Field
            label="CTA 버튼"
            value={frame.ctaText}
            onCommit={handleTopField('ctaText')}
          />
        )}

        {/* metadata 동적 필드 */}
        {renderMetadataFields()}
      </div>
    </section>
  );
};

export default TextSection;
