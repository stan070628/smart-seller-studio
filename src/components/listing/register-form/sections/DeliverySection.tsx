'use client';

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';

const C = {
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
} as const;

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: '13px',
  border: `1px solid ${C.border}`, borderRadius: '8px',
  outline: 'none', color: C.text, backgroundColor: '#fff',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12px', fontWeight: 600,
  color: C.textSub, marginBottom: '6px',
};

export default function DeliverySection() {
  const {
    sharedDraft, updateDraft,
    recalcChannelPrices,
    naverExchangeFee, setNaverExchangeFee,
  } = useRegisterForm();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        {/* 배송비 유형 */}
        <div>
          <label style={labelStyle}>배송비 유형</label>
          <select
            style={inputStyle}
            value={sharedDraft.deliveryChargeType}
            onChange={(e) => {
              const newType = e.target.value as 'FREE' | 'NOT_FREE' | 'CHARGE_RECEIVED';
              updateDraft({ deliveryChargeType: newType });
              recalcChannelPrices();
            }}
          >
            <option value="FREE">무료배송</option>
            <option value="NOT_FREE">유료배송</option>
            <option value="CHARGE_RECEIVED">착불</option>
          </select>
        </div>
        {/* 배송비 */}
        <div>
          <label style={labelStyle}>배송비 (원)</label>
          <input
            type="number"
            min="0"
            style={inputStyle}
            value={sharedDraft.deliveryCharge}
            onChange={(e) => {
              updateDraft({ deliveryCharge: e.target.value });
              recalcChannelPrices();
            }}
          />
        </div>
        {/* 반품배송비 */}
        <div>
          <label style={labelStyle}>반품배송비 (원)</label>
          <input
            type="number"
            min="0"
            style={inputStyle}
            value={sharedDraft.returnCharge}
            onChange={(e) => updateDraft({ returnCharge: e.target.value })}
          />
        </div>
      </div>

      {/* 네이버 전용 — 교환배송비 */}
      <div>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '10px', fontWeight: 700, color: '#fff',
            backgroundColor: '#03c75a', padding: '1px 6px', borderRadius: '4px',
          }}>
            네이버
          </span>
          교환배송비 (원)
        </label>
        <input
          type="number"
          min="0"
          style={inputStyle}
          value={naverExchangeFee}
          onChange={(e) => setNaverExchangeFee(e.target.value)}
        />
      </div>
    </div>
  );
}
