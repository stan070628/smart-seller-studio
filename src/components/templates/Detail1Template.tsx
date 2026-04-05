/**
 * Detail1Template.tsx - 780×1100 세로형
 * 재디자인: 레퍼런스 기반 (pill 뱃지 + 제품 이미지 + 기능 카드 3개 + 인용문)
 * 구조: 헤더(pill+헤드라인) → 제품 이미지 → 기능 카드 3개 → 인용문
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

  // 기능 카드 데이터: metadata.bulletPoints 배열 사용, 없으면 기본값
  const bulletPoints = Array.isArray(frame.metadata?.bulletPoints)
    ? (frame.metadata.bulletPoints as string[]).slice(0, 3)
    : [];

  const displayPoints = bulletPoints.length > 0 ? bulletPoints
    : ['고급 소재 사용으로 오래 사용 가능', '경량화 설계로 편리한 휴대', '환경 인증 소재 적용'];

  // 아이콘: metadata.icons 동적 사용, fallback 기본값
  const icons = Array.isArray((frame.metadata as Record<string, unknown>)?.icons)
    ? ((frame.metadata as Record<string, unknown>).icons as string[]).slice(0, 3)
    : ['💧', '🌊', '🌿'];

  // 인용문: metadata.quote 또는 기본값
  const quote = (frame.metadata as Record<string, unknown>)?.quote as string | undefined
    || '이 제품을 사용한 후 확실히 달라진 것을 느낄 수 있었습니다. 강력 추천합니다.';

  const reviewer = (frame.metadata as Record<string, unknown>)?.reviewer as string | undefined
    || '실제 구매 고객 · ★★★★★ 인증 리뷰';

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgPage,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* ── 상단 헤더: pill 뱃지 + 헤드라인 + 서브헤드라인 ── */}
      <div style={{
        padding: '36px 48px 24px',
        flexShrink: 0,
      }}>
        {/* pill 뱃지 — 변경 전: 없음 / 변경 후: accent 배경 pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center',
          backgroundColor: theme.accent,
          color: '#ffffff',
          fontSize: '11px', fontWeight: '700', letterSpacing: '1.2px',
          padding: '5px 14px',
          borderRadius: '100px',
          marginBottom: '16px',
          textTransform: 'uppercase' as const,
        }}>
          01 CORE FEATURE
        </div>

        {/* 헤드라인 — 변경 전: 32px / 변경 후: 40px, 좌정렬 */}
        <EditableText
          value={frame.headline || '뛰어난 기능과 소재'}
          field="headline"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h2"
          style={{
            color: theme.headingDark,
            fontSize: '40px', fontWeight: '800', lineHeight: '1.25',
            margin: '0 0 12px 0', letterSpacing: '-0.8px',
            display: 'block',
          }}
        />

        {/* 서브헤드라인 — 변경 전: 조건부 렌더 / 변경 후: 항상 표시 */}
        <EditableText
          value={frame.subheadline || '핵심 기능을 한눈에 확인하세요'}
          field="subheadline"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="p"
          style={{
            color: theme.mutedDark,
            fontSize: '15px', lineHeight: '1.7',
            margin: '0',
            display: 'block',
          }}
        />
      </div>

      {/* ── 제품 이미지 — 변경 전: 상단 45% 전체 / 변경 후: 둥근 모서리, 어두운 배경 래퍼 ── */}
      <div style={{
        flexShrink: 0,
        padding: '0 48px',
        height: '270px',
      }}>
        <div style={{
          width: '100%', height: '100%',
          borderRadius: '16px',
          overflow: 'hidden',
          backgroundColor: theme.bgDark,
          position: 'relative',
        }}>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="상품 이미지"
              style={{
                width: '100%', height: '100%',
                objectFit: imageFit,
                transform: `scale(${imageScale})`,
                transformOrigin: `${imageOffsetX}% ${imageOffsetY}%`,
                display: 'block',
              }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', padding: '16px' }}>
              <ImagePlaceholder onImageAdd={onImageAdd} theme={theme} />
            </div>
          )}
        </div>
      </div>

      {/* ── 기능 카드 3개 — 변경 전: 체크리스트 / 변경 후: 아이콘+제목+설명 카드 ── */}
      <div style={{
        flex: 1,
        padding: '20px 48px',
        display: 'flex', flexDirection: 'column', gap: '10px',
        justifyContent: 'center',
      }}>
        {displayPoints.map((point, i) => {
          // 카드당 제목과 설명 분리: "제목|설명" 형식이면 분리, 아니면 그대로 제목으로 사용
          const parts = point.split('|');
          const cardTitle = parts[0]?.trim() || point;
          const cardDesc = parts[1]?.trim() || '';

          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '16px',
              backgroundColor: theme.bgSubtle,
              borderRadius: '12px',
              padding: '16px 20px',
            }}>
              {/* 아이콘 */}
              <div style={{
                width: '40px', height: '40px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '22px',
                backgroundColor: theme.bgCard,
                borderRadius: '10px',
              }}>
                {icons[i] || '✦'}
              </div>

              {/* 제목 + 설명 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <EditableText
                  value={cardTitle}
                  field={`metadata.bulletPoints.${i}`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="span"
                  style={{
                    color: theme.headingDark,
                    fontSize: '24px', fontWeight: '700', lineHeight: '1.4',
                    display: 'block', marginBottom: cardDesc ? '4px' : '0',
                  }}
                />
                {cardDesc && (
                  <span style={{
                    color: theme.mutedDark,
                    fontSize: '17px', lineHeight: '1.6',
                    display: 'block',
                  }}>
                    {cardDesc}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 하단 인용문 — 변경 전: 없음 / 변경 후: 이탤릭 인용문 + 리뷰어 ── */}
      <div style={{
        flexShrink: 0,
        padding: '12px 48px 36px',
        borderTop: `1px solid ${theme.border}`,
        marginTop: '4px',
      }}>
        {/* 큰 따옴표 */}
        <div style={{
          fontSize: '36px', lineHeight: '1', color: theme.accent,
          marginBottom: '8px', fontFamily: 'Georgia, serif',
        }}>
          &ldquo;
        </div>

        {/* 인용문 */}
        <EditableText
          value={quote}
          field="metadata.quote"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="p"
          style={{
            color: theme.bodyDark,
            fontSize: '15px', fontStyle: 'italic', lineHeight: '1.7',
            margin: '0 0 10px 0', display: 'block',
          }}
        />

        {/* 리뷰어 */}
        <EditableText
          value={reviewer}
          field="metadata.reviewer"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="span"
          style={{
            color: theme.mutedDark,
            fontSize: '12px', fontWeight: '600', letterSpacing: '0.3px',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
};

export default Detail1Template;
