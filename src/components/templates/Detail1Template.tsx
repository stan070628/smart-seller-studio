/**
 * Detail1Template.tsx - 780×1100 세로형
 * 구조: 이미지(위 45%) + 텍스트+불릿(아래 55%)
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const Detail1Template: React.FC<TemplateProps> = ({
  frame, imageUrl, isEditable = false, onFieldChange, onImageAdd, theme = DEFAULT_THEME, imageFit = 'cover', imageScale = 1, imageOffsetX = 50, imageOffsetY = 50,
}) => {
  if (frame.skip) return null;

  const bulletPoints = Array.isArray(frame.metadata?.bulletPoints)
    ? (frame.metadata.bulletPoints as string[]).slice(0, 4)
    : [];

  const displayPoints = bulletPoints.length > 0 ? bulletPoints
    : ['고급 소재 사용으로 오래 사용 가능', '경량화 설계로 편리한 휴대', '환경 인증 소재 적용'];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgPage,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* 이미지 — 상단 45% */}
      <div style={{ height: '45%', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="상품 이미지"
            style={{ width: '100%', height: '100%', objectFit: imageFit, transform: `scale(${imageScale})`, transformOrigin: `${imageOffsetX}% ${imageOffsetY}%`, display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', padding: '20px' }}>
            <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
          </div>
        )}
        {imageUrl && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px',
            background: `linear-gradient(to bottom, transparent, ${theme.bgPage})`,
            pointerEvents: 'none',
          }} />
        )}
      </div>

      {/* 텍스트 — 하단 55% */}
      <div style={{
        flex: 1, padding: '36px 52px 52px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <div style={{ width: '44px', height: '4px', backgroundColor: theme.accent, borderRadius: '2px', marginBottom: '20px' }} />
        <EditableText value={frame.headline || '뛰어난 기능과 소재'} field="headline"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h2"
          style={{ color: theme.headingDark, fontSize: '32px', fontWeight: '800', lineHeight: '1.3', margin: '0 0 14px 0', letterSpacing: '-0.5px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText value={frame.subheadline} field="subheadline"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedDark, fontSize: '17px', lineHeight: '1.7', margin: '0 0 28px 0', display: 'block' }}
          />
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {displayPoints.map((point, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              <div style={{
                width: '26px', height: '26px', backgroundColor: theme.checkBg,
                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, marginTop: '2px', color: theme.checkColor, fontSize: '13px', fontWeight: '700',
              }}>✓</div>
              <EditableText value={point} field={`metadata.bulletPoints.${i}`}
                isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="span"
                style={{ color: theme.bodyDark, fontSize: '17px', lineHeight: '1.6', fontWeight: '500', display: 'block' }}
              />
            </li>
          ))}
        </ul>

        {frame.bodyText && (
          <EditableText value={frame.bodyText} field="bodyText"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedDark, fontSize: '14px', lineHeight: '1.7', padding: '18px', backgroundColor: theme.bgSubtle, borderRadius: '10px', margin: '24px 0 0 0', display: 'block' }}
          />
        )}
      </div>
    </div>
  );
};
export default Detail1Template;
