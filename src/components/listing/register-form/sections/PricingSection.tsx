'use client';

/**
 * PricingSection.tsx
 * 가격 / 재고 / 옵션 편집 섹션
 *
 * BothRegisterForm.tsx line 662-813에서 추출.
 * - 공통 판매가 / 정상가 / 재고 입력 (3열 그리드)
 * - 채널별 판매가 설정 (쿠팡 / 네이버 2열 그리드, 선택 사항)
 * - OptionEditor (itemNo 없이 호출 — prefill 폐기)
 */

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import OptionEditor from '@/components/listing/OptionEditor';

// ─── 디자인 토큰 ────────────────────────────────────────────────────────────
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
 * PricingSection
 * 가격/재고 입력 + 채널별 판매가 + OptionEditor를 하나의 섹션으로 묶습니다.
 * 상태/로직은 모두 useRegisterForm에서 주입받습니다.
 */
export default function PricingSection() {
  const { sharedDraft, updateDraft, errors, setErrors } = useRegisterForm();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 공통 판매가 / 정상가 / 재고 — 3열 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        {/* 공통 판매가 */}
        <div>
          <label style={labelStyle}>
            공통 판매가
            {!sharedDraft.coupangPrice && !sharedDraft.naverPrice && (
              <span style={{ color: C.accent }}> *</span>
            )}
          </label>
          <input
            type="number"
            min="100"
            style={{
              ...inputStyle,
              borderColor: errors.salePrice ? '#b91c1c' : C.border,
            }}
            value={sharedDraft.salePrice}
            onChange={(e) => {
              updateDraft({ salePrice: e.target.value });
              if (errors.salePrice) setErrors((prev) => ({ ...prev, salePrice: '' }));
            }}
            placeholder="채널 공통 가격"
          />
          <FieldError message={errors.salePrice} />
        </div>

        {/* 정상가 */}
        <div>
          <label style={labelStyle}>정상가</label>
          <input
            type="number"
            style={inputStyle}
            value={sharedDraft.originalPrice}
            onChange={(e) => updateDraft({ originalPrice: e.target.value })}
            placeholder="할인 전 가격"
          />
        </div>

        {/* 재고 */}
        <div>
          <label style={labelStyle}>재고</label>
          <input
            type="number"
            min="0"
            style={inputStyle}
            value={sharedDraft.stock}
            onChange={(e) => updateDraft({ stock: e.target.value })}
          />
        </div>
      </div>

      {/* 채널별 판매가 설정 (선택) */}
      <div>
        <div
          style={{
            fontSize: '11px',
            color: '#71717a',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>채널별 판매가 설정</span>
          <span
            style={{
              fontSize: '10px',
              backgroundColor: '#f3f3f3',
              color: '#71717a',
              padding: '1px 6px',
              borderRadius: '4px',
            }}
          >
            선택
          </span>
          <span style={{ color: '#a1a1aa' }}>— 입력 시 공통 판매가보다 우선 적용됩니다</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {/* 쿠팡 전용 판매가 */}
          <div>
            <label
              style={{
                ...labelStyle,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#fff',
                  backgroundColor: '#be0014',
                  padding: '1px 6px',
                  borderRadius: '4px',
                }}
              >
                쿠팡
              </span>
              판매가
            </label>
            <input
              type="number"
              min="100"
              style={inputStyle}
              value={sharedDraft.coupangPrice}
              onChange={(e) => {
                updateDraft({ coupangPrice: e.target.value });
                if (errors.salePrice) setErrors((prev) => ({ ...prev, salePrice: '' }));
              }}
              placeholder="미입력 시 공통 판매가 사용"
            />
          </div>

          {/* 네이버 전용 판매가 */}
          <div>
            <label
              style={{
                ...labelStyle,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#fff',
                  backgroundColor: '#03c75a',
                  padding: '1px 6px',
                  borderRadius: '4px',
                }}
              >
                네이버
              </span>
              판매가
            </label>
            <input
              type="number"
              min="100"
              style={inputStyle}
              value={sharedDraft.naverPrice}
              onChange={(e) => {
                updateDraft({ naverPrice: e.target.value });
                if (errors.salePrice) setErrors((prev) => ({ ...prev, salePrice: '' }));
              }}
              placeholder="미입력 시 공통 판매가 사용"
            />
          </div>
        </div>
      </div>

      {/* 옵션 편집 — itemNo 없이 호출 (prefill 폐기) */}
      <OptionEditor />
    </div>
  );
}
