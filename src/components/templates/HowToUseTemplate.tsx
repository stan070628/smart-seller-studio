/**
 * HowToUseTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

interface Step { step?: number; text?: string; title?: string; description?: string; }

const HowToUseTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const rawSteps = Array.isArray(frame.metadata?.steps)
    ? (frame.metadata.steps as (string | Step)[]).slice(0, 4)
    : [];

  const steps = rawSteps.length > 0
    ? rawSteps.map((s) => {
        if (typeof s === 'string') return { title: s, description: '' };
        return { title: s.text ?? s.title ?? '', description: s.description ?? '' };
      })
    : [
        { title: '포장 개봉', description: '제품을 꺼내고 구성품을 확인하세요.' },
        { title: '간단 조립', description: '설명서 없이도 5분이면 완성됩니다.' },
        { title: '첫 사용', description: '전원을 켜고 기본 설정을 진행하세요.' },
        { title: '일상 활용', description: '매일 편리하게 사용을 즐기세요.' },
      ];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgCard,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      padding: '60px 52px',
    }}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0, marginBottom: '28px' }}>
        <div style={{ width: '48px', height: '4px', backgroundColor: theme.accent, borderRadius: '2px', marginBottom: '24px' }} />
        <EditableText value={frame.headline || '이렇게 사용하세요'} field="headline"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingDark, fontSize: '36px', fontWeight: '800', lineHeight: '1.25', margin: '0 0 12px 0', letterSpacing: '-0.5px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText value={frame.subheadline} field="subheadline"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedDark, fontSize: '17px', margin: 0, lineHeight: '1.6', display: 'block' }}
          />
        )}
      </div>

      {/* 2×2 카드 그리드 — flex: 1, 균등 분배 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '16px', flex: 1 }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '12px',
            padding: '24px 22px',
            backgroundColor: theme.bgSubtle,
            borderRadius: '20px', border: `1px solid ${theme.border}`,
            position: 'relative', overflow: 'hidden',
          }}>
            {/* 배경 번호 */}
            <div style={{
              position: 'absolute', right: '12px', bottom: '-8px',
              fontSize: '100px', fontWeight: '900',
              color: theme.border, lineHeight: 1, userSelect: 'none' as const,
              pointerEvents: 'none',
            }}>
              {String(i + 1).padStart(2, '0')}
            </div>

            {/* 번호 배지 */}
            <div style={{
              width: '44px', height: '44px', backgroundColor: theme.accent,
              borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#ffffff', fontWeight: '800', fontSize: '20px', flexShrink: 0,
              position: 'relative', zIndex: 1,
            }}>
              {i + 1}
            </div>

            <div style={{ position: 'relative', zIndex: 1, flex: 1 }}>
              <EditableText value={step.title} field={`metadata.steps.${i}.title`}
                isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="p"
                style={{ color: theme.headingDark, fontSize: '20px', fontWeight: '800', margin: '0 0 10px 0', lineHeight: '1.3', display: 'block' }}
              />
              {step.description && (
                <EditableText value={step.description} field={`metadata.steps.${i}.description`}
                  isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="p"
                  style={{ color: theme.mutedDark, fontSize: '15px', margin: 0, lineHeight: '1.6', display: 'block' }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
export default HowToUseTemplate;
