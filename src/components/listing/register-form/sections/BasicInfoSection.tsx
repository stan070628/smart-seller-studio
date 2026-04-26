'use client';

import React from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import CategoryPicker from '../parts/CategoryPicker';

// 디자인 토큰 (BothRegisterForm 기준)
const C = {
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  accent: '#be0014',
} as const;

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '13px',
  border: `1px solid ${C.border}`,
  borderRadius: '8px',
  outline: 'none',
  color: C.text,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: C.textSub,
  marginBottom: '6px',
};

// 필드 에러 메시지 컴포넌트
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      style={{
        fontSize: '11px',
        color: '#b91c1c',
        marginTop: '4px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <span>⚠</span>
      <span>{message}</span>
    </div>
  );
}

/**
 * BasicInfoSection
 * 상품명 + AI 최적화 버튼 + 쿠팡/네이버 카테고리 2열 배치
 * 상태/로직은 모두 useRegisterForm에서 주입받습니다.
 */
export default function BasicInfoSection() {
  const {
    sharedDraft,
    updateDraft,
    errors,
    setErrors,
    coupangCategoryCode,
    setCoupangCategoryCode,
    coupangCategoryPath,
    setCoupangCategoryPath,
    naverCategoryId,
    setNaverCategoryId,
    naverCategoryPath,
    setNaverCategoryPath,
    isOptimizing,
    handleOptimize,
  } = useRegisterForm();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 상품명 + AI 최적화 버튼 */}
      <div>
        <label style={labelStyle}>
          상품명 <span style={{ color: C.accent }}>*</span>
        </label>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            style={{
              ...inputStyle,
              flex: 1,
              borderColor: errors.name ? '#b91c1c' : C.border,
            }}
            value={sharedDraft.name}
            onChange={(e) => {
              updateDraft({ name: e.target.value });
              if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
            }}
            placeholder="상품명을 입력하세요"
          />
          <button
            type="button"
            disabled={!sharedDraft.name.trim() || isOptimizing}
            onClick={handleOptimize}
            title="AI로 상품명·태그 최적화"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '0 12px',
              fontSize: '12px',
              fontWeight: 600,
              border: '1px solid #8b5cf6',
              borderRadius: '8px',
              backgroundColor: isOptimizing ? '#f3f3f3' : '#f5f3ff',
              color: isOptimizing ? C.textSub : '#7c3aed',
              cursor: !sharedDraft.name.trim() || isOptimizing ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              opacity: !sharedDraft.name.trim() ? 0.5 : 1,
            }}
          >
            {isOptimizing ? (
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Sparkles size={14} />
            )}
            {isOptimizing ? 'AI 최적화 중...' : 'AI 최적화'}
          </button>
        </div>
        <FieldError message={errors.name} />
      </div>

      {/* 카테고리 — 쿠팡/네이버 2열 배치 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <CategoryPicker
          platform="coupang"
          selectedCode={coupangCategoryCode}
          selectedPath={coupangCategoryPath}
          onChange={(code, path) => {
            setCoupangCategoryCode(code);
            setCoupangCategoryPath(path);
            if (errors.coupangCategory)
              setErrors((prev) => ({ ...prev, coupangCategory: '' }));
          }}
          error={errors.coupangCategory}
        />
        <CategoryPicker
          platform="naver"
          selectedCode={naverCategoryId}
          selectedPath={naverCategoryPath}
          onChange={(code, path) => {
            setNaverCategoryId(code);
            setNaverCategoryPath(path);
            if (errors.naverCategory)
              setErrors((prev) => ({ ...prev, naverCategory: '' }));
          }}
          error={errors.naverCategory}
        />
      </div>
    </div>
  );
}
