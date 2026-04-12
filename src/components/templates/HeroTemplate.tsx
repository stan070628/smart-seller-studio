/**
 * HeroTemplate.tsx - 780×1100 세로형
 */
import React from 'react';
import type { GeneratedFrame } from '@/types/frames';
import type { Theme } from '@/lib/themes';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

export interface TemplateProps {
  frame: GeneratedFrame;
  /** 단일 슬롯용 (하위 호환 유지, main 슬롯에 해당) */
  imageUrl: string | null;
  isEditable?: boolean;
  onFieldChange?: (field: string, value: unknown) => void;
  onImageAdd?: () => void;
  theme?: Theme;
  /** 단일 슬롯용 fit (하위 호환 유지, main 슬롯에 해당) */
  imageFit?: 'cover' | 'contain';
  /** 단일 슬롯용 스케일 (하위 호환 유지, main 슬롯에 해당) */
  imageScale?: number;
  /** 0-100, 기본 50 (center) — 하위 호환 유지 */
  imageOffsetX?: number;
  /** 0-100, 기본 50 (center) — 하위 호환 유지 */
  imageOffsetY?: number;
  /** 다중 슬롯 이미지 맵 (슬롯키 → URL) */
  imageUrls?: Record<string, string>;
  /** 슬롯별 이미지 설정 (fit, scale, offset) */
  imageSlotSettings?: Record<string, { fit?: 'cover' | 'contain'; scale?: number; x?: number; y?: number }>;
}

export const ImagePlaceholder: React.FC<{ onImageAdd?: () => void; width?: string; height?: string; theme?: Theme }> = ({
  onImageAdd, width = '100%', height = '100%', theme = DEFAULT_THEME,
}) => (
  <div
    onClick={onImageAdd}
    style={{
      width, height,
      border: `2px dashed ${theme.border}`,
      borderRadius: '12px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px', cursor: 'pointer', backgroundColor: theme.bgSubtle,
    }}
  >
    <span style={{ fontSize: '32px', color: theme.accent, opacity: 0.5 }}>+</span>
    <span style={{ fontSize: '13px', color: theme.mutedDark }}>사진 추가</span>
  </div>
);

const HeroTemplate: React.FC<TemplateProps> = ({
  frame, imageUrl, isEditable = false, onFieldChange, onImageAdd, theme = DEFAULT_THEME, imageFit = 'cover', imageScale = 1, imageOffsetX = 50, imageOffsetY = 50,
}) => {
  if (frame.skip) return null;

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgDark,
      fontFamily: theme.fontFamily,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* 상단 60%: 이미지 */}
      <div style={{ height: '60%', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="상품 이미지"
            style={{ width: '100%', height: '100%', objectFit: imageFit, transform: `scale(${imageScale})`, transformOrigin: `${imageOffsetX}% ${imageOffsetY}%`, display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', backgroundColor: theme.uspDarkerBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
          </div>
        )}
        {/* 카테고리 배지 */}
        <div style={{
          position: 'absolute', top: '32px', left: '48px',
          backgroundColor: theme.accent, borderRadius: '100px', padding: '9px 22px',
        }}>
          <span style={{ color: '#ffffff', fontSize: '13px', fontWeight: '700', letterSpacing: '0.08em' }}>
            PREMIUM PRODUCT
          </span>
        </div>
      </div>

      {/* 하단 40%: 텍스트 */}
      <div style={{
        flex: 1, padding: '36px 52px 52px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <div style={{ width: '52px', height: '5px', backgroundColor: theme.accent, borderRadius: '3px', marginBottom: '24px' }} />
        <EditableText
          value={frame.headline || '강력한 첫인상으로 시작하세요'}
          field="headline" isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingLight, fontSize: '42px', fontWeight: '900', lineHeight: '1.2', margin: '0 0 20px 0', letterSpacing: '-1px', display: 'block' }}
        />
        {frame.subheadline && (
          <EditableText
            value={frame.subheadline} field="subheadline" isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{ color: theme.mutedLight, fontSize: '20px', fontWeight: '400', lineHeight: '1.6', margin: 0, display: 'block' }}
          />
        )}
      </div>
    </div>
  );
};

export default HeroTemplate;
