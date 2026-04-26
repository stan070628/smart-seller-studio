'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useRegisterForm } from '@/hooks/useRegisterForm';

const C = {
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  accent: '#be0014',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#18181b',
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

/**
 * KeywordsSection
 * BothRegisterForm의 태그 입력/추가/제거 영역을 분리한 컴포넌트
 */
export default function KeywordsSection() {
  const { sharedDraft, tagInput, setTagInput, addTag, removeTag } = useRegisterForm();

  return (
    <div>
      <label style={labelStyle}>태그 (쉼표 구분, 클릭으로 추가/제거)</label>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag(tagInput);
            }
          }}
          placeholder="예: 등산가방, 백팩, 경량 (Enter 또는 추가 버튼)"
        />
        <button
          type="button"
          onClick={() => addTag(tagInput)}
          style={{
            padding: '9px 16px', fontSize: '12px', fontWeight: 600,
            backgroundColor: C.btnSecondaryBg, color: C.btnSecondaryText,
            border: `1px solid ${C.border}`, borderRadius: '8px',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          추가
        </button>
      </div>
      {sharedDraft.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {sharedDraft.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => removeTag(tag)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '4px 10px', fontSize: '12px', fontWeight: 500,
                backgroundColor: 'rgba(190,0,20,0.07)', color: C.accent,
                border: '1px solid rgba(190,0,20,0.15)', borderRadius: '100px',
                cursor: 'pointer',
              }}
            >
              {tag}
              <X size={10} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
