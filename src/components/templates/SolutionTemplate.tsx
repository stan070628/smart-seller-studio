/**
 * SolutionTemplate.tsx - 780×1100 세로형
 *
 * 레퍼런스: "The Editorial Marketplace" 디자인 시스템
 *   상단 30% (~330px): THE SOLUTION 라벨 + 헤드라인 + 서브헤드라인
 *   하단 70% (~770px): 3장 솔루션 카드 세로 나열
 *
 * 카드: 왼쪽 accent 세로선, 연한 번호(01/02/03), 우상단 원형 아이콘,
 *       굵은 제목 + 설명 텍스트
 * 색상/폰트는 theme 스킴을 따름 (테마 전환 가능)
 */
import React from 'react';
import type { TemplateProps } from './HeroTemplate';
import { DEFAULT_THEME } from '@/lib/themes';
import EditableText from './EditableText';

/** accent hex → rgba 변환 헬퍼 */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 카드별 폴백 이모지 아이콘 */
const FALLBACK_ICONS = ['⚡', '🌿', '🛡'];

const SolutionTemplate: React.FC<TemplateProps> = ({
  frame, isEditable = false, onFieldChange, theme = DEFAULT_THEME,
}) => {
  if (frame.skip) return null;

  interface SolutionItem { problem?: string; answer?: string }
  const rawSolutions = Array.isArray(frame.metadata?.solutions)
    ? (frame.metadata.solutions as (string | SolutionItem)[]).slice(0, 3)
    : [];
  const solutions = rawSolutions.length > 0
    ? rawSolutions.map((s) =>
        typeof s === 'string'
          ? { problem: s, answer: '' }
          : { problem: s.problem ?? '', answer: s.answer ?? '' }
      )
    : [
        { problem: '지능형 퍼포먼스 제어', answer: '사용자의 패턴을 스스로 분석하여 최적의 에너지를 배분합니다. 불필요한 전력 소모를 차단하고 필요한 순간에 폭발적인 성능을 발휘하여 작업 효율을 극대화합니다.' },
        { problem: '지속 가능한 프리미엄 소재', answer: '최고급 알루미늄 합금과 재생 가능한 친환경 패브릭의 조화로 완성되었습니다. 시간이 흐를수록 깊어지는 미학적 가치와 환경을 생각하는 철학을 동시에 담았습니다.' },
        { problem: '360도 안심 보안 케어', answer: '물리적 보안과 디지털 보안이 완벽하게 결합되었습니다. 외부 충격으로부터 내부 핵심 부품을 보호하는 하드웨어 설계와 실시간 암호화 기술로 당신의 일상을 수호합니다.' },
      ];

  // metadata.icons에서 AI 생성 아이콘 가져오기 (없으면 폴백)
  const metaIcons = Array.isArray(frame.metadata?.icons)
    ? (frame.metadata.icons as string[])
    : [];
  const cardIcons = FALLBACK_ICONS.map((fallback, i) => metaIcons[i] || fallback);

  // accent 파생 색상
  const accentLight = hexToRgba(theme.accent, 0.10);
  const numberColor = hexToRgba(theme.accent, 0.20);

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

      {/* ── 상단 텍스트 영역 (30% = 330px) ── */}
      <div style={{
        height: '330px',
        flexShrink: 0,
        padding: '48px 52px 0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}>
        {/* THE SOLUTION 라벨 */}
        <div style={{
          fontSize: '12px',
          fontWeight: 800,
          letterSpacing: '0.15em',
          color: theme.accent,
          marginBottom: '16px',
        }}>
          THE SOLUTION
        </div>

        {/* 헤드라인 */}
        <EditableText
          value={frame.headline || '이제 이 제품으로\n한계를 넘어서세요'}
          field="headline"
          isEditable={isEditable}
          onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
          tag="h1"
          style={{
            color: theme.headingDark,
            fontSize: '42px',
            fontWeight: 800,
            lineHeight: 1.15,
            margin: '0 0 20px 0',
            letterSpacing: '-0.04em',
            display: 'block',
            whiteSpace: 'pre-line' as const,
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
              lineHeight: 1.7,
              margin: 0,
              display: 'block',
              maxWidth: '520px',
            }}
          />
        )}
      </div>

      {/* ── 하단 카드 영역 (70%) ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '0 52px 48px',
      }}>
        {solutions.map((solution, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: theme.bgCard,
              borderRadius: '12px',
              padding: '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: '6px',
              borderLeft: `4px solid ${theme.accent}`,
              position: 'relative' as const,
              boxShadow: '0 -4px 20px 0 rgba(0,0,0,0.04)',
            }}
          >
            {/* 번호 + 아이콘 행 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '4px',
            }}>
              {/* 번호 */}
              <span style={{
                fontSize: '24px',
                fontWeight: 900,
                color: numberColor,
                fontStyle: 'italic',
                letterSpacing: '-0.04em',
                lineHeight: 1,
              }}>
                {String(i + 1).padStart(2, '0')}
              </span>

              {/* 우상단 원형 아이콘 뱃지 */}
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: accentLight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
              }}>
                {cardIcons[i]}
              </div>
            </div>

            {/* 카드 제목 */}
            {solution.problem && (
              <EditableText
                value={solution.problem}
                field={`metadata.solutions.${i}.problem`}
                isEditable={isEditable}
                onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="p"
                style={{
                  color: theme.headingDark,
                  fontSize: '24px',
                  fontWeight: 700,
                  margin: 0,
                  display: 'block',
                  lineHeight: 1.35,
                }}
              />
            )}

            {/* 카드 설명 */}
            {solution.answer && (
              <EditableText
                value={solution.answer}
                field={`metadata.solutions.${i}.answer`}
                isEditable={isEditable}
                onFieldChange={onFieldChange as ((f: string, v: string) => void) | undefined}
                tag="p"
                style={{
                  color: theme.mutedDark,
                  fontSize: '17px',
                  lineHeight: 1.65,
                  margin: 0,
                  fontWeight: 400,
                  display: 'block',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SolutionTemplate;
