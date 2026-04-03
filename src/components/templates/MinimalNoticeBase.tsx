/**
 * MinimalNoticeBase.tsx
 * 미니멀 그레이 공지 계열 공통 디자인 요소
 */
import React from 'react';

export const BG_GRAY = '#d9d9d9';
export const TEXT_DARK = '#111111';
export const TEXT_MUTED = '#999999';

/* 우상단 점 3개 */
export const ThreeDots: React.FC = () => (
  <div style={{
    position: 'absolute', top: '52px', right: '52px',
    display: 'flex', gap: '9px', alignItems: 'center', zIndex: 2,
  }}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ width: '13px', height: '13px', borderRadius: '50%', backgroundColor: '#aaaaaa' }} />
    ))}
  </div>
);

/* 체크박스 아이콘 (박스 + 박스 밖으로 나가는 체크) */
export const CheckIcon: React.FC<{ size?: number }> = ({ size = 44 }) => {
  const s = size / 44;
  return (
    <svg
      viewBox="0 0 56 44" width={56 * s} height={44 * s}
      fill="none" style={{ flexShrink: 0, marginTop: '2px' }}
    >
      <rect x="2" y="8" width="26" height="26" stroke={TEXT_DARK} strokeWidth="2.6" />
      <path d="M8 22 L17 31 L50 4" stroke={TEXT_DARK} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

/* 타이틀 섹션 (큰 볼드 + 서브타이틀) */
export interface TitleBlockProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}
export const TitleBlock: React.FC<TitleBlockProps> = ({ title, subtitle }) => (
  <div style={{ marginTop: '110px' }}>
    {title}
    {subtitle && <div style={{ marginTop: '10px' }}>{subtitle}</div>}
  </div>
);
