'use client';

import React from 'react';
import { useProductDiscoveryStore } from '@/store/useProductDiscoveryStore';
import { C as BASE_C } from '@/lib/design-tokens';
import StepProductInput from './steps/StepProductInput';
import StepValidation from './steps/StepValidation';
import StepResult from './steps/StepResult';

const C = {
  ...BASE_C,
  seedAccent: '#7c3aed',
  seedLight: '#ede9fe',
  seedBorder: '#a78bfa',
} as const;

const STEPS = [
  { num: 1, label: '상품 입력 + AI 키워드' },
  { num: 2, label: '검증 (검색량 + 쿠팡 리뷰)' },
  { num: 3, label: '결과 + 상품등록 연결' },
] as const;

export default function ProductDiscoveryTab() {
  const { currentStep, error, reset } = useProductDiscoveryStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg }}>
      {/* 헤더 */}
      <div style={{ padding: '12px 20px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>🌱 상품 발굴</div>
          <div style={{ fontSize: 11, color: C.textSub }}>
            상품 입력 → AI 키워드 추출 → 검증 → 상품등록 보내기
          </div>
        </div>
        <button
          onClick={reset}
          style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: 'none', background: C.seedAccent, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >+ 새 발굴 시작</button>
      </div>

      {error && (
        <div style={{ padding: '8px 20px', background: '#fee2e2', color: '#dc2626', fontSize: 11, borderBottom: '1px solid #fca5a5' }}>
          ⚠️ {error}
        </div>
      )}

      {/* 메인 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* 좌측: 진행 상태 */}
        <div style={{ padding: 14, borderRight: `1px solid ${C.border}`, background: C.card, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, marginBottom: 4 }}>진행 상태</div>
          {STEPS.map((s) => {
            const isDone = currentStep > s.num;
            const isActive = currentStep === s.num;
            const isLocked = currentStep < s.num;
            return (
              <div key={s.num} style={{
                borderRadius: 6, padding: '8px 10px',
                background: isDone ? '#f0fdf4' : isActive ? '#fffbeb' : '#f8fafc',
                border: `${isActive ? 2 : 1}px solid ${isDone ? '#bbf7d0' : isActive ? '#f59e0b' : C.border}`,
                opacity: isLocked ? 0.45 : 1,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{isDone ? '✅' : isActive ? '▶' : '🔒'}</span>
                  <span style={{ color: isDone ? '#16a34a' : isActive ? '#92400e' : C.textSub }}>
                    Step {s.num} — {s.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 우측: 현재 Step */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {currentStep === 1 && <StepProductInput />}
          {currentStep === 2 && <StepValidation />}
          {currentStep === 3 && <StepResult />}
        </div>
      </div>
    </div>
  );
}
