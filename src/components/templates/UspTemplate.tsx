/**
 * UspTemplate.tsx - 780×1100 세로형
 * 레퍼런스: stitch_coupang_seller_page (3)/screen.png
 *
 * 변경 전: 어두운 다크 배경(uspDarkBg) + 3컬럼 균등 그리드 + 우리/타사 위치 반전
 * 변경 후: 밝은 배경(bgPage) + 상단 헤더 섹션 + EDITORIAL COMPARISON 레이블
 *          + 3컬럼 비교 테이블(항목라벨-좁음 | OTHERS-타사 | SELECTION-우리)
 *          + 우리 컬럼 전체 accent 그라데이션으로 연결
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

interface CompetitorRow { feature: string; ours: string; theirs: string; }

const UspTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  const competitors = Array.isArray(frame.metadata?.competitors)
    ? (frame.metadata.competitors as CompetitorRow[]).slice(0, 3)
    : [];

  /* 기본값: 3행으로 고정 (레퍼런스 기준) */
  const rows = competitors.length > 0 ? competitors : [
    { feature: '브랜드 아이덴티티', ours: '명확한 브랜드 철학과 시그니처 디자인', theirs: '로고만 있고 가나 식별 어려움' },
    { feature: '기능 활용성', ours: '탈착 가능한 다용도 스트링 후드', theirs: '고정형 후드로 활용 제한' },
    { feature: '실루엣', ours: '트렌디한 오버사이즈 핏', theirs: '체형에 맞지 않는 구식 스타일' },
  ];

  /* accent 그라데이션: 레퍼런스의 빨간 그라데이션 재현 */
  const accentGradient = `linear-gradient(180deg, ${theme.accent} 0%, ${theme.accent}CC 100%)`;

  /* 헤더 높이: 상단 30% ≈ 300px, 테이블 영역: 나머지 800px */
  const HEADER_HEIGHT = 300;
  const TABLE_HEIGHT = 800;
  /* 컬럼 비율: 항목라벨 160px | 타사 270px | 우리 350px */
  const COL_LABEL = 160;
  const COL_OTHERS = 270;
  const COL_OURS = 350;
  /* 헤더행 + 3개 데이터행 높이 계산 */
  const HEADER_ROW_H = 110;
  const DATA_ROW_H = Math.floor((TABLE_HEIGHT - HEADER_ROW_H) / rows.length);

  return (
    <div style={{
      width: '780px',
      height: '1100px',
      backgroundColor: theme.bgPage,
      fontFamily: theme.fontFamily,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>

      {/* ── 상단 헤더 섹션 (bgPage, ~300px) ── */}
      <div style={{
        height: `${HEADER_HEIGHT}px`,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 52px',
        gap: '20px',
      }}>
        {/* EDITORIAL COMPARISON 라벨 */}
        <div style={{
          fontSize: '12px',
          fontWeight: '700',
          letterSpacing: '0.18em',
          color: theme.accent,
          textTransform: 'uppercase' as const,
          textAlign: 'center' as const,
        }}>
          EDITORIAL COMPARISON
        </div>

        {/* 대형 헤드라인 */}
        <EditableText
          value={frame.headline || '일반 제품과\n비교해보세요'}
          field="headline"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{
            /* 변경 전: color: theme.headingLight, fontSize: '34px', 다크 배경 기준 */
            /* 변경 후: color: theme.headingDark, fontSize: '40px', 밝은 배경 + 가운데 정렬 */
            color: theme.headingDark,
            fontSize: '40px',
            fontWeight: '800',
            lineHeight: '1.25',
            margin: '0',
            letterSpacing: '-0.8px',
            textAlign: 'center' as const,
            whiteSpace: 'pre-line' as const,
            display: 'block',
          }}
        />

        {/* 서브헤드라인 (선택) */}
        {frame.subheadline && (
          <EditableText
            value={frame.subheadline}
            field="subheadline"
            isEditable={isEditable}
            onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
            tag="p"
            style={{
              color: theme.mutedDark,
              fontSize: '16px',
              margin: '0',
              lineHeight: '1.6',
              textAlign: 'center' as const,
              display: 'block',
            }}
          />
        )}
      </div>

      {/* ── 비교 테이블 영역 (~800px) ── */}
      <div style={{
        height: `${TABLE_HEIGHT}px`,
        flexShrink: 0,
        padding: '0 32px 40px 32px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '16px',
          overflow: 'hidden',
          /* 전체 테이블에 테두리 */
          border: `1px solid ${theme.border}`,
        }}>

          {/* ── 테이블 헤더 행 ── */}
          <div style={{
            display: 'flex',
            flexShrink: 0,
            height: `${HEADER_ROW_H}px`,
          }}>
            {/* 항목 라벨 컬럼 헤더 — 빈 셀 */}
            <div style={{
              width: `${COL_LABEL}px`,
              flexShrink: 0,
              backgroundColor: theme.bgSubtle,
              borderRight: `1px solid ${theme.border}`,
            }} />

            {/* OTHERS 헤더 */}
            <div style={{
              width: `${COL_OTHERS}px`,
              flexShrink: 0,
              backgroundColor: theme.bgSubtle,
              borderRight: `1px solid ${theme.border}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '0 20px',
            }}>
              <div style={{
                fontSize: '11px',
                fontWeight: '700',
                letterSpacing: '0.15em',
                color: theme.mutedDark,
                textTransform: 'uppercase' as const,
              }}>
                OTHERS
              </div>
              <div style={{
                fontSize: '18px',
                fontWeight: '700',
                color: theme.headingDark,
              }}>
                타사 제품
              </div>
            </div>

            {/* SELECTION 헤더 — accent 그라데이션, 상단 우측 radius */}
            <div style={{
              /* 변경 전: backgroundColor: theme.accent, 단색 */
              /* 변경 후: background: accentGradient, 그라데이션 */
              flex: 1,
              background: accentGradient,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '0 20px',
            }}>
              <div style={{
                fontSize: '11px',
                fontWeight: '700',
                letterSpacing: '0.15em',
                color: 'rgba(255,255,255,0.75)',
                textTransform: 'uppercase' as const,
              }}>
                SELECTION
              </div>
              <div style={{
                fontSize: '18px',
                fontWeight: '700',
                color: '#ffffff',
              }}>
                우리 제품
              </div>
            </div>
          </div>

          {/* ── 데이터 행들 ── */}
          {rows.map((row, i) => (
            <div key={i} style={{
              display: 'flex',
              flex: 1,
              /* 변경 전: gridTemplateColumns: '1fr 1fr 1fr' 균등 분배 */
              /* 변경 후: 고정 너비 컬럼 + flex로 우리 컬럼 확장 */
              borderTop: `1px solid ${theme.border}`,
              minHeight: `${DATA_ROW_H}px`,
            }}>

              {/* 항목 라벨 셀 */}
              <div style={{
                width: `${COL_LABEL}px`,
                flexShrink: 0,
                backgroundColor: theme.bgSubtle,
                borderRight: `1px solid ${theme.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px 12px',
              }}>
                <EditableText
                  value={row.feature}
                  field={`metadata.competitors.${i}.feature`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="span"
                  style={{
                    /* 변경 전: color: theme.mutedLight, 다크 배경 기준 흰색 계열 */
                    /* 변경 후: color: theme.headingDark, 세로 중앙 정렬 */
                    color: theme.headingDark,
                    fontSize: '17px',
                    fontWeight: '700',
                    textAlign: 'center' as const,
                    lineHeight: '1.4',
                    display: 'block',
                    wordBreak: 'keep-all' as const,
                  }}
                />
              </div>

              {/* 타사(OTHERS) 셀 — 밝은 배경, X 아이콘 */}
              <div style={{
                width: `${COL_OTHERS}px`,
                flexShrink: 0,
                backgroundColor: '#ffffff',
                borderRight: `1px solid ${theme.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '20px 20px',
              }}>
                {/* X 아이콘 — crossBg/crossColor 활용 */}
                <div style={{
                  width: '28px',
                  height: '28px',
                  flexShrink: 0,
                  borderRadius: '50%',
                  backgroundColor: theme.crossBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <line x1="3" y1="3" x2="11" y2="11" stroke={theme.crossColor} strokeWidth="2.2" strokeLinecap="round" />
                    <line x1="11" y1="3" x2="3" y2="11" stroke={theme.crossColor} strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                </div>
                <EditableText
                  value={row.theirs}
                  field={`metadata.competitors.${i}.theirs`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="span"
                  style={{
                    /* 변경 전: color: theme.mutedLight, textAlign: 'center' */
                    /* 변경 후: color: theme.mutedDark, 왼쪽 정렬 */
                    color: theme.mutedDark,
                    fontSize: '17px',
                    lineHeight: '1.5',
                    display: 'block',
                    wordBreak: 'keep-all' as const,
                  }}
                />
              </div>

              {/* 우리(SELECTION) 셀 — accent 배경, 체크 아이콘, 흰색 텍스트 */}
              <div style={{
                flex: 1,
                /* 변경 전: 없음 (균등 1fr) */
                /* 변경 후: accent 그라데이션 배경, 체크 아이콘 */
                background: accentGradient,
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '20px 20px',
              }}>
                {/* 체크 아이콘 — 흰색 반투명 원 */}
                <div style={{
                  width: '28px',
                  height: '28px',
                  flexShrink: 0,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <polyline points="2,7 6,11 12,3" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <EditableText
                  value={row.ours}
                  field={`metadata.competitors.${i}.ours`}
                  isEditable={isEditable}
                  onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                  tag="span"
                  style={{
                    /* 변경 전: color: theme.headingLight, ✓ 접두어 포함 문자열 */
                    /* 변경 후: color: '#ffffff', 아이콘 분리 */
                    color: '#ffffff',
                    fontSize: '18px',
                    fontWeight: '600',
                    lineHeight: '1.5',
                    display: 'block',
                    wordBreak: 'keep-all' as const,
                  }}
                />
              </div>

            </div>
          ))}

        </div>
      </div>
    </div>
  );
};
export default UspTemplate;
