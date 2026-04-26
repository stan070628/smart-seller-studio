'use client';

import React from 'react';
import { Package } from 'lucide-react';
import { C } from '@/lib/design-tokens';

interface ProductCountWidgetProps {
  coupang: number;
  naver: number;
}

export default function ProductCountWidget({ coupang, naver }: ProductCountWidgetProps) {
  const total = coupang + naver;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 18px',
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        backgroundColor: C.card,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: '#f5f5f5',
          color: '#71717a',
          flexShrink: 0,
        }}
      >
        <Package size={16} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>등록 상품</div>
      <div
        aria-label="채널별 등록 상품 수"
        style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}
      >
        <ChannelDot color={C.accent} label="쿠팡" value={coupang} />
        <Divider />
        <ChannelDot color="#16a34a" label="네이버" value={naver} />
        <Divider />
        <span style={{ fontSize: 13, color: '#71717a' }}>
          총 <strong style={{ color: C.text }}>{total.toLocaleString()}</strong>
        </span>
      </div>
    </div>
  );
}

function ChannelDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, display: 'inline-block' }}
      />
      <span style={{ color: '#71717a' }}>{label}</span>
      <strong style={{ color: C.text }}>{value.toLocaleString()}</strong>
    </span>
  );
}

function Divider() {
  return <span aria-hidden style={{ width: 1, height: 14, backgroundColor: C.border }} />;
}
