/**
 * PainPointTemplate.tsx
 * 불편함 공감 프레임 — 780×1100 세로형 레이아웃
 *
 * 레퍼런스 기반 리디자인 (2026-04-04):
 *  ┌─────────────────────────────────────────┐
 *  │  상단: 배경이미지 + 다크 오버레이        │ ~500px
 *  │    "THE PAIN POINT" 뱃지                │
 *  │    큰 흰색 헤드라인                      │
 *  │    연회색 서브텍스트                     │
 *  ├─────────────────────────────────────────┤
 *  │  하단: 밝은 배경 (#F2F2F2)              │ ~600px
 *  │  ┌────────────┐  ┌────────────┐        │
 *  │  │ 메인카드    │  │ 작은카드1  │        │
 *  │  │ (아이콘     │  ├────────────┤        │
 *  │  │  제목+설명  │  │ 작은카드2  │        │
 *  │  │  +이미지)  │  └────────────┘        │
 *  │  └────────────┘                        │
 *  └─────────────────────────────────────────┘
 */

import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const PainPointTemplate: React.FC<TemplateProps> = ({
  frame, imageUrl, imageUrls, imageSlotSettings, isEditable = false, onFieldChange, onImageAdd, theme = DEFAULT_THEME, imageFit = 'cover', imageScale = 1, imageOffsetX = 50, imageOffsetY = 50,
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

  // imageUrls 슬롯에서 배경/카드 이미지 가져오기 (metadata fallback 제거)
  const bgImage = imageUrls?.background ?? imageUrl;
  const cardImage = imageUrls?.card ?? null;

  // 카드 슬롯 설정 (fit, scale, offset)
  const cardFit = imageSlotSettings?.card?.fit ?? 'cover';
  const cardScale = imageSlotSettings?.card?.scale ?? 1;
  const cardOffsetX = imageSlotSettings?.card?.x ?? 50;
  const cardOffsetY = imageSlotSettings?.card?.y ?? 50;

  // 카드별 아이콘 — metadata.icons 우선, 없으면 폴백 사용
  const FALLBACK_ICONS = ['🌧', '🛡', '⚖'];
  const metaIcons = Array.isArray(frame.metadata?.icons)
    ? (frame.metadata.icons as string[])
    : [];
  const cardIcons = FALLBACK_ICONS.map((fallback, i) => metaIcons[i] || fallback);

  return (
    <div style={{
      width: '780px', height: '1100px',
      // 변경 전: backgroundColor: theme.bgPage (단색)
      // 변경 후: 상단 어두운 이미지 영역 + 하단 밝은 카드 영역으로 분리
      backgroundColor: '#F2F2F2',
      fontFamily: theme.fontFamily,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* ── 1. 상단 이미지 + 오버레이 + 텍스트 영역 ── */}
      <div style={{
        // 변경 전: 분리된 헤더(~180px) + 이미지 영역(300px)
        // 변경 후: 통합 상단 영역 500px — 이미지 위에 텍스트 오버레이
        height: '500px',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* 배경 이미지 (image1 또는 기본 imageUrl) */}
        {bgImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgImage} alt="배경 이미지"
            style={{
              width: '100%', height: '100%',
              objectFit: imageFit,
              transform: `scale(${imageScale})`,
              transformOrigin: `${imageOffsetX}% ${imageOffsetY}%`,
              display: 'block',
            }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            backgroundColor: theme.bgDark,
          }}>
            <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
          </div>
        )}

        {/* 다크 오버레이 — 레퍼런스: 상단은 투명, 하단으로 갈수록 어두워지는 그라데이션 */}
        <div style={{
          position: 'absolute', inset: 0,
          // 변경 전: 없음
          // 변경 후: 어두운 스크림 + 하단 페이드
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.6) 60%, rgba(0,0,0,0.75) 100%)',
          pointerEvents: 'none',
        }} />

        {/* 텍스트 콘텐츠 — 하단 정렬 */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '0 52px 48px',
        }}>
          {/* "THE PAIN POINT" 뱃지 */}
          {/* 변경 전: 왼쪽 상단 짧은 accent 바(40px × 4px) */}
          {/* 변경 후: pill 형태 뱃지 (레퍼런스의 빨간 타원 뱃지) */}
          <div style={{
            display: 'inline-block',
            backgroundColor: theme.accent,
            borderRadius: '100px',
            padding: '7px 18px',
            marginBottom: '20px',
          }}>
            <span style={{
              color: '#FFFFFF',
              fontSize: '12px',
              fontWeight: '700',
              letterSpacing: '0.1em',
            }}>THE PAIN POINT</span>
          </div>

          {/* 헤드라인 */}
          <EditableText
            value={frame.headline || '이런 불편함, 혹시 겪고 계신가요?'}
            field="headline"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="h1"
            style={{
              // 변경 전: color: theme.headingLight, fontSize: '30px'
              // 변경 후: 순수 흰색, 더 큰 사이즈(42px), 더 굵게
              color: '#FFFFFF',
              fontSize: '42px',
              fontWeight: '800',
              lineHeight: '1.25',
              margin: '0 0 14px 0',
              letterSpacing: '-0.5px',
              display: 'block',
              textShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          />

          {/* 서브헤드라인 */}
          {frame.subheadline && (
            <EditableText
              value={frame.subheadline} field="subheadline"
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{
                // 변경 전: color: theme.mutedLight, fontSize: '16px'
                // 변경 후: 연한 회색(#CCCCCC), 텍스트 센터 정렬
                color: '#CCCCCC',
                fontSize: '16px',
                fontWeight: '400',
                marginTop: 0,
                marginBottom: 0,
                lineHeight: '1.7',
                display: 'block',
                textAlign: 'center',
              }}
            />
          )}
        </div>
      </div>

      {/* ── 2. 하단 카드 영역 ── */}
      {/* 변경 전: alignItems: 'flex-start', 고정 padding만, 높이 미지정 → 하단 공백 발생 */}
      {/* 변경 후: flex: 1로 나머지 600px 전체 차지, alignItems: 'stretch'로 좌우 카드 동일 높이 */}
      <div style={{
        flex: 1,
        padding: '24px 28px 28px',
        display: 'flex',
        flexDirection: 'row',
        gap: '14px',
        alignItems: 'stretch',
      }}>

        {/* 메인 카드 (왼쪽, 크게) — stretch로 오른쪽 컬럼과 동일 높이 */}
        <div style={{
          width: '52%',
          flexShrink: 0,
          backgroundColor: '#FFFFFF',
          borderRadius: '20px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {/* 아이콘 뱃지 */}
          <div style={{
            width: '36px', height: '36px',
            backgroundColor: theme.bgAccentLight,
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px',
            marginBottom: '8px',
            flexShrink: 0,
          }}>
            {cardIcons[0]}
          </div>

          {/* 제목 */}
          <EditableText
            value={displayPoints[0]}
            field="metadata.painPoints.0"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{
              color: '#1A1A1A',
              fontSize: '19px',
              fontWeight: '700',
              lineHeight: '1.4',
              margin: '0 0 6px 0',
              display: 'block',
            }}
          />

          {/* 설명 텍스트 */}
          <EditableText
            value={displayPoints[1] || '기상 예보에도 없는 소나기, 아끼는 고가의 아우터가 손상되고 하루 종일 눅눅한 기분으로 보내야만 했습니다.'}
            field="metadata.painPoints.1"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{
              color: '#888888',
              fontSize: '15px',
              lineHeight: '1.5',
              margin: 0,
              display: 'block',
            }}
          />

          {/* 카드 하단 이미지 섹션 — 변경 전: height: '80px' 고정 */}
          {/* 변경 후: flex: 1 + minHeight로 남은 공간을 모두 채워 하단 공백 제거 */}
          <div style={{
            marginTop: '10px',
            flex: 1,
            minHeight: '80px',
            borderRadius: '10px',
            overflow: 'hidden',
            flexShrink: 0,
            backgroundColor: theme.bgSubtle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {cardImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cardImage}
                alt="상품 이미지"
                style={{
                  width: '100%', height: '100%',
                  objectFit: cardFit,
                  transform: `scale(${cardScale})`,
                  transformOrigin: `${cardOffsetX}% ${cardOffsetY}%`,
                  filter: 'brightness(0.85)',
                }}
              />
            ) : (
              <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} width="100%" height="100%" />
            )}
          </div>
        </div>

        {/* 오른쪽: 작은 카드 2개 세로 배치 — 변경 후: 컬럼 자체가 stretch로 전체 높이 차지 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}>
          {/* 작은 카드 1 — 변경 전: 콘텐츠 높이만큼만 렌더링 */}
          {/* 변경 후: flex: 1로 컬럼 절반씩 차지 */}
          <div style={{
            flex: 1,
            backgroundColor: '#FFFFFF',
            borderRadius: '20px',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
          }}>
            <div style={{
              width: '38px', height: '38px',
              // 변경 전: backgroundColor: theme.crossBg (핑크 계열)
              // 변경 후: theme.bgAccentLight (USP 톤 통일)
              backgroundColor: theme.bgAccentLight,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '17px',
              marginBottom: '12px',
              flexShrink: 0,
            }}>
              {cardIcons[1]}
            </div>
            <EditableText
              value={displayPoints[1] || '사용법이 복잡해 매번 설명서를 찾아봐야 합니다'}
              field="metadata.painPoints.1"
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{
                color: '#1A1A1A',
                fontSize: '18px',
                fontWeight: '700',
                lineHeight: '1.45',
                margin: '0 0 8px 0',
                display: 'block',
              }}
            />
            <EditableText
              value={frame.metadata?.cardDesc1 as string || '두꺼운 레인코트는 무겁고 일상복으로 활용하기엔 부담스러웠습니다.'}
              field="metadata.cardDesc1"
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{
                color: '#AAAAAA',
                fontSize: '16px',
                lineHeight: '1.55',
                margin: 0,
                display: 'block',
              }}
            />
          </div>

          {/* 작은 카드 2 — 변경 후: flex: 1로 컬럼 절반씩 차지 */}
          <div style={{
            flex: 1,
            backgroundColor: '#FFFFFF',
            borderRadius: '20px',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
          }}>
            <div style={{
              width: '38px', height: '38px',
              // 변경 전: backgroundColor: theme.crossBg (핑크 계열)
              // 변경 후: theme.bgAccentLight (USP 톤 통일)
              backgroundColor: theme.bgAccentLight,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '17px',
              marginBottom: '12px',
              flexShrink: 0,
            }}>
              {cardIcons[2]}
            </div>
            <EditableText
              value={displayPoints[2] || '가격 대비 품질이 기대에 미치지 못합니다'}
              field="metadata.painPoints.2"
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{
                color: '#1A1A1A',
                fontSize: '18px',
                fontWeight: '700',
                lineHeight: '1.45',
                margin: '0 0 8px 0',
                display: 'block',
              }}
            />
            <EditableText
              value={frame.metadata?.cardDesc2 as string || '트렌디한 실루엣과 고성능 소재를 동시에 갖춘 선택지는 없었습니다.'}
              field="metadata.cardDesc2"
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{
                color: '#AAAAAA',
                fontSize: '16px',
                lineHeight: '1.55',
                margin: '0 0 auto 0',
                display: 'block',
              }}
            />

            {/* 레퍼런스: 하단 "RE-IMAGINE THE SOLUTION" 링크 텍스트 */}
            <div style={{
              marginTop: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{
                color: theme.accent,
                fontSize: '12px',
                fontWeight: '700',
                letterSpacing: '0.08em',
              }}>RE-IMAGINE THE SOLUTION</span>
              <span style={{ color: theme.accent, fontSize: '14px' }}>→</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PainPointTemplate;
