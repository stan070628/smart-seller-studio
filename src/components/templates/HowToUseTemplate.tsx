/**
 * HowToUseTemplate.tsx - 780×1100 세로형
 * 레퍼런스: stitch_coupang_seller_page (7)/screen.png
 * 변경: 2×2 그리드 → 세로 3스텝 + Pro Tip 박스 레이아웃
 *   - 상단 pill 뱃지 + 큰 헤드라인 + 서브헤드라인
 *   - 3개 스텝 세로 나열 (배경 대형 숫자 + 제목 + 설명 + 이미지 영역)
 *   - 하단 Pro Curator Tip 박스
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

interface Step { step?: number; text?: string; title?: string; description?: string; }

const STEP_SLOT_KEYS = ['step1', 'step2', 'step3'];

const HowToUseTemplate: React.FC<TemplateProps> = ({
  frame, imageUrls, isEditable = false, onFieldChange, onImageAdd, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const rawSteps = Array.isArray(frame.metadata?.steps)
    ? (frame.metadata.steps as (string | Step)[]).slice(0, 3)
    : [];

  // 항상 3스텝으로 고정
  const steps = rawSteps.length > 0
    ? rawSteps.map((s) => {
        if (typeof s === 'string') return { title: s, description: '' };
        return { title: s.text ?? s.title ?? '', description: s.description ?? '' };
      })
    : [
        { title: '초기 설정', description: '제품을 꺼내고 전원을 연결한 뒤 기본 설정을 완료하세요.' },
        { title: '핵심 기능 익히기', description: '주요 기능을 하나씩 익혀보세요. 익숙해지면 더 편리합니다.' },
        { title: '일상 활용', description: '매일 편리하게 사용하며 최상의 결과를 경험하세요.' },
      ];

  // 3개로 맞춤 (부족하면 빈 스텝 추가)
  while (steps.length < 3) {
    steps.push({ title: `Step ${steps.length + 1}`, description: '' });
  }

  // 뱃지 텍스트 — metadata.badgeText 또는 기본값
  const badgeText =
    (frame.metadata?.badgeText as string | undefined) ?? 'PRODUCT MASTERY';

  // Pro Tip — metadata.proTip 또는 기본값
  const proTip =
    (frame.metadata?.proTip as string | undefined) ??
    '처음 사용 시 설명서를 꼭 읽어보세요. 올바른 사용법이 제품 수명을 늘려줍니다.';

  // accent 색상에서 연한 배경 계산 (hex to rgba)
  const accentRgba = (opacity: number) => {
    const hex = theme.accent.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  };

  // 스텝 이미지 영역 높이 (3스텝 균등 배분 기준)
  const IMG_HEIGHT = 88;

  return (
    <div style={{
      width: '780px',
      height: '1100px',
      backgroundColor: theme.bgCard,
      fontFamily: theme.fontFamily,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      padding: '48px 52px 40px',
      boxSizing: 'border-box',
    }}>

      {/* ── 상단 헤더 ── */}
      <div style={{ flexShrink: 0, marginBottom: '28px' }}>

        {/* Pill 뱃지 */}
        <div style={{
          display: 'inline-block',
          backgroundColor: theme.accent,
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: '700',
          letterSpacing: '1.5px',
          padding: '5px 14px',
          borderRadius: '100px',
          marginBottom: '16px',
          textTransform: 'uppercase' as const,
        }}>
          {badgeText}
        </div>

        {/* 헤드라인 */}
        <EditableText
          value={frame.headline || '이렇게 사용하세요'}
          field="headline"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{
            /* 변경 전: 36px / 변경 후: 38px, weight 800 */
            color: theme.headingDark,
            fontSize: '38px',
            fontWeight: '800',
            lineHeight: '1.2',
            margin: '0 0 10px 0',
            letterSpacing: '-0.5px',
            display: 'block',
          }}
        />

        {/* 서브헤드라인 */}
        {frame.subheadline && (
          <EditableText
            value={frame.subheadline}
            field="subheadline"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{
              color: theme.mutedDark,
              fontSize: '15px',
              margin: 0,
              lineHeight: '1.6',
              display: 'block',
            }}
          />
        )}
      </div>

      {/* ── 3개 스텝 세로 나열 ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        marginBottom: '16px',
      }}>
        {steps.map((step, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              position: 'relative',
              overflow: 'hidden',
              backgroundColor: theme.bgSubtle,
              borderRadius: '16px',
              /* 변경 전: border + 개별 padding / 변경 후: border 없이 배경만 */
            }}
          >
            {/* 배경 대형 숫자 (매우 연한 accent) */}
            <div style={{
              position: 'absolute',
              right: '16px',
              bottom: '-14px',
              /* 변경 전: 100px border 색 / 변경 후: 64px accent 8% 투명도 */
              fontSize: '96px',
              fontWeight: '900',
              color: accentRgba(0.10),
              lineHeight: 1,
              userSelect: 'none' as const,
              pointerEvents: 'none' as const,
              letterSpacing: '-4px',
            }}>
              {String(i + 1).padStart(2, '0')}
            </div>

            {/* 이미지/일러스트 영역 (좌측) */}
            <div style={{
              width: '180px',
              flexShrink: 0,
              backgroundColor: theme.bgDark,
              borderRadius: '16px 0 0 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: IMG_HEIGHT,
              overflow: 'hidden',
              position: 'relative',
            }}>
              {imageUrls?.[STEP_SLOT_KEYS[i]] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrls[STEP_SLOT_KEYS[i]]}
                  alt={`Step ${i + 1}`}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                /* 이미지 없으면 스텝 번호 아이콘 */
                <div style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  border: `2px solid ${accentRgba(0.5)}`,
                  backgroundColor: accentRgba(0.15),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.accent,
                  fontSize: '22px',
                  fontWeight: '800',
                }}>
                  {i + 1}
                </div>
              )}
            </div>

            {/* 텍스트 영역 (우측) */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '20px 24px 20px 20px',
              position: 'relative',
              zIndex: 1,
            }}>
              {/* 스텝 레이블 */}
              <div style={{
                fontSize: '11px',
                fontWeight: '700',
                color: theme.accent,
                letterSpacing: '1.2px',
                marginBottom: '6px',
                textTransform: 'uppercase' as const,
              }}>
                STEP {String(i + 1).padStart(2, '0')}
              </div>

              {/* 스텝 제목 */}
              <EditableText
                value={step.title}
                field={`metadata.steps.${i}.title`}
                isEditable={isEditable}
                onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="p"
                style={{
                  /* 변경 전: 20px / 변경 후: 20px 동일, 스타일 정돈 */
                  color: theme.headingDark,
                  fontSize: '20px',
                  fontWeight: '800',
                  margin: '0 0 6px 0',
                  lineHeight: '1.3',
                  display: 'block',
                }}
              />

              {/* 스텝 설명 */}
              {step.description && (
                <EditableText
                  value={step.description}
                  field={`metadata.steps.${i}.description`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="p"
                  style={{
                    color: theme.mutedDark,
                    fontSize: '14px',
                    margin: 0,
                    lineHeight: '1.6',
                    display: 'block',
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── 하단 Pro Curator Tip 박스 ── */}
      <div style={{
        flexShrink: 0,
        backgroundColor: theme.bgSubtle,
        borderRadius: '12px',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        /* 변경 전: 없음 / 변경 후: Pro Tip 박스 신규 추가 */
        borderLeft: `3px solid ${theme.accent}`,
      }}>
        {/* 아이콘 */}
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: accentRgba(0.12),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: '16px',
        }}>
          💡
        </div>

        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: '12px',
            fontWeight: '700',
            color: theme.accent,
            letterSpacing: '0.8px',
            marginBottom: '4px',
            textTransform: 'uppercase' as const,
          }}>
            Pro Curator Tip
          </div>
          <EditableText
            value={proTip}
            field="metadata.proTip"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{
              color: theme.mutedDark,
              fontSize: '13px',
              margin: 0,
              lineHeight: '1.55',
              display: 'block',
            }}
          />
        </div>
      </div>

    </div>
  );
};

export default HowToUseTemplate;
