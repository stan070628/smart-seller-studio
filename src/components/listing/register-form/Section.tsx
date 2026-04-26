'use client';

import React, { useState } from 'react';

// ListingDashboard 로컬 C 기준 값을 그대로 유지 (design-tokens와 미묘하게 다름)
const C = {
  card: '#ffffff',
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  accent: '#be0014',
} as const;

interface SectionProps {
  title: string;
  required?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function Section({ title, required, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      backgroundColor: C.card, border: `1px solid ${C.border}`,
      borderRadius: '10px', overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>
          {title}
          {required && <span style={{ color: C.accent, marginLeft: '4px' }}>*</span>}
        </span>
        <span style={{ color: C.textSub, fontSize: '12px' }}>{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
