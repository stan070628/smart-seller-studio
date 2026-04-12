/**
 * Detail2Template.tsx - 780×1100 세로형
 * 재디자인: 레퍼런스 기반 (2컬럼 상단 + 인용문 배너 + 2컬럼 하단)
 * 구조:
 *   A) 상단 2컬럼 (~400px): 왼쪽(헤드라인+설명+미니카드2개) / 오른쪽(TECHNICAL SPECS 스펙카드)
 *   B) 인용문 배너 (~180px): 어두운 배경 + 흰색 이탤릭 인용문
 *   C) 하단 2컬럼 (~300px): 왼쪽 제품 이미지 / 오른쪽 제목+상세 설명
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { ImagePlaceholder } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

const Detail2Template: React.FC<TemplateProps> = ({
  frame, imageUrl, isEditable = false, onFieldChange, onImageAdd,
  theme = DEFAULT_THEME, imageFit = 'cover', imageScale = 1,
  imageOffsetX = 50, imageOffsetY = 50,
}) => {
  if (frame.skip) return null;

  // 스펙 항목: metadata.specs 우선, bulletPoints fallback (최대 4개)
  const specRaw = (frame.metadata as Record<string, unknown>)?.specs;
  const specItems: { label: string; value: string }[] = Array.isArray(specRaw)
    ? (specRaw as { label: string; value: string }[]).slice(0, 4)
    : [];

  const bulletPoints = Array.isArray(frame.metadata?.bulletPoints)
    ? (frame.metadata.bulletPoints as string[])
    : [];

  // specs가 없으면 bulletPoints에서 "라벨|값" 형식으로 파싱
  const displaySpecs: { label: string; value: string }[] =
    specItems.length > 0
      ? specItems
      : bulletPoints.length > 0
        ? bulletPoints.slice(0, 4).map((p) => {
            const parts = p.split('|');
            return { label: parts[0]?.trim() || p, value: parts[1]?.trim() || '' };
          })
        : [
            { label: '소재', value: '프리미엄 알루미늄 합금' },
            { label: '무게', value: '125g (경량 설계)' },
            { label: '배터리', value: '72시간 연속 재생' },
            { label: '방수', value: 'IPX5 생활 방수' },
          ];

  // 미니 카드 2개: metadata.miniCards 우선, 없으면 빈 카드
  const miniCardsRaw = (frame.metadata as Record<string, unknown>)?.miniCards;
  const miniCards: { icon: string; title: string; desc: string }[] = Array.isArray(miniCardsRaw)
    ? (miniCardsRaw as { icon: string; title: string; desc: string }[]).slice(0, 2)
    : [
        { icon: '✦', title: '', desc: '' },
        { icon: '✦', title: '', desc: '' },
      ];

  // 동적 아이콘: metadata.icons 배열 우선
  const icons = Array.isArray((frame.metadata as Record<string, unknown>)?.icons)
    ? ((frame.metadata as Record<string, unknown>).icons as string[])
    : [];
  if (icons.length > 0) {
    miniCards[0] = { ...miniCards[0], icon: icons[0] || miniCards[0].icon };
    if (miniCards[1]) miniCards[1] = { ...miniCards[1], icon: icons[1] || miniCards[1].icon };
  }

  // 인용문
  const quote =
    ((frame.metadata as Record<string, unknown>)?.quote as string | undefined) ||
    '세부 하나하나에 담긴 장인 정신이 제품 전체의 완성도를 만들어냅니다.';

  // 하단 오른쪽 상세 설명
  const detailTitle =
    ((frame.metadata as Record<string, unknown>)?.detailTitle as string | undefined) ||
    frame.subheadline ||
    'The Detail is the Product';

  const detailDesc =
    frame.bodyText ||
    '수백 번의 테스트와 정밀한 설계를 거쳐 완성된 제품입니다. 눈에 보이지 않는 곳까지 타협 없이 만들었습니다.';

  return (
    <div style={{
      width: '780px', height: '1100px',
      backgroundColor: theme.bgPage,
      fontFamily: theme.fontFamily,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>

      {/* ══════════════════════════════════════════════════════
          A) 상단 2컬럼 — ~400px
          왼쪽: 헤드라인 + 설명 + 미니카드2개
          오른쪽: TECHNICAL SPECS 카드
      ══════════════════════════════════════════════════════ */}
      <div style={{
        height: '400px', flexShrink: 0,
        display: 'flex', flexDirection: 'row',
        padding: '36px 36px 20px',
        gap: '20px',
      }}>

        {/* 왼쪽 컬럼 */}
        <div style={{
          flex: '1 1 0',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}>
          {/* 상단: 헤드라인 + 설명 */}
          <div>
            {/* pill 뱃지 — 변경 전: 없음 / 변경 후: accent 배경 pill */}
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              backgroundColor: theme.accent,
              color: '#ffffff',
              fontSize: '10px', fontWeight: '700', letterSpacing: '1.4px',
              padding: '4px 12px', borderRadius: '100px',
              marginBottom: '14px',
              textTransform: 'uppercase' as const,
            }}>
              02 DETAIL FEATURE
            </div>

            {/* 헤드라인 — 변경 전: 32px 단일 컬럼 / 변경 후: 32px 좌측 2컬럼 배치 */}
            <EditableText
              value={frame.headline || '기술이 만드는\n완벽한 경험'}
              field="headline"
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="h2"
              style={{
                color: theme.headingDark,
                fontSize: '32px', fontWeight: '800', lineHeight: '1.3',
                margin: '0 0 12px 0', letterSpacing: '-0.6px',
                display: 'block', whiteSpace: 'pre-line',
              }}
            />

            <EditableText
              value={frame.subheadline || '세심한 설계와 정밀한 부품이 만들어내는 차원이 다른 사용 경험을 확인하세요.'}
              field="subheadline"
              isEditable={isEditable}
              onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
              tag="p"
              style={{
                color: theme.mutedDark,
                fontSize: '14px', lineHeight: '1.65',
                margin: '0', display: 'block',
              }}
            />
          </div>

          {/* 하단: 미니 기능 카드 2개 가로 배치
              변경 전: 없음 / 변경 후: 아이콘+제목+설명 카드 */}
          <div style={{ display: 'flex', gap: '10px' }}>
            {miniCards.map((card, i) => (
              <div key={i} style={{
                flex: '1 1 0',
                backgroundColor: theme.bgSubtle,
                borderRadius: '12px',
                padding: '14px 16px',
                display: 'flex', flexDirection: 'column', gap: '6px',
              }}>
                <div style={{ fontSize: '20px', lineHeight: '1' }}>{card.icon}</div>
                <EditableText
                  value={card.title}
                  field={`metadata.miniCards.${i}.title`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="span"
                  style={{
                    color: theme.headingDark,
                    fontSize: '17px', fontWeight: '700', lineHeight: '1.4',
                    display: 'block',
                  }}
                />
                {card.desc && (
                  <EditableText
                    value={card.desc}
                    field={`metadata.miniCards.${i}.desc`}
                    isEditable={isEditable}
                    onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                    tag="span"
                    style={{
                      color: theme.mutedDark,
                      fontSize: '15px', lineHeight: '1.5', display: 'block',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 오른쪽 컬럼: TECHNICAL SPECS 카드
            변경 전: 없음 / 변경 후: 어두운 카드 배경 + 스펙 항목 리스트 */}
        <div style={{
          width: '220px', flexShrink: 0,
          backgroundColor: theme.bgDark,
          borderRadius: '16px',
          padding: '20px 18px',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* TECHNICAL SPECS 라벨 */}
          <div style={{
            color: theme.accent,
            fontSize: '12px', fontWeight: '700', letterSpacing: '2px',
            textTransform: 'uppercase' as const,
            marginBottom: '16px',
            paddingBottom: '12px',
            borderBottom: `1px solid rgba(255,255,255,0.1)`,
          }}>
            TECHNICAL SPECS
          </div>

          {/* 스펙 항목 — 변경 전: 체크리스트 / 변경 후: 라벨+값 세로 쌓기 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {displaySpecs.map((spec, i) => (
              <div key={i} style={{
                paddingTop: i === 0 ? '0' : '12px',
                marginTop: i === 0 ? '0' : '12px',
                borderTop: i === 0 ? 'none' : `1px solid rgba(255,255,255,0.07)`,
              }}>
                <EditableText
                  value={spec.label}
                  field={`metadata.specs.${i}.label`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="span"
                  style={{
                    color: theme.mutedLight,
                    fontSize: '14px', fontWeight: '600', letterSpacing: '0.5px',
                    textTransform: 'uppercase' as const,
                    display: 'block', marginBottom: '3px',
                  }}
                />
                <EditableText
                  value={spec.value}
                  field={`metadata.specs.${i}.value`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="span"
                  style={{
                    color: theme.headingLight,
                    fontSize: '17px', fontWeight: '500', lineHeight: '1.4',
                    display: 'block',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          B) 인용문 배너 — ~160px
          변경 전: 없음 / 변경 후: 어두운 배경 + 흰색 이탤릭 인용문
      ══════════════════════════════════════════════════════ */}
      <div style={{
        height: '160px', flexShrink: 0,
        backgroundColor: theme.bgDark,
        margin: '0 36px',
        borderRadius: '16px',
        display: 'flex', alignItems: 'center',
        padding: '0 40px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* 장식용 큰 따옴표 */}
        <div style={{
          position: 'absolute', top: '8px', left: '28px',
          fontSize: '80px', lineHeight: '1',
          color: theme.accent, opacity: 0.3,
          fontFamily: 'Georgia, serif',
          pointerEvents: 'none', userSelect: 'none',
        }}>
          &ldquo;
        </div>

        <EditableText
          value={quote}
          field="metadata.quote"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="p"
          style={{
            color: theme.headingLight,
            fontSize: '18px', fontStyle: 'italic', fontWeight: '400',
            lineHeight: '1.65', margin: '0',
            paddingLeft: '20px',
            display: 'block',
          }}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          C) 하단 2컬럼 — 나머지 공간 (약 300px)
          왼쪽: 제품 이미지 / 오른쪽: 제목 + 상세 설명
          변경 전: 없음 / 변경 후: 이미지+텍스트 나란히 배치
      ══════════════════════════════════════════════════════ */}
      <div style={{
        flex: 1,
        display: 'flex', flexDirection: 'row',
        padding: '20px 36px 36px',
        gap: '20px',
      }}>
        {/* 왼쪽: 제품 이미지 */}
        <div style={{
          flex: '1 1 0',
          borderRadius: '14px',
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: theme.bgSubtle,
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

        {/* 오른쪽: 제목 + 상세 설명 */}
        <div style={{
          flex: '1 1 0',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          gap: '12px',
        }}>
          {/* 구분선 */}
          <div style={{
            width: '32px', height: '3px',
            backgroundColor: theme.accent, borderRadius: '2px',
          }} />

          <EditableText
            value={detailTitle}
            field="metadata.detailTitle"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="h3"
            style={{
              color: theme.headingDark,
              fontSize: '22px', fontWeight: '800', lineHeight: '1.3',
              margin: '0', letterSpacing: '-0.4px',
              display: 'block',
            }}
          />

          <EditableText
            value={detailDesc}
            field="bodyText"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{
              color: theme.mutedDark,
              fontSize: '14px', lineHeight: '1.75',
              margin: '0', display: 'block',
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default Detail2Template;
