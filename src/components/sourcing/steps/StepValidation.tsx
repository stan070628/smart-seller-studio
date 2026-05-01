'use client';

import React from 'react';
import { useProductDiscoveryStore } from '@/store/useProductDiscoveryStore';

export default function StepValidation() {
  const { validated, setReviewCount, goToResult, isValidating } = useProductDiscoveryStore();

  const pendingCount = validated.filter((v) => !v.isBlocked && v.topReviewCount === null).length;

  if (isValidating) {
    return (
      <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 20, height: 20,
          border: '2px solid #7c3aed',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: 12, color: '#6b7280' }}>검색량 + 경쟁상품수 분석 중...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ padding: '8px 14px', background: '#fffbeb', borderBottom: '2px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>
          ✏️ Step 2 — 쿠팡에서 상위 3개 리뷰수 직접 확인 후 입력 (50개 이상 자동 탈락)
        </span>
        {pendingCount > 0 && (
          <span style={{ background: '#fde68a', color: '#92400e', borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
            {pendingCount}개 미입력
          </span>
        )}
        <button
          onClick={() => {
            validated.filter((v) => v.topReviewCount === null && !v.isBlocked)
              .forEach((v) => window.open(`https://www.coupang.com/np/search?q=${encodeURIComponent(v.keyword)}`, '_blank'));
          }}
          style={{ marginLeft: 'auto', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 5, padding: '3px 8px', fontSize: 10, color: '#92400e', cursor: 'pointer' }}
        >
          미입력 {pendingCount}개 쿠팡 일괄 열기↗
        </button>
      </div>

      <div style={{ overflowX: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b', fontSize: 10 }}>키워드</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', color: '#1d4ed8', fontSize: 10 }}>월검색량</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', color: '#1d4ed8', fontSize: 10 }}>경쟁상품</th>
              <th style={{ padding: '6px 6px', textAlign: 'center', color: '#1d4ed8', fontSize: 10 }}>compIdx</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', color: '#1d4ed8', fontSize: 10 }}>CTR</th>
              <th style={{ padding: '6px 6px', textAlign: 'center', color: '#92400e', fontSize: 10, background: '#fffbeb', borderLeft: '2px solid #f59e0b' }}>
                쿠팡 상위리뷰<br /><span style={{ fontWeight: 400, fontSize: 9 }}>✏️ 직접 입력</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {validated.map((v) => (
              <tr key={v.keyword} style={{ borderBottom: '1px solid #f1f5f9', background: v.isBlocked ? '#fef2f2' : '#fff', opacity: v.isBlocked ? 0.6 : 1 }}>
                <td style={{ padding: '5px 8px', fontWeight: 600 }}>
                  {v.keyword}
                  {v.isBlocked && <div style={{ fontSize: 9, color: '#dc2626' }}>{v.blockedReason}</div>}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                  {v.searchVolume?.toLocaleString() ?? '—'}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: '#9ca3af' }}>
                  {v.competitorCount?.toLocaleString() ?? '—'}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                  {v.compIdx && (
                    <span style={{
                      padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                      background: v.compIdx === '낮음' ? '#dcfce7' : v.compIdx === '높음' ? '#fee2e2' : '#fef3c7',
                      color: v.compIdx === '낮음' ? '#15803d' : v.compIdx === '높음' ? '#b91c1c' : '#92400e',
                    }}>{v.compIdx}</span>
                  )}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: v.avgCtr !== null && v.avgCtr < 1 ? '#dc2626' : '#059669' }}>
                  {v.avgCtr !== null ? `${v.avgCtr.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'center', background: v.isBlocked ? '#fee2e2' : '#fffdf0', borderLeft: '2px solid #f59e0b' }}>
                  {v.isBlocked ? (
                    <span style={{ color: '#dc2626', fontWeight: 700 }}>{v.topReviewCount} ❌</span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                      <input
                        type="number" min={0}
                        value={v.topReviewCount ?? ''}
                        onChange={(e) => setReviewCount(v.keyword, Number(e.target.value))}
                        placeholder="—"
                        style={{
                          width: 50, padding: '2px 4px', textAlign: 'center',
                          border: `1px solid ${v.topReviewCount === null ? '#f59e0b' : '#d1d5db'}`,
                          borderRadius: 4, fontSize: 11,
                          background: v.topReviewCount === null ? '#fffbeb' : '#fff',
                        }}
                      />
                      <a
                        href={`https://www.coupang.com/np/search?q=${encodeURIComponent(v.keyword)}`}
                        target="_blank" rel="noreferrer"
                        style={{ color: '#1d4ed8', fontSize: 10 }}
                      >쿠팡↗</a>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '10px 14px', background: '#f9fafb', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => goToResult()}
          disabled={pendingCount > 0 || !validated.some((v) => !v.isBlocked)}
          style={{
            padding: '7px 16px', borderRadius: 6, border: 'none',
            background: pendingCount === 0 && validated.some((v) => !v.isBlocked) ? '#7c3aed' : '#e5e7eb',
            color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: pendingCount === 0 ? 'pointer' : 'not-allowed',
          }}
        >
          {pendingCount === 0 ? '🎯 결과 확인 →' : `🔒 ${pendingCount}개 미입력`}
        </button>
      </div>
    </div>
  );
}
