/**
 * SpecTemplate.tsx - 780×1100 세로형
 * 구조: 헤드라인 + 이미지(풀너비) + 스펙 테이블(flex: 1)
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

interface SpecRow { label: string; value: string; }

const SpecTemplate: React.FC<TemplateProps> = ({
  frame, imageUrl, isEditable = false, onFieldChange, onImageAdd, theme = DEFAULT_THEME, imageFit = 'cover', imageScale = 1, imageOffsetX = 50, imageOffsetY = 50,
}) => {
  if (frame.skip) return null;

  const specs = Array.isArray(frame.metadata?.specs)
    ? (frame.metadata.specs as SpecRow[]).slice(0, 8)
    : [];

  const defaultSpecs: SpecRow[] = [
    { label: '크기', value: '측정 후 기재' },
    { label: '무게', value: '측정 후 기재' },
    { label: '소재', value: '주요 소재 기재' },
    { label: '색상', value: '제공 색상 목록' },
    { label: '인증', value: '관련 인증 내역' },
    { label: '원산지', value: '생산국' },
  ];

  const displaySpecs = specs.length > 0 ? specs : defaultSpecs;

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgCard,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* 헤더 */}
      <div style={{ padding: '52px 52px 32px', flexShrink: 0 }}>
        <div style={{ width: '48px', height: '4px', backgroundColor: theme.accent, borderRadius: '2px', marginBottom: '20px' }} />
        <EditableText value={frame.headline || '상세 스펙 정보'} field="headline"
          isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingDark, fontSize: '34px', fontWeight: '800', lineHeight: '1.3', margin: '0 0 10px 0', letterSpacing: '-0.5px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText value={frame.subheadline} field="subheadline"
            isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedDark, fontSize: '16px', margin: 0, display: 'block' }}
          />
        )}
      </div>

      {/* 이미지 — 풀너비 */}
      <div style={{ height: '260px', flexShrink: 0, position: 'relative', overflow: 'hidden', margin: '0 52px', borderRadius: '16px' }}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="상품 이미지" style={{ width: '100%', height: '100%', objectFit: imageFit, transform: `scale(${imageScale})`, transformOrigin: `${imageOffsetX}% ${imageOffsetY}%` }} />
        ) : (
          <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
        )}
      </div>

      {/* 스펙 테이블 — flex: 1 */}
      <div style={{ flex: 1, padding: '24px 52px 40px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, borderRadius: '16px', overflow: 'hidden', border: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column' }}>
          {displaySpecs.map((spec, i) => (
            <div key={i} style={{
              flex: 1,
              display: 'grid', gridTemplateColumns: '160px 1fr',
              borderBottom: i < displaySpecs.length - 1 ? `1px solid ${theme.border}` : 'none',
              alignItems: 'center',
            }}>
              <EditableText value={spec.label} field={`metadata.specs.${i}.label`}
                isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="span"
                style={{ backgroundColor: theme.bgSubtle, padding: '0 20px', color: theme.mutedDark, fontSize: '14px', fontWeight: '600', letterSpacing: '0.02em', borderRight: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', height: '100%' }}
              />
              <EditableText value={spec.value} field={`metadata.specs.${i}.value`}
                isEditable={isEditable} onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="span"
                style={{ padding: '0 20px', color: theme.headingDark, fontSize: '15px', fontWeight: '500', display: 'flex', alignItems: 'center', height: '100%' }}
              />
            </div>
          ))}
        </div>
        <p style={{ color: theme.mutedDark, fontSize: '12px', margin: '12px 0 0 4px', lineHeight: '1.5' }}>
          * 상기 스펙은 실제와 다소 차이가 있을 수 있습니다.
        </p>
      </div>
    </div>
  );
};
export default SpecTemplate;
