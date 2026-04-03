/**
 * BeforeAfterTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const BeforeAfterTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const beforeText = typeof frame.metadata?.before === 'string'
    ? frame.metadata.before : '기존 제품 사용 시 불편함과 낮은 만족도를 경험했습니다.';
  const afterText = typeof frame.metadata?.after === 'string'
    ? frame.metadata.after : '사용 후 생활이 확연히 달라졌다고 고객들이 말합니다.';

  const panelStyle = (isBefore: boolean): React.CSSProperties => ({
    flex: 1,
    backgroundColor: isBefore ? theme.bgPage : theme.afterBg,
    padding: '52px 44px',
    display: 'flex', flexDirection: 'column',
    justifyContent: 'space-evenly',
    position: 'relative',
  });

  return (
    <div style={{
      width: '780px', height: '1100px',
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* 헤더 */}
      <div style={{ backgroundColor: theme.bgDark, padding: '48px 56px 40px', textAlign: 'center', flexShrink: 0 }}>
        <div style={{ width: '48px', height: '4px', backgroundColor: theme.accent, borderRadius: '2px', margin: '0 auto 20px' }} />
        <EditableText value={frame.headline || '사용 전후의 차이를 직접 확인하세요'}
          field="headline" isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingLight, fontSize: '32px', fontWeight: '800', margin: 0, letterSpacing: '-0.3px', display: 'block' }}
        />
      </div>

      {/* BEFORE / AFTER 패널 */}
      <div style={{ flex: 1, display: 'flex' }}>
        {/* BEFORE */}
        <div style={panelStyle(true)}>
          <div style={{
            alignSelf: 'flex-start',
            backgroundColor: theme.border, borderRadius: '8px', padding: '8px 18px',
          }}>
            <span style={{ color: theme.mutedDark, fontSize: '13px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>BEFORE</span>
          </div>

          <div style={{
            width: '64px', height: '64px', backgroundColor: theme.crossBg,
            borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px',
          }}>✗</div>

          <EditableText value={beforeText} field="metadata.before"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.bodyDark, fontSize: '22px', fontWeight: '600', lineHeight: '1.6', margin: 0, display: 'block' }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {['낮은 만족도', '잦은 불편', '비효율적'].map((tag, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: theme.mutedDark, fontSize: '16px' }}>
                <span style={{ color: theme.crossColor, fontSize: '18px' }}>✗</span> {tag}
              </span>
            ))}
          </div>
        </div>

        {/* 중앙 구분선 */}
        <div style={{
          width: '4px', backgroundColor: theme.bgDark,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: '40px', height: '40px', backgroundColor: theme.bgDark,
            borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#ffffff', fontSize: '18px', fontWeight: '700',
          }}>→</div>
        </div>

        {/* AFTER */}
        <div style={panelStyle(false)}>
          <div style={{
            alignSelf: 'flex-end',
            backgroundColor: theme.afterLabelBg, borderRadius: '8px', padding: '8px 18px',
          }}>
            <span style={{ color: theme.afterText, fontSize: '13px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>AFTER</span>
          </div>

          <div style={{
            width: '64px', height: '64px', backgroundColor: 'rgba(255,255,255,0.2)',
            borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px', color: theme.afterText,
          }}>✓</div>

          <EditableText value={afterText} field="metadata.after"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.afterText, fontSize: '22px', fontWeight: '600', lineHeight: '1.6', margin: 0, display: 'block' }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {['높은 만족도', '편리한 사용', '효율 극대화'].map((tag, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: theme.afterMuted, fontSize: '16px' }}>
                <span>✓</span> {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
export default BeforeAfterTemplate;
