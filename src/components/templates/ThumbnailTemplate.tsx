/**
 * ThumbnailTemplate.tsx
 * 780×780 정사각형 AI 썸네일 템플릿
 *
 * 흐름:
 *  1. 사용자가 참조 사진(ref1·ref2·ref3)을 업로드
 *  2. 연출 방향을 입력하고 AI 생성 버튼 클릭
 *  3. 생성된 이미지가 `main` 슬롯에 저장되어 전체 화면을 채움
 */

import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';

const REF_SLOTS = ['ref1', 'ref2', 'ref3'] as const;

const ThumbnailTemplate: React.FC<TemplateProps> = ({
  frame,
  imageUrl,
  imageUrls,
  isEditable = false,
  onImageAdd,
  theme = DEFAULT_THEME,
  imageFit = 'cover',
  imageScale = 1,
  imageOffsetX = 50,
  imageOffsetY = 50,
}) => {
  if (frame.skip) return null;

  // AI 생성 결과: main 슬롯 우선, 없으면 단일 imageUrl 폴백
  const generatedImageUrl = imageUrls?.main ?? imageUrl ?? null;

  // 참조 사진 존재 여부
  const refImages = REF_SLOTS.map((k) => imageUrls?.[k] ?? null);
  const hasAnyRef = refImages.some(Boolean);

  return (
    <div
      style={{
        width: '780px',
        height: '780px',
        fontFamily: theme.fontFamily,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: theme.bgDark,
      }}
    >
      {/* ── AI 생성 이미지 (full-screen) ── */}
      {generatedImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={generatedImageUrl}
          alt="AI 생성 썸네일"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: imageFit,
            transform: `scale(${imageScale})`,
            transformOrigin: `${imageOffsetX}% ${imageOffsetY}%`,
            display: 'block',
          }}
        />
      ) : isEditable ? (
        /* 에디터 모드: 참조 사진 업로드 가이드 */
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
            backgroundColor: '#1a1a1a',
            padding: '40px',
          }}
        >
          <p style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: '13px',
            margin: 0,
            textAlign: 'center',
            lineHeight: 1.6,
          }}>
            오른쪽 패널에서 참조 사진을 업로드하고<br />
            AI 연출 방향을 입력하면 썸네일이 생성됩니다
          </p>

          {/* 참조 사진 미리보기 (업로드된 경우) */}
          {hasAnyRef && (
            <div style={{ display: 'flex', gap: '12px' }}>
              {refImages.map((url, i) =>
                url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt={`참조 ${i + 1}`}
                    style={{
                      width: '160px',
                      height: '160px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      border: '2px solid rgba(255,255,255,0.2)',
                    }}
                  />
                ) : (
                  <div
                    key={i}
                    style={{
                      width: '160px',
                      height: '160px',
                      borderRadius: '8px',
                      border: '2px dashed rgba(255,255,255,0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '24px' }}>
                      {i + 1}
                    </span>
                  </div>
                )
              )}
            </div>
          )}

          {!hasAnyRef && (
            <div style={{ display: 'flex', gap: '12px' }}>
              {REF_SLOTS.map((_, i) => (
                <div
                  key={i}
                  onClick={onImageAdd}
                  style={{
                    width: '160px',
                    height: '160px',
                    borderRadius: '8px',
                    border: '2px dashed rgba(255,255,255,0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    backgroundColor: 'rgba(255,255,255,0.04)',
                  }}
                >
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '28px' }}>+</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>
                    사진 {i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 프리뷰 모드 (이미지 없음) */
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.bgSubtle,
          }}
        >
          <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
        </div>
      )}
    </div>
  );
};

export default ThumbnailTemplate;
