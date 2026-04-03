/**
 * UspTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

interface CompetitorRow { feature: string; ours: string; theirs: string; }

const UspTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const competitors = Array.isArray(frame.metadata?.competitors)
    ? (frame.metadata.competitors as CompetitorRow[]).slice(0, 5)
    : [];

  const rows = competitors.length > 0 ? competitors : [
    { feature: '내구성', ours: '업계 최고 등급', theirs: '일반 수준' },
    { feature: '사용 편의성', ours: '직관적 설계', theirs: '복잡한 조작' },
    { feature: 'A/S 지원', ours: '1년 무상 보증', theirs: '3개월 제한' },
    { feature: '소재 품질', ours: '프리미엄 소재', theirs: '일반 소재' },
  ];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.uspDarkBg,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      padding: '56px 52px',
    }}>
      {/* 헤더 */}
      <div style={{ flexShrink: 0, marginBottom: '40px' }}>
        <div style={{ width: '48px', height: '4px', backgroundColor: theme.accent, borderRadius: '2px', marginBottom: '24px' }} />
        <EditableText
          value={frame.headline || '왜 우리 제품이어야 할까요?'}
          field="headline" isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingLight, fontSize: '34px', fontWeight: '800', lineHeight: '1.3', margin: '0 0 12px 0', letterSpacing: '-0.5px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText
            value={frame.subheadline} field="subheadline" isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedLight, fontSize: '17px', margin: 0, lineHeight: '1.5', display: 'block' }}
          />
        )}
      </div>

      {/* 비교 테이블 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: '16px', overflow: 'hidden' }}>
        {/* 헤더 행 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', flexShrink: 0 }}>
          <div style={{ backgroundColor: theme.uspDarkerBg, padding: '18px 24px', color: theme.mutedLight, fontSize: '13px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
            비교 항목
          </div>
          <div style={{ backgroundColor: theme.accent, padding: '18px 24px', color: '#ffffff', fontSize: '13px', fontWeight: '700', letterSpacing: '0.05em', textAlign: 'center' as const, textTransform: 'uppercase' as const }}>
            우리 제품
          </div>
          <div style={{ backgroundColor: theme.uspDarkerBg, padding: '18px 24px', color: theme.mutedLight, fontSize: '13px', fontWeight: '600', letterSpacing: '0.05em', textAlign: 'center' as const, textTransform: 'uppercase' as const }}>
            타사 제품
          </div>
        </div>

        {/* 데이터 행들 — flex: 1로 공간 균등 분배 */}
        {rows.map((row, i) => (
          <div key={i} style={{
            flex: 1,
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            backgroundColor: i % 2 === 0 ? theme.uspRowEven : theme.uspRowOdd,
            borderTop: `1px solid ${theme.uspDarkerBg}`,
            alignItems: 'center',
          }}>
            <EditableText value={row.feature} field={`metadata.competitors.${i}.feature`}
              isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="span"
              style={{ padding: '0 24px', color: theme.mutedLight, fontSize: '16px', fontWeight: '500', display: 'block' }}
            />
            <EditableText value={`✓ ${row.ours}`} field={`metadata.competitors.${i}.ours`}
              isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="span"
              style={{ padding: '0 24px', color: theme.headingLight, fontSize: '16px', fontWeight: '700', textAlign: 'center' as const, borderLeft: `1px solid ${theme.accent}`, borderRight: `1px solid ${theme.accent}`, display: 'block' }}
            />
            <EditableText value={row.theirs} field={`metadata.competitors.${i}.theirs`}
              isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="span"
              style={{ padding: '0 24px', color: theme.mutedLight, fontSize: '16px', textAlign: 'center' as const, display: 'block' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
export default UspTemplate;
