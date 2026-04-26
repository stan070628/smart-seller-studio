'use client';

/**
 * PricingSection.tsx
 * 가격 / 재고 / 옵션 편집 섹션
 *
 * - 공통 판매가 / 정상가 / 재고 입력 (3열 그리드)
 * - 채널별 판매가 설정 (쿠팡 / 네이버 2열 그리드, 선택 사항)
 * - 판매 추천가 근거 산식 (소싱 원가 + 목표 마진율 → 채널별 추천가)
 * - OptionEditor
 */

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import OptionEditor from '@/components/listing/OptionEditor';

// ─── 추천가 계산 상수 (어제 업데이트: 네이버 수수료 10% → 6%) ──────────────────
const NAVER_FEE   = 0.06;   // 네이버 결제+매출연동 수수료
const COUPANG_FEE = 0.11;   // 쿠팡 판매자 수수료
const VAT_RATE    = 0.10;   // 부가세
const NAVER_DEDUCTION   = 1 - NAVER_FEE   - VAT_RATE; // = 0.84
const COUPANG_DEDUCTION = 1 - COUPANG_FEE - VAT_RATE; // = 0.79

function calcPrices(costPrice: number, deliveryCharge: number, marginRate: number) {
  const costTotal = costPrice + deliveryCharge;
  const mult = 1 + marginRate / 100;
  return {
    costTotal,
    naverMin:      Math.ceil(costTotal / NAVER_DEDUCTION),
    naverRec:      Math.round(costTotal * mult / NAVER_DEDUCTION / 10) * 10,
    coupangMin:    Math.ceil(costTotal / COUPANG_DEDUCTION),
    coupangRec:    Math.round(costTotal * mult / COUPANG_DEDUCTION / 10) * 10,
  };
}

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

  const costPriceNum     = Number(sharedDraft.costPrice) || 0;
  const deliveryCharge   = Number(sharedDraft.deliveryCharge) || 0;
  const marginRate       = sharedDraft.targetMarginRate ?? 20;
  const hasCalcInput     = costPriceNum > 0;
  const calc             = hasCalcInput ? calcPrices(costPriceNum, deliveryCharge, marginRate) : null;

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

      {/* 판매 추천가 근거 산식 */}
      <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: '14px' }}>
        <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 700, color: '#7c3aed' }}>추천가 계산기</span>
          <span style={{ fontSize: '10px', backgroundColor: '#f5f3ff', color: '#7c3aed', padding: '1px 6px', borderRadius: '4px' }}>소싱 원가 기반</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
          {/* 소싱 원가 */}
          <div>
            <label style={labelStyle}>소싱 원가</label>
            <input
              type="number"
              min="0"
              style={inputStyle}
              value={sharedDraft.costPrice}
              onChange={(e) => updateDraft({ costPrice: e.target.value })}
              placeholder="구매 원가 입력"
            />
          </div>

          {/* 목표 마진율 */}
          <div>
            <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
              <span>목표 마진율</span>
              <span style={{ color: '#7c3aed', fontWeight: 700 }}>{marginRate}%</span>
            </label>
            <input
              type="range"
              min="5"
              max="50"
              step="1"
              value={marginRate}
              onChange={(e) => updateDraft({ targetMarginRate: Number(e.target.value) })}
              style={{ width: '100%', accentColor: '#7c3aed', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: C.textSub, marginTop: '2px' }}>
              <span>5%</span>
              <span>50%</span>
            </div>
          </div>
        </div>

        {/* 계산 결과 */}
        {calc ? (
          <div style={{ backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '12px 14px' }}>
            {/* 공식 표시 */}
            <div style={{ fontSize: '11px', color: '#6d28d9', marginBottom: '10px', lineHeight: '1.6' }}>
              <span style={{ fontWeight: 600 }}>산식</span>
              {' '}— (소싱원가 {calc.costTotal.toLocaleString()}원 × (1 + {marginRate}%)) ÷ (1 − 수수료 − 부가세)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* 네이버 */}
              <div style={{ backgroundColor: '#fff', border: '1px solid #ddd6fe', borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#fff', backgroundColor: '#03c75a', padding: '1px 6px', borderRadius: '3px' }}>네이버</span>
                  <span style={{ fontSize: '10px', color: '#71717a' }}>수수료 6% + 부가세 10%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                  <span style={{ fontSize: '11px', color: '#71717a' }}>최소 판매가</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#18181b' }}>{calc.naverMin.toLocaleString()}원</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#6d28d9', fontWeight: 600 }}>추천 판매가</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#6d28d9' }}>{calc.naverRec.toLocaleString()}원</span>
                </div>
              </div>

              {/* 쿠팡 */}
              <div style={{ backgroundColor: '#fff', border: '1px solid #ddd6fe', borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#fff', backgroundColor: '#be0014', padding: '1px 6px', borderRadius: '3px' }}>쿠팡</span>
                  <span style={{ fontSize: '10px', color: '#71717a' }}>수수료 11% + 부가세 10%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                  <span style={{ fontSize: '11px', color: '#71717a' }}>최소 판매가</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#18181b' }}>{calc.coupangMin.toLocaleString()}원</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#be0014', fontWeight: 600 }}>추천 판매가</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#be0014' }}>{calc.coupangRec.toLocaleString()}원</span>
                </div>
              </div>
            </div>

            {deliveryCharge > 0 && (
              <div style={{ marginTop: '8px', fontSize: '10px', color: '#9ca3af', textAlign: 'right' }}>
                배송비 {deliveryCharge.toLocaleString()}원 포함 계산 (배송 섹션 값 자동 반영)
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: '#a1a1aa', padding: '8px 0' }}>
            소싱 원가를 입력하면 채널별 추천 판매가를 계산해 드립니다.
          </div>
        )}
      </div>

      {/* 옵션 편집 — itemNo 없이 호출 (prefill 폐기) */}
      <OptionEditor />
    </div>
  );
}
