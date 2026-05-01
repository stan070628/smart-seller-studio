'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useProductDiscoveryStore } from '@/store/useProductDiscoveryStore';

const GRADE_COLOR: Record<string, string> = {
  S: '#7c3aed', A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626',
};

export default function StepResult() {
  const router = useRouter();
  const { validated, toggleResultSelect, confirmAndGetDraftId, isConfirming, error, productInfo } =
    useProductDiscoveryStore();

  // 통과(미차단)만 점수순 정렬
  const passed = [...validated]
    .filter((v) => !v.isBlocked && v.seedScore !== null)
    .sort((a, b) => (b.seedScore ?? 0) - (a.seedScore ?? 0));
  const selectedCount = passed.filter((v) => v.isSelected).length;

  const onSendToListing = async () => {
    const draftId = await confirmAndGetDraftId();
    if (draftId) router.push(`/listing?draftId=${draftId}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ padding: '8px 14px', background: '#faf5ff', borderBottom: '1px solid #e9d5ff', fontSize: 11, fontWeight: 700, color: '#7c3aed' }}>
        🎯 Step 3 — 통과 키워드 {passed.length}개 / 선택 {selectedCount}개 → 상품등록 보내기
      </div>

      <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
        {passed.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
            통과한 키워드가 없습니다. Step 2로 돌아가 다시 검토하세요.
          </div>
        ) : passed.map((v, i) => {
          const ratio = v.competitorCount && v.competitorCount > 0
            ? ((v.searchVolume ?? 0) / v.competitorCount) * 1000
            : 0;
          return (
            <div
              key={v.keyword}
              onClick={() => toggleResultSelect(v.keyword)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                background: v.isSelected ? '#f5f0ff' : '#f9fafb',
                border: `1px solid ${v.isSelected ? '#a78bfa' : '#e2e8f0'}`,
              }}
            >
              <input type="checkbox" checked={v.isSelected} onChange={() => {}} style={{ accentColor: '#7c3aed' }} />
              <span style={{ fontSize: 10, color: '#94a3b8', width: 18 }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 11 }}>{v.keyword}</span>
              <span style={{ fontSize: 10, color: '#6b7280', width: 70, textAlign: 'right' }}>
                {v.searchVolume?.toLocaleString() ?? '—'}
              </span>
              <span style={{ fontSize: 10, color: '#9ca3af', width: 90, textAlign: 'right' }}>
                경쟁 {v.competitorCount?.toLocaleString() ?? '—'}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#0891b2', width: 60, textAlign: 'right' }}>
                노출 {ratio.toFixed(1)}
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: GRADE_COLOR[v.seedGrade ?? 'D'], width: 32, textAlign: 'right' }}>
                {v.seedScore}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 5px',
                background: `${GRADE_COLOR[v.seedGrade ?? 'D']}18`,
                color: GRADE_COLOR[v.seedGrade ?? 'D'],
              }}>{v.seedGrade}</span>
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: 8, margin: '0 12px 8px', background: '#fee2e2', color: '#dc2626', fontSize: 11, borderRadius: 5 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ padding: '10px 14px', background: '#f9fafb', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#64748b' }}>
          상품: {productInfo?.title ?? '—'} · 통과 {passed.length}개 · 선택 {selectedCount}개
        </span>
        <button
          onClick={onSendToListing}
          disabled={selectedCount === 0 || isConfirming}
          style={{
            padding: '7px 16px', borderRadius: 6, border: 'none',
            background: selectedCount > 0 && !isConfirming ? '#be0014' : '#e5e7eb',
            color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: selectedCount > 0 && !isConfirming ? 'pointer' : 'not-allowed',
          }}
        >
          {isConfirming ? '저장 중...' : `📦 ${selectedCount}개 키워드로 상품등록 →`}
        </button>
      </div>
    </div>
  );
}
