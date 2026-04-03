/**
 * PainPointTemplate.tsx
 * 불편함 공감 프레임 — 780×1100 세로형 레이아웃
 *
 * 구조:
 *  ┌─────────────────────┐
 *  │  헤더 (어두운 배너)  │ ~180px
 *  ├─────────────────────┤
 *  │  상품 이미지 (풀너비)│ ~320px
 *  ├─────────────────────┤
 *  │  카드 1             │
 *  │  카드 2             │  flex: 1 (균등 분배)
 *  │  카드 3             │
 *  └─────────────────────┘
 */

import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const PainPointTemplate: React.FC<TemplateProps> = ({
  frame, imageUrl, isEditable = false, onFieldChange, onImageAdd, theme = DEFAULT_THEME, imageFit = 'cover', imageScale = 1, imageOffsetX = 50, imageOffsetY = 50,
}) => {
  if (frame.skip) return null;

  const painPoints = Array.isArray(frame.metadata?.painPoints)
    ? (frame.metadata.painPoints as string[]).slice(0, 3)
    : [];

  const displayPoints = painPoints.length > 0 ? painPoints : [
    '기존 제품들은 내구성이 부족해 금방 망가집니다',
    '사용법이 복잡해 매번 설명서를 찾아봐야 합니다',
    '가격 대비 품질이 기대에 미치지 못합니다',
  ];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgPage,
      fontFamily: theme.fontFamily,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* ── 1. 헤더 ── */}
      <div style={{
        backgroundColor: theme.bgDark,
        padding: '44px 52px 36px',
        position: 'relative',
        flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: '24px', left: '52px',
          width: '40px', height: '4px',
          backgroundColor: theme.crossColor, borderRadius: '2px',
        }} />
        <EditableText
          value={frame.headline || '이런 불편함, 혹시 겪고 계신가요?'}
          field="headline"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{
            color: theme.headingLight, fontSize: '30px', fontWeight: '700',
            lineHeight: '1.4', margin: 0, letterSpacing: '-0.3px', display: 'block',
          }}
        />
        {frame.subheadline && (
          <EditableText
            value={frame.subheadline} field="subheadline"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{
              color: theme.mutedLight, fontSize: '16px',
              marginTop: '10px', marginBottom: 0, lineHeight: '1.6', display: 'block',
            }}
          />
        )}
      </div>

      {/* ── 2. 이미지 (풀너비) ── */}
      <div style={{ height: '300px', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
        {imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl} alt="상품 이미지"
              style={{ width: '100%', height: '100%', objectFit: imageFit, transform: `scale(${imageScale})`, transformOrigin: `${imageOffsetX}% ${imageOffsetY}%`, display: 'block' }}
            />
            {/* 하단 페이드 */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px',
              background: `linear-gradient(to bottom, transparent, ${theme.bgPage})`,
              pointerEvents: 'none',
            }} />
          </>
        ) : (
          <div style={{ width: '100%', height: '100%', padding: '16px' }}>
            <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
          </div>
        )}
      </div>

      {/* ── 3. 페인포인트 카드 목록 (나머지 공간 균등 분배) ── */}
      <div style={{
        flex: 1,
        display: 'flex', flexDirection: 'column',
        gap: '0',
        padding: '20px 40px 32px',
      }}>
        {displayPoints.map((point, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: theme.bgCard,
              borderRadius: '14px',
              padding: '20px 24px',
              display: 'flex', alignItems: 'center', gap: '16px',
              boxShadow: `0 2px 12px rgba(0,0,0,0.06)`,
              border: `1px solid ${theme.border}`,
              marginBottom: i < displayPoints.length - 1 ? '12px' : '0',
            }}
          >
            <div style={{
              width: '36px', height: '36px', flexShrink: 0,
              backgroundColor: theme.crossBg,
              borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: theme.crossColor, fontSize: '18px',
            }}>✗</div>
            <EditableText
              value={point}
              field={`metadata.painPoints.${i}`}
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{
                color: theme.bodyDark, fontSize: '17px', lineHeight: '1.55',
                margin: 0, fontWeight: '500', display: 'block',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PainPointTemplate;
