/**
 * CtaTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const CtaTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const rawDiscount = typeof frame.metadata?.discount === 'string' ? frame.metadata.discount : null;
  // 배송 관련 문구 전체 제거 후 구분자 정리
  const discount = rawDiscount
    ? rawDiscount
        .replace(/(무료\s*배송|당일\s*출고|당일\s*배송|빠른\s*배송|익일\s*출고)/gi, '')
        .replace(/[\s\+·&]+$|^[\s\+·&]+/g, '')
        .replace(/[\s\+·&]{2,}/g, ' ')
        .trim() || null
    : null;
  const urgency = typeof frame.metadata?.urgency === 'string' ? frame.metadata.urgency : null;

  return (
    <div style={{
      width: '780px', height: '1100px',
      background: theme.ctaGradient,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '80px 64px', textAlign: 'center', position: 'relative',
    }}>
      {/* 배경 장식 */}
      <div style={{ position: 'absolute', top: '-150px', right: '-150px', width: '500px', height: '500px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.05)' }} />
      <div style={{ position: 'absolute', bottom: '-100px', left: '-100px', width: '400px', height: '400px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.05)' }} />

      {(discount || urgency) && (
        <div style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: '100px', padding: '12px 28px', marginBottom: '40px', border: '1px solid rgba(255,255,255,0.25)' }}>
          <span style={{ color: '#fde68a', fontSize: '16px', fontWeight: '600' }}>
            {discount ? `${discount} 할인` : ''}{discount && urgency ? ' · ' : ''}{urgency ?? ''}
          </span>
        </div>
      )}

      <EditableText value={frame.headline || '지금 바로 경험하세요'} field="headline"
        isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
        tag="h1"
        style={{ color: '#ffffff', fontSize: '52px', fontWeight: '900', lineHeight: '1.2', margin: '0 0 24px 0', letterSpacing: '-1px', textShadow: '0 2px 20px rgba(0,0,0,0.2)', display: 'block' }}
      />

      {frame.subheadline && (
        <EditableText value={frame.subheadline} field="subheadline"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="p"
          style={{ color: 'rgba(255,255,255,0.88)', fontSize: '22px', lineHeight: '1.6', margin: '0 0 20px 0', display: 'block' }}
        />
      )}

      {frame.bodyText && (
        <EditableText value={frame.bodyText} field="bodyText"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="p"
          style={{ color: 'rgba(255,255,255,0.72)', fontSize: '18px', lineHeight: '1.7', margin: '0 0 56px 0', display: 'block' }}
        />
      )}

      {!frame.subheadline && !frame.bodyText && <div style={{ marginBottom: '56px' }} />}

      <div style={{ backgroundColor: theme.ctaBtnBg, borderRadius: '20px', padding: '24px 64px', cursor: 'pointer', boxShadow: '0 12px 40px rgba(0,0,0,0.3)', marginBottom: '28px' }}>
        <EditableText value={frame.ctaText || '지금 구매하기'} field="ctaText"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="span"
          style={{ color: theme.ctaBtnText, fontSize: '24px', fontWeight: '900', letterSpacing: '-0.3px', display: 'block' }}
        />
      </div>

      <p style={{ color: theme.ctaSubTextColor, fontSize: '15px', margin: 0 }}>지금 바로 특별한 경험을 시작하세요</p>
    </div>
  );
};
export default CtaTemplate;
