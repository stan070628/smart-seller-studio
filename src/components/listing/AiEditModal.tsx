'use client';

/**
 * AiEditModal.tsx
 * 이미지 AI 편집 모달
 * - File이 있으면 먼저 /api/listing/upload-image로 업로드해 공개 URL 확보
 * - /api/ai/edit-thumbnail로 AI 편집 실행
 * - 결과 미리보기 후 "이 이미지로 저장" 클릭 시 onSave(resultUrl) 호출
 */

import { useState, useEffect } from 'react';
import { C } from '@/lib/design-tokens';
import { X, Wand2, Loader2 } from 'lucide-react';

// 빠른 프롬프트 선택지 — 모두 쿠팡 가이드라인(흰배경/85%/중앙/텍스트 금지) 강제
const QUICK_PROMPTS = [
  {
    label: '흰 배경',
    prompt:
      'Replace the background with pure white (#FFFFFF). Reframe and zoom so the product is centered and fills at least 85% of the image width or height (whichever is larger). Square 1:1 framing. Keep the product unchanged. Add only a small soft shadow under the product. No text, no logo, no badge, no people.',
  },
  {
    label: '자연광',
    prompt:
      'Soft natural daylight on a clean light background. Center the product so it fills at least 85% of the frame, square 1:1. Small natural shadow under the product. No text, no logo, no badge, no people.',
  },
  {
    label: '옅은 그라데이션',
    prompt:
      'Subtle very-light-gray gradient background (#F2F2F2 to #FFFFFF). Product centered and filling at least 85% of the frame, square 1:1. Soft studio lighting with a small shadow. No text, no logo, no badge, no people.',
  },
  {
    label: '디테일 강조',
    prompt:
      'Same product on a pure white (#FFFFFF) background, centered, filling at least 85% of the frame in square 1:1 framing. Sharpen product details and texture but do not crop the product itself. No text, no logo, no badge, no people.',
  },
];

interface AiEditModalProps {
  imageUrl: string;           // blob URL 또는 공개 URL
  imageFile: File | null;     // 업로드할 File (blob URL인 경우)
  onClose: () => void;
  onSave: (resultUrl: string) => void;
  initialPrompt?: string;     // 인라인 입력창에서 미리 입력된 프롬프트
}

export default function AiEditModal({ imageUrl, imageFile, onClose, onSave, initialPrompt }: AiEditModalProps) {
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 모달 열릴 때 File이면 먼저 업로드해서 공개 URL 확보
  useEffect(() => {
    if (!imageFile) {
      // 이미 공개 URL인 경우
      if (!imageUrl.startsWith('blob:')) {
        setPublicUrl(imageUrl);
      }
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append('file', imageFile);
    formData.append('usageContext', 'listing_thumbnail');
    fetch('/api/listing/upload-image', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.url) {
          setPublicUrl(json.data.url);
        } else {
          setError('이미지 업로드 실패. 다시 시도해주세요.');
        }
      })
      .catch(() => setError('업로드 오류가 발생했습니다.'))
      .finally(() => setUploading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEdit = async () => {
    if (!publicUrl || !prompt.trim() || editing) return;
    setEditing(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/edit-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: publicUrl, prompt }),
      });
      const json = await res.json();
      if (!res.ok || !json.data?.editedUrl) throw new Error(json.error ?? 'AI 편집 실패');
      setResultUrl(json.data.editedUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 편집 중 오류가 발생했습니다.');
    } finally {
      setEditing(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '740px',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wand2 size={18} color={C.accent} />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: C.text }}>AI 이미지 편집</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub }}>
            <X size={20} />
          </button>
        </div>

        {/* 본문 2컬럼 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', padding: '20px 24px' }}>
          {/* 왼쪽: 원본 + 편집 설정 */}
          <div>
            <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>원본 이미지</p>
            <div
              style={{
                borderRadius: '10px',
                overflow: 'hidden',
                border: `1px solid ${C.border}`,
                marginBottom: '16px',
                position: 'relative',
                height: '180px',
                backgroundColor: C.tableHeader,
              }}
            >
              {uploading ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Loader2 size={24} color={C.textSub} style={{ animation: 'spin 1s linear infinite' }} />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              )}
            </div>

            <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>편집 프롬프트</p>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="예: 흰색 배경으로 변경하고 자연스러운 조명 적용"
              rows={3}
              style={{
                width: '100%',
                padding: '9px 12px',
                fontSize: '13px',
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
                color: C.text,
              }}
            />

            <p style={{ margin: '10px 0 6px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>빠른 선택</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {QUICK_PROMPTS.map(q => (
                <button
                  key={q.label}
                  onClick={() => setPrompt(q.prompt)}
                  style={{
                    padding: '5px 10px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: `1px solid ${C.border}`,
                    backgroundColor: prompt === q.prompt ? C.accent : '#fff',
                    color: prompt === q.prompt ? '#fff' : C.text,
                    cursor: 'pointer',
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* 오른쪽: 편집 결과 미리보기 */}
          <div>
            <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>편집 결과</p>
            <div
              style={{
                borderRadius: '10px',
                overflow: 'hidden',
                border: `1px solid ${C.border}`,
                height: '180px',
                backgroundColor: C.tableHeader,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                marginBottom: '16px',
              }}
            >
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <Loader2 size={24} color={C.accent} style={{ animation: 'spin 1s linear infinite' }} />
                  <span style={{ fontSize: '12px', color: C.textSub }}>AI 편집 중...</span>
                </div>
              ) : resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resultUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ fontSize: '12px', color: C.textSub }}>편집 결과가 여기에 표시됩니다</span>
              )}
            </div>
            {error && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#fee2e2',
                  color: '#b91c1c',
                  fontSize: '12px',
                  marginBottom: '12px',
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>

        {/* 하단 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '0 24px 20px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 20px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: C.tableHeader,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={handleEdit}
            disabled={!publicUrl || !prompt.trim() || editing || uploading}
            style={{
              padding: '9px 20px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: (!publicUrl || !prompt.trim() || editing || uploading) ? '#ccc' : C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: (!publicUrl || !prompt.trim() || editing || uploading) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Wand2 size={14} />
            AI 편집 실행
          </button>
          {resultUrl && (
            <button
              onClick={() => onSave(resultUrl)}
              style={{
                padding: '9px 20px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: '#15803d',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              이 이미지로 저장
            </button>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
