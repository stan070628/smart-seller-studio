'use client';

import React, { useState, useEffect } from 'react';
import type { CropItem } from '@/store/useListingStore';

type SectionType = 'hero' | 'lifestyle' | 'detail' | 'feature';
const SECTION_LABELS: Record<SectionType, string> = {
  hero: '히어로',
  lifestyle: '라이프스타일',
  detail: '디테일',
  feature: '특징',
};

interface Props {
  crops: CropItem[];
  onConfirm: (crops: CropItem[]) => void;
  onCancel: () => void;
}

export default function SceneReviewPanel({ crops, onConfirm, onCancel }: Props) {
  // 부모가 pendingCrops 변경 시 조건부 렌더링으로 remount되므로 초기값만으로 충분
  const [editedCrops, setEditedCrops] = useState<CropItem[]>(crops);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedUrl) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedUrl(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedUrl]);

  const updateCrop = (id: string, patch: Partial<CropItem>) =>
    setEditedCrops(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));

  const removeCrop = (id: string) =>
    setEditedCrops(prev => prev.filter(c => c.id !== id));

  const handleFileChange = (id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = ev => updateCrop(id, { croppedImageUrl: ev.target?.result as string });
    reader.onerror = () => { /* 파일 읽기 실패 시 이미지 교체 취소 */ };
    reader.readAsDataURL(file);
  };

  return (
    <>
      {/* 확대 모달 */}
      {expandedUrl && (
        <div
          onClick={() => setExpandedUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expandedUrl}
            alt="확대 미리보기"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '90vw', maxHeight: '90vh',
              objectFit: 'contain', borderRadius: 8,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              cursor: 'default',
            }}
          />
          <button
            onClick={() => setExpandedUrl(null)}
            style={{
              position: 'absolute', top: 16, right: 20,
              background: 'rgba(255,255,255,0.15)', border: 'none',
              color: '#fff', fontSize: 22, lineHeight: 1, padding: '4px 10px',
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, backgroundColor: '#fafafa', marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#111' }}>씬 이미지 검토 — 사용할 영역을 확인해 주세요</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {editedCrops.map(crop => (
            <div key={crop.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' }}>
              {/* 이미지 영역 — 클릭 시 확대 */}
              <div style={{ position: 'relative', lineHeight: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={crop.croppedImageUrl}
                  alt={SECTION_LABELS[crop.sectionType] ?? crop.sectionType}
                  onClick={() => setExpandedUrl(crop.croppedImageUrl)}
                  style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
                />
                {/* 교체 버튼 */}
                <label
                  htmlFor={`crop-file-${crop.id}`}
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute', bottom: 4, right: 4,
                    background: 'rgba(0,0,0,0.55)', color: '#fff',
                    fontSize: 10, padding: '2px 6px', borderRadius: 4,
                    cursor: 'pointer', lineHeight: '1.4',
                  }}
                >
                  교체
                </label>
                <input
                  id={`crop-file-${crop.id}`}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(crop.id, f); }}
                />
              </div>
              <div style={{ padding: '8px 8px 10px' }}>
                <select
                  value={crop.sectionType}
                  onChange={e => updateCrop(crop.id, { sectionType: e.target.value as SectionType })}
                  style={{ width: '100%', fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 6, color: '#374151' }}
                >
                  {(Object.entries(SECTION_LABELS) as [SectionType, string][]).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeCrop(crop.id)}
                  style={{ width: '100%', fontSize: 11, padding: '3px 0', border: '1px solid #fca5a5', borderRadius: 4, backgroundColor: '#fff', color: '#dc2626', cursor: 'pointer' }}
                >
                  제외
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer', backgroundColor: '#fff', color: '#374151' }}
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(editedCrops)}
            disabled={editedCrops.length === 0}
            style={{ padding: '8px 18px', border: 'none', borderRadius: 6, fontSize: 13, cursor: editedCrops.length === 0 ? 'not-allowed' : 'pointer', backgroundColor: editedCrops.length === 0 ? '#93c5fd' : '#2563eb', color: '#fff', fontWeight: 600 }}
          >
            확인 — AI 씬 생성 시작
          </button>
        </div>
      </div>
    </>
  );
}
