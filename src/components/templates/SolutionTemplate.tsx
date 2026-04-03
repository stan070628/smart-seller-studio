/**
 * SolutionTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const SolutionTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  interface SolutionItem { problem?: string; answer?: string }
  const rawSolutions = Array.isArray(frame.metadata?.solutions)
    ? (frame.metadata.solutions as (string | SolutionItem)[]).slice(0, 4)
    : [];
  const solutions = rawSolutions.length > 0
    ? rawSolutions.map((s) =>
        typeof s === 'string'
          ? { problem: s, answer: '' }
          : { problem: s.problem ?? '', answer: s.answer ?? '' }
      )
    : [
        { problem: '기존 제품의 한계', answer: '업계 최고 수준의 내구성으로 해결' },
        { problem: '복잡한 사용법', answer: '직관적인 디자인으로 즉시 사용 가능' },
        { problem: '가격 부담', answer: '합리적인 가격으로 최고의 품질 경험' },
        { problem: '불충분한 지원', answer: '전문 고객센터 24시간 지원' },
      ];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgPage,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      padding: '60px 52px',
    }}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0, marginBottom: '28px' }}>
        <div style={{ width: '48px', height: '5px', backgroundColor: theme.accent, borderRadius: '3px', marginBottom: '24px' }} />
        <EditableText
          value={frame.headline || '이제 이 제품으로 해결하세요'}
          field="headline" isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.accent, fontSize: '36px', fontWeight: '800', lineHeight: '1.3', margin: '0 0 14px 0', letterSpacing: '-0.5px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText
            value={frame.subheadline} field="subheadline" isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedDark, fontSize: '18px', lineHeight: '1.6', margin: 0, display: 'block' }}
          />
        )}
      </div>

      {/* 솔루션 카드 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '16px', flex: 1 }}>
        {solutions.map((solution, i) => (
          <div key={i} style={{
            backgroundColor: theme.bgAccentLight,
            borderRadius: '20px', padding: '24px 22px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '12px',
            border: `1px solid ${theme.border}`,
          }}>
            <div style={{
              width: '42px', height: '42px', backgroundColor: theme.accent,
              borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#ffffff', fontWeight: '800', fontSize: '16px',
            }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            {solution.problem && (
              <EditableText
                value={`문제: ${solution.problem}`}
                field={`metadata.solutions.${i}.problem`} isEditable={isEditable}
                onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="p"
                style={{ color: theme.mutedDark, fontSize: '13px', margin: 0, fontWeight: '500', display: 'block' }}
              />
            )}
            <EditableText
              value={solution.answer || solution.problem}
              field={`metadata.solutions.${i}.answer`} isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{ color: theme.headingDark, fontSize: '17px', lineHeight: '1.6', margin: 0, fontWeight: '700', display: 'block' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
export default SolutionTemplate;
