'use client';

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';

// 색상 상수
const C = {
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
} as const;

export default function DescriptionSection() {
  const { sharedDraft, updateDraft } = useRegisterForm();

  return (
    <div>
      <textarea
        style={{
          width: '100%',
          minHeight: '180px',
          padding: '10px 14px',
          fontSize: '13px',
          fontFamily: 'monospace',
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          outline: 'none',
          resize: 'vertical',
          color: C.text,
          backgroundColor: '#fff',
          boxSizing: 'border-box',
        }}
        value={sharedDraft.description}
        onChange={(e) => updateDraft({ description: e.target.value })}
        placeholder="상세 설명 (HTML 가능)"
      />
      <div style={{ fontSize: '11px', color: C.textSub, marginTop: '6px' }}>
        AI가 생성한 상세페이지 HTML이 이 영역에 자동 채워집니다. 직접 수정 가능.
      </div>
    </div>
  );
}
