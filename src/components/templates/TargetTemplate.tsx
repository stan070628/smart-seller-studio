/**
 * TargetTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const TargetTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const personas = Array.isArray(frame.metadata?.personas)
    ? (frame.metadata.personas as string[]).slice(0, 3)
    : [];

  const displayPersonas = personas.length > 0 ? personas : [
    '품질 좋은 제품을 합리적 가격에 구매하고 싶은 분',
    '매일 사용하는 생활용품에 신중한 선택을 하시는 분',
    '선물로 특별한 감동을 드리고 싶은 분',
  ];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgAccentLight,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      padding: '64px 52px',
    }}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ width: '48px', height: '4px', backgroundColor: theme.accent, borderRadius: '2px', marginBottom: '24px' }} />
        <EditableText value={frame.headline || '이런 분들께 강력 추천드려요'} field="headline"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingDark, fontSize: '36px', fontWeight: '800', lineHeight: '1.3', margin: '0 0 14px 0', letterSpacing: '-0.5px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText value={frame.subheadline} field="subheadline"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedDark, fontSize: '18px', lineHeight: '1.6', margin: 0, display: 'block' }}
          />
        )}
      </div>

      {/* 페르소나 카드 — flex: 1로 공간 채움 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px', margin: '40px 0 28px' }}>
        {displayPersonas.map((persona, i) => (
          <div key={i} style={{
            flex: 1,
            backgroundColor: theme.bgCard, borderRadius: '20px', padding: '28px 32px',
            display: 'flex', alignItems: 'center', gap: '20px',
            boxShadow: `0 4px 20px rgba(0,0,0,0.06)`, border: `1px solid ${theme.border}`,
          }}>
            <div style={{
              width: '48px', height: '48px', backgroundColor: theme.checkBg, flexShrink: 0,
              borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: theme.checkColor, fontSize: '22px', fontWeight: '700',
            }}>✓</div>
            <EditableText value={persona} field={`metadata.personas.${i}`}
              isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{ color: theme.headingDark, fontSize: '19px', fontWeight: '600', margin: 0, lineHeight: '1.5', display: 'block' }}
            />
          </div>
        ))}
      </div>

      {/* 하단 문구 */}
      <div style={{ flexShrink: 0, padding: '22px 28px', backgroundColor: theme.bgCard, borderRadius: '14px', textAlign: 'center', border: `1px solid ${theme.border}` }}>
        <p style={{ color: theme.accentText, fontSize: '16px', fontWeight: '700', margin: 0 }}>
          위 조건 중 하나라도 해당된다면, 바로 이 제품입니다
        </p>
      </div>
    </div>
  );
};
export default TargetTemplate;
