'use client';

/**
 * StepIndicator.tsx
 * 3단계 워크플로우 진행 표시 컴포넌트
 */

import React from 'react';
import { C } from '@/lib/design-tokens';

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3;
  onStepClick?: (step: 1 | 2 | 3) => void;
}

const STEPS: { step: 1 | 2 | 3; label: string; sublabel: string }[] = [
  { step: 1, label: '소스 선택', sublabel: '이미지 업로드 / 도매꾹' },
  { step: 2, label: 'AI 처리', sublabel: '상세페이지 자동 생성' },
  { step: 3, label: '확인 및 등록', sublabel: '미리보기 + 상품 등록' },
];

export default function StepIndicator({ currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '16px 24px',
        marginBottom: '24px',
      }}
    >
      {STEPS.map(({ step, label, sublabel }, index) => {
        const isDone = currentStep > step;
        const isCurrent = currentStep === step;
        const isFuture = currentStep < step;

        return (
          <React.Fragment key={step}>
            {/* 연결선 */}
            {index > 0 && (
              <div
                style={{
                  flex: 1,
                  height: '2px',
                  backgroundColor: isDone || isCurrent ? C.accent : C.border,
                  margin: '0 16px',
                  transition: 'background-color 0.3s',
                }}
              />
            )}

            {/* 단계 항목 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexShrink: 0,
                cursor: isDone && onStepClick ? 'pointer' : 'default',
                opacity: isFuture ? 0.45 : 1,
              }}
              onClick={() => {
                if (isDone && onStepClick) onStepClick(step);
              }}
            >
              {/* 원형 번호 */}
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: isDone ? '#15803d' : isCurrent ? C.accent : C.border,
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background-color 0.3s',
                  border: isCurrent ? `2px solid ${C.accent}` : isDone ? '2px solid #15803d' : `2px solid ${C.border}`,
                }}
              >
                {isDone ? '✓' : step}
              </div>

              {/* 레이블 */}
              <div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: isCurrent ? 700 : isDone ? 600 : 500,
                    color: isCurrent ? C.text : isDone ? '#15803d' : C.textSub,
                    transition: 'color 0.3s',
                    lineHeight: 1.3,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: C.textSub,
                    lineHeight: 1.3,
                    marginTop: '1px',
                  }}
                >
                  {sublabel}
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
