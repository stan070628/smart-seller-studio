'use client';

import React, { useState } from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  fontSize: '14px',
  border: `1px solid ${C.border}`,
  borderRadius: '10px',
  outline: 'none',
  color: C.text,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

function isValidHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function Step1SourceSelect() {
  const { sharedDraft, updateSharedDraft, goNextStep } = useListingStore();
  const [url, setUrl] = useState<string>(
    sharedDraft.name && /^https?:/.test(sharedDraft.name) ? sharedDraft.name : ''
  );
  const [error, setError] = useState<string | null>(null);

  const canSubmit = url.trim().length > 0;

  const handleSubmit = () => {
    setError(null);
    if (!canSubmit) return;
    if (!isValidHttpUrl(url.trim())) {
      setError('올바른 URL 형식이 아닙니다 (http:// 또는 https://로 시작해야 합니다).');
      return;
    }
    updateSharedDraft({ name: url.trim() });
    goNextStep();
  };

  return (
    <div style={{
      maxWidth: '720px',
      margin: '40px auto',
      padding: '32px',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
    }}>
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: C.text }}>
          상품 URL 입력
        </h2>
        <p style={{ fontSize: '13px', color: C.textSub, margin: '6px 0 0' }}>
          상품 페이지 URL을 붙여넣으세요. 도매꾹·쿠팡·코스트코 등의 URL을 자동으로 인식합니다.
        </p>
      </div>

      <input
        type="url"
        style={inputStyle}
        value={url}
        onChange={(e) => { setUrl(e.target.value); setError(null); }}
        placeholder="https://"
        autoFocus
      />

      {error && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#fee2e2',
          color: '#b91c1c',
          fontSize: '13px',
          borderRadius: '8px',
        }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          padding: '12px 20px',
          fontSize: '14px',
          fontWeight: 700,
          backgroundColor: canSubmit ? C.accent : C.border,
          color: canSubmit ? '#fff' : C.textSub,
          border: 'none',
          borderRadius: '10px',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        자동 처리 시작
      </button>
    </div>
  );
}
