/**
 * CustomGalleryTemplate.tsx
 * 4이미지 갤러리 — 2×2 그리드로 여러 컷 표시
 */

import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const CustomGalleryTemplate: React.FC<TemplateProps> = ({
  frame, imageUrl, isEditable = false, onFieldChange, onImageAdd, theme = DEFAULT_THEME, imageFit = 'cover', imageScale = 1, imageOffsetX = 50, imageOffsetY = 50,
}) => {
  if (frame.skip) return null;

  const captions: string[] = [
    (frame.metadata?.caption1 as string) ?? '',
    (frame.metadata?.caption2 as string) ?? '',
    (frame.metadata?.caption3 as string) ?? '',
    (frame.metadata?.caption4 as string) ?? '',
  ];

  const images: (string | null)[] = [
    (frame.metadata?.image1 as string | undefined) ?? imageUrl,
    (frame.metadata?.image2 as string | undefined) ?? null,
    (frame.metadata?.image3 as string | undefined) ?? null,
    (frame.metadata?.image4 as string | undefined) ?? null,
  ];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgDark,
      fontFamily: theme.fontFamily,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 상단 타이틀 */}
      {(frame.headline || isEditable) && (
        <div style={{ padding: '32px 48px 24px', flexShrink: 0 }}>
          <EditableText
            value={frame.headline || '다양한 연출을 담다'}
            field="headline" isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="h1"
            style={{ color: theme.headingLight, fontSize: '28px', fontWeight: '700', margin: 0, letterSpacing: '-0.3px', display: 'block' }}
          />
        </div>
      )}

      {/* 2×2 이미지 그리드 */}
      <div style={{
        flex: 1,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
        gap: '4px',
        padding: frame.headline ? '0 0 0 0' : '0',
      }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ position: 'relative', overflow: 'hidden' }}>
            {images[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={images[i]!} alt={`갤러리 ${i+1}`} style={{ width: '100%', height: '100%', objectFit: imageFit, transform: i === 0 ? `scale(${imageScale})` : undefined, transformOrigin: i === 0 ? `${imageOffsetX}% ${imageOffsetY}%` : undefined, display: 'block' }} />
            ) : (
              <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
            )}
            {/* 캡션 오버레이 */}
            {(captions[i] || isEditable) && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
                padding: '32px 16px 12px',
              }}>
                <EditableText
                  value={captions[i] || '캡션 입력'}
                  field={`metadata.caption${i + 1}`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="p"
                  style={{ color: '#ffffff', fontSize: '13px', fontWeight: '500', margin: 0, display: 'block' }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomGalleryTemplate;
