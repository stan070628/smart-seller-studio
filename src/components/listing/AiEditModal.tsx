'use client';

/**
 * AiEditModal.tsx
 * 이미지 AI 편집 모달
 * - File이 있으면 먼저 /api/listing/upload-image로 업로드해 공개 URL 확보
 * - /api/ai/edit-thumbnail로 AI 편집 실행
 * - 결과 미리보기 후 "이 이미지로 저장" 클릭 시 onSave(resultUrl) 호출
 */

import { useEffect, useMemo, useState } from 'react';
import { C } from '@/lib/design-tokens';
import { X, Wand2, Loader2, AlertTriangle } from 'lucide-react';
import { detectCoupangPolicyViolations } from '@/lib/ai/prompts/coupang-image-guide';

// 단일 이미지 편집 — 빠른 프롬프트 (쿠팡 가이드라인 강제)
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

// 두 이미지 합치기 — 빠른 프롬프트 (쿠팡 가이드라인 강제)
const MERGE_QUICK_PROMPTS = [
  {
    label: '나란히 배치',
    prompt:
      'Place both products side by side on a pure white (#FFFFFF) background, centered as a single composition that fills at least 85% of the frame, square 1:1 framing. Keep both products unchanged. Soft shadow under each product. No text, no logo, no badge, no people.',
  },
  {
    label: '메인 + 부속',
    prompt:
      'Compose a single product photo: place the first image as the main product in the center and the second image as a smaller accessory/companion next to it, both on a pure white (#FFFFFF) background, square 1:1, filling at least 85% of the frame. Keep both products unchanged. No text, no logo, no badge, no people.',
  },
  {
    label: '겹쳐 배치',
    prompt:
      'Combine the two products into one natural-looking composition with subtle overlap, on a pure white (#FFFFFF) background, centered, square 1:1, filling at least 85% of the frame. Keep both products unchanged. Small soft shadow. No text, no logo, no badge, no people.',
  },
  {
    label: '자연스럽게 한 컷',
    prompt:
      'Merge both products into a single, cohesive product photo as if they were photographed together. Pure white (#FFFFFF) background, centered, square 1:1, filling at least 85% of the frame. Keep both products unchanged. No text, no logo, no badge, no people.',
  },
];

interface AiEditModalProps {
  imageUrl: string;           // blob URL 또는 공개 URL (필수, 첫 번째 이미지)
  imageFile: File | null;     // 업로드할 File (blob URL인 경우)
  imageUrl2?: string;         // 합치기 모드일 때 두 번째 이미지 (공개 URL이라 가정)
  onClose: () => void;
  onSave: (resultUrl: string) => void;
  initialPrompt?: string;     // 인라인 입력창에서 미리 입력된 프롬프트
}

export default function AiEditModal({ imageUrl, imageFile, imageUrl2, onClose, onSave, initialPrompt }: AiEditModalProps) {
  const isMergeMode = Boolean(imageUrl2);
  const quickPrompts = isMergeMode ? MERGE_QUICK_PROMPTS : QUICK_PROMPTS;
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 사용자 프롬프트가 쿠팡 가이드라인 위반 의도를 포함하는지 실시간 감지
  const violations = useMemo(() => detectCoupangPolicyViolations(prompt), [prompt]);

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
        body: JSON.stringify({
          imageUrl: publicUrl,
          ...(imageUrl2 ? { imageUrl2 } : {}),
          prompt,
        }),
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
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: C.text }}>
              {isMergeMode ? 'AI로 두 이미지 합치기' : 'AI 이미지 편집'}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub }}>
            <X size={20} />
          </button>
        </div>

        {/* 본문 2컬럼 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', padding: '20px 24px' }}>
          {/* 왼쪽: 원본 + 편집 설정 */}
          <div>
            <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>
              {isMergeMode ? '원본 이미지 (왼쪽 → 오른쪽)' : '원본 이미지'}
            </p>
            <div
              style={{
                display: isMergeMode ? 'grid' : 'block',
                gridTemplateColumns: isMergeMode ? '1fr 1fr' : undefined,
                gap: isMergeMode ? '8px' : undefined,
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  borderRadius: '10px',
                  overflow: 'hidden',
                  border: `1px solid ${C.border}`,
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
              {isMergeMode && imageUrl2 && (
                <div
                  style={{
                    borderRadius: '10px',
                    overflow: 'hidden',
                    border: `1px solid ${C.border}`,
                    position: 'relative',
                    height: '180px',
                    backgroundColor: C.tableHeader,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl2} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
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

            {violations.length > 0 && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '10px 12px',
                  border: '1px solid #fbbf24',
                  backgroundColor: '#fffbeb',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#92400e',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                  <AlertTriangle size={13} /> 쿠팡 가이드라인 위반 가능 항목
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {violations.map((v) => (
                    <li key={v.category}>{v.hint}</li>
                  ))}
                </ul>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#b45309' }}>
                  AI가 이 지시를 무시하고 정책 준수 결과를 만들 수 있습니다. 결과를 확인 후 저장해 주세요.
                </p>
              </div>
            )}

            <p style={{ margin: '10px 0 6px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>빠른 선택</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {quickPrompts.map(q => (
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
            {isMergeMode ? 'AI 합치기 실행' : 'AI 편집 실행'}
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
