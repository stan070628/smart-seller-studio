'use client';

export type WinnerStatus = 'winner' | 'watch' | 'normal';

export function WinnerBadge({ status }: { status: WinnerStatus }) {
  if (status === 'winner')
    return (
      <span style={{ fontSize: '11px', background: '#15803d', color: '#dcfce7', padding: '2px 8px', borderRadius: '20px', fontWeight: 600 }}>
        위너
      </span>
    );
  if (status === 'watch')
    return (
      <span style={{ fontSize: '11px', background: '#854d0e', color: '#fef9c3', padding: '2px 8px', borderRadius: '20px', fontWeight: 600 }}>
        관찰
      </span>
    );
  return null;
}
