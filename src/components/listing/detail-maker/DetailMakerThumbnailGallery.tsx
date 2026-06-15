'use client';

import React, { useState } from 'react';
import { Download, Trash2, Wand2, Loader2 } from 'lucide-react';
import { C } from '@/lib/design-tokens';

interface Props {
  thumbnails: string[];
  editingUrl: string | null;
  onDownload: (url: string) => void;
  onRemove: (url: string) => void;
  onEdit: (url: string, prompt: string) => void;
}

export default function DetailMakerThumbnailGallery({
  thumbnails,
  editingUrl,
  onDownload,
  onRemove,
  onEdit,
}: Props) {
  const [editTargetUrl, setEditTargetUrl] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');

  function startEdit(url: string) {
    setEditTargetUrl(url);
    setEditPrompt('');
  }

  function applyEdit(url: string) {
    if (editPrompt.trim().length === 0) return;
    onEdit(url, editPrompt.trim());
    setEditTargetUrl(null);
    setEditPrompt('');
  }

  return (
    <div style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: C.card }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
        생성된 썸네일 ({thumbnails.length})
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 12,
        }}
      >
        {thumbnails.map((url) => {
          const isEditing = editingUrl === url;
          return (
            <div
              key={url}
              style={{
                position: 'relative',
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                overflow: 'hidden',
                background: '#fff',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="생성된 썸네일"
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  objectFit: 'cover',
                  display: 'block',
                  opacity: isEditing ? 0.5 : 1,
                }}
              />

              {/* AI 수정 진행 중 오버레이 */}
              {isEditing && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    background: 'rgba(255,255,255,0.6)',
                    fontSize: 12,
                    color: C.text,
                    fontWeight: 600,
                  }}
                >
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  수정 중...
                </div>
              )}

              {/* 인라인 수정 입력 폼 */}
              {editTargetUrl === url ? (
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="수정 지시 예: 배경 밝게"
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 11,
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      color: '#111',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => applyEdit(url)}
                      style={{
                        flex: 1,
                        padding: '6px',
                        fontSize: 11,
                        fontWeight: 700,
                        border: 'none',
                        borderRadius: 6,
                        background: '#be0014',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      적용
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTargetUrl(null)}
                      style={{
                        flex: 1,
                        padding: '6px',
                        fontSize: 11,
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        background: '#fff',
                        color: C.textSub,
                        cursor: 'pointer',
                      }}
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                /* 기본 액션 버튼 행 */
                <div style={{ display: 'flex', gap: 4, padding: 8 }}>
                  <button
                    type="button"
                    aria-label="다운로드"
                    onClick={() => onDownload(url)}
                    title="다운로드"
                    style={iconBtn}
                  >
                    <Download size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="AI 수정"
                    onClick={() => startEdit(url)}
                    title="AI 수정"
                    disabled={isEditing}
                    style={iconBtn}
                  >
                    <Wand2 size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="삭제"
                    onClick={() => onRemove(url)}
                    title="삭제"
                    style={{ ...iconBtn, marginLeft: 'auto', color: '#dc2626' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
};
