'use client';

import { E } from '@/lib/design-tokens';

export type WinnerStatus = 'winner' | 'watch' | 'normal';

/**
 * 위너·관찰 상태 배지.
 *
 * variant는 두 가지다. 'pill'(기본)은 라운드 알약으로, 아직 개편하지 않은 화면
 * (SkuTable 등)이 쓰던 모양 그대로다. 'compact'는 ERP 격자용 — 27px 행에 들어가도록
 * 높이를 줄이고 모서리를 없앴다. 개편이 끝난 화면만 compact를 쓴다.
 */
export function WinnerBadge({
  status,
  variant = 'pill',
}: {
  status: WinnerStatus;
  variant?: 'pill' | 'compact';
}) {
  if (status !== 'winner' && status !== 'watch') return null;

  const isWinner = status === 'winner';
  const label = isWinner ? '위너' : '관찰';

  if (variant === 'compact') {
    const tone = isWinner ? E.profit : E.warn;
    return (
      <span style={{
        fontSize: 9.5,
        fontWeight: 700,
        padding: '1px 4px',
        border: `1px solid ${tone}`,
        color: tone,
        background: isWinner ? 'transparent' : E.warnSoft,
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}>
        {label}
      </span>
    );
  }

  return (
    <span style={{
      fontSize: '11px',
      background: isWinner ? '#15803d' : '#854d0e',
      color: isWinner ? '#dcfce7' : '#fef9c3',
      padding: '2px 8px',
      borderRadius: '20px',
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}
