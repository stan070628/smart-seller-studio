/**
 * Custom3ColTemplate.tsx
 * 3컬럼 제품 비교 레이아웃 — 여러 제품 또는 라인업 소개
 */

import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const Custom3ColTemplate: React.FC<TemplateProps> = ({
  frame, imageUrl, imageUrls, imageSlotSettings, isEditable = false, onFieldChange, onImageAdd, theme = DEFAULT_THEME, imageFit = 'cover', imageScale = 1, imageOffsetX = 50, imageOffsetY = 50,
}) => {
  if (frame.skip) return null;

  // 3개 컬럼 데이터
  interface ColData { title: string; tag: string; name: string; hashtags: string; }
  const cols: ColData[] = [
    (frame.metadata?.col1 as ColData) ?? { title: '1번 라인', tag: '특징', name: '제품명 1', hashtags: '#태그1 #태그2' },
    (frame.metadata?.col2 as ColData) ?? { title: '2번 라인', tag: '특징', name: '제품명 2', hashtags: '#태그1 #태그2' },
    (frame.metadata?.col3 as ColData) ?? { title: '3번 라인', tag: '특징', name: '제품명 3', hashtags: '#태그1 #태그2' },
  ];

  // imageUrls 슬롯에서 컬럼별 이미지 가져오기
  const colImages: (string | null)[] = [
    imageUrls?.col1 ?? imageUrl,
    imageUrls?.col2 ?? null,
    imageUrls?.col3 ?? null,
  ];

  // 슬롯 키 배열 (imageSlotSettings 조회용)
  const slotKeys = ['col1', 'col2', 'col3'] as const;

  // 컬럼별 배경색
  const colBgs = [theme.bgSubtle, theme.bgCard, theme.bgAccentLight];

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgCard,
      fontFamily: theme.fontFamily,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 상단 헤더 */}
      <div style={{ padding: '40px 60px 28px', textAlign: 'center', borderBottom: `1px solid ${theme.border}` }}>
        <EditableText
          value={frame.subheadline || '피부타입과 고민에 따라 골라쓰는'}
          field="subheadline" isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="p"
          style={{ color: theme.mutedDark, fontSize: '16px', fontWeight: '500', margin: '0 0 8px 0', display: 'block' }}
        />
        <EditableText
          value={frame.headline || '제품 라인업 소개'}
          field="headline" isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{ color: theme.headingDark, fontSize: '32px', fontWeight: '800', margin: 0, letterSpacing: '-0.5px', display: 'block' }}
        />
      </div>

      {/* 3컬럼 본문 */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0' }}>
        {cols.map((col, i) => (
          <div key={i} style={{
            backgroundColor: colBgs[i],
            borderRight: i < 2 ? `1px solid ${theme.border}` : 'none',
            display: 'flex', flexDirection: 'column',
            padding: '20px 20px 24px',
            alignItems: 'center',
          }}>
            {/* 컬럼 타이틀 */}
            <div style={{
              width: '100%', textAlign: 'center',
              padding: '10px 0', marginBottom: '12px',
              borderBottom: `1px dashed ${theme.border}`,
            }}>
              <EditableText
                value={col.title}
                field={`metadata.col${i + 1}.title`}
                isEditable={isEditable}
                onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="p"
                style={{ color: theme.headingDark, fontSize: '18px', fontWeight: '700', margin: 0, display: 'block' }}
              />
            </div>

            {/* 이미지 영역 */}
            <div style={{ width: '100%', flex: 1, borderRadius: '12px', overflow: 'hidden', marginBottom: '12px', minHeight: '180px' }}>
              {colImages[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={colImages[i]!}
                  alt={`제품 ${i + 1}`}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: imageSlotSettings?.[slotKeys[i]]?.fit ?? imageFit,
                    transform: `scale(${imageSlotSettings?.[slotKeys[i]]?.scale ?? (i === 0 ? imageScale : 1)})`,
                    transformOrigin: `${imageSlotSettings?.[slotKeys[i]]?.x ?? (i === 0 ? imageOffsetX : 50)}% ${imageSlotSettings?.[slotKeys[i]]?.y ?? (i === 0 ? imageOffsetY : 50)}%`,
                  }}
                />
              ) : (
                <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
              )}
            </div>

            {/* 태그 pill */}
            <div style={{
              backgroundColor: theme.accent, borderRadius: '100px', padding: '4px 14px', marginBottom: '10px',
            }}>
              <EditableText
                value={col.tag}
                field={`metadata.col${i + 1}.tag`}
                isEditable={isEditable}
                onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="span"
                style={{ color: '#ffffff', fontSize: '12px', fontWeight: '700', display: 'block' }}
              />
            </div>

            {/* 제품명 */}
            <EditableText
              value={col.name}
              field={`metadata.col${i + 1}.name`}
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{ color: theme.headingDark, fontSize: '15px', fontWeight: '700', textAlign: 'center', margin: '0 0 8px 0', lineHeight: '1.4', display: 'block' }}
            />

            {/* 해시태그 */}
            <EditableText
              value={col.hashtags}
              field={`metadata.col${i + 1}.hashtags`}
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{ color: theme.mutedDark, fontSize: '13px', textAlign: 'center', margin: 0, display: 'block' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default Custom3ColTemplate;
