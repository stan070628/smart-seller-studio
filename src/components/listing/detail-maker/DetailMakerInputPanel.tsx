'use client';

import React, { useRef } from 'react';
import { C } from '@/lib/design-tokens';

type Category = 'basic' | 'fashion' | 'living' | 'food';

const BRAND_PURPLE = '#7c3aed';

const CATEGORY_LABELS: Record<Category, string> = {
  basic: '기본',
  fashion: '패션',
  living: '리빙',
  food: '식품',
};

interface Props {
  productName: string;
  setProductName: (v: string) => void;
  brandName: string;
  setBrandName: (v: string) => void;
  category: Category;
  setCategory: (v: Category) => void;
  uploadedUrls: string[];
  uploading: boolean;
  isGenerating: boolean;
  error: string | null;
  onUploadFiles: (files: FileList | File[]) => void;
  onRemoveImage: (idx: number) => void;
  onGenerate: () => void;
}

export default function DetailMakerInputPanel({
  productName,
  setProductName,
  brandName,
  setBrandName,
  category,
  setCategory,
  uploadedUrls,
  uploading,
  isGenerating,
  error,
  onUploadFiles,
  onRemoveImage,
  onGenerate,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canGenerate = !isGenerating && productName.trim().length > 0 && uploadedUrls.length > 0;

  return (
    <div
      style={{
        width: '300px',
        minWidth: '300px',
        height: '100%',
        borderRight: `1px solid ${C.border}`,
        background: C.card,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          padding: '20px 16px 12px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 700, color: C.text }}>
          상품상세 자동만들기
        </div>
        <div style={{ fontSize: '12px', color: C.textSub, marginTop: '4px' }}>
          상품명 + 이미지로 1분 만에 상세페이지 생성
        </div>
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
        {/* 상품명 */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
            상품명 <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            value={productName}
            onChange={e => setProductName(e.target.value)}
            placeholder="예) 나이키 에어맥스 런닝화 270"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '13px',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              background: '#fff',
              color: '#111',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* 카테고리 */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
            카테고리
          </label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  borderRadius: '20px',
                  border: category === cat ? `1.5px solid ${BRAND_PURPLE}` : `1px solid ${C.border}`,
                  background: category === cat ? '#f5f3ff' : '#fff',
                  color: category === cat ? BRAND_PURPLE : C.text,
                  cursor: 'pointer',
                  fontWeight: category === cat ? 600 : 400,
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* 브랜드명 (선택) */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
            브랜드명 <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 400 }}>(선택)</span>
          </label>
          <input
            type="text"
            value={brandName}
            onChange={e => setBrandName(e.target.value)}
            placeholder="예) 나이키"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '13px',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              background: '#fff',
              color: '#111',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* 참고 이미지 */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
            참고 이미지 <span style={{ color: '#ef4444' }}>*</span>{' '}
            <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 400 }}>
              ({uploadedUrls.length}/6, 권장 3장)
            </span>
          </label>

          {/* 업로드 영역 */}
          {uploadedUrls.length < 6 && (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${C.border}`,
                borderRadius: '8px',
                padding: '20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: '#fafafa',
                marginBottom: uploadedUrls.length > 0 ? '10px' : undefined,
              }}
            >
              {uploading ? (
                <div style={{ fontSize: '13px', color: C.textSub }}>업로드 중...</div>
              ) : (
                <>
                  <div style={{ fontSize: '24px', marginBottom: '4px' }}>📷</div>
                  <div style={{ fontSize: '12px', color: C.textSub }}>
                    클릭하여 이미지 선택
                    <br />
                    JPG, PNG, WebP · 최대 10MB
                  </div>
                </>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files) onUploadFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {/* 업로드된 이미지 썸네일 */}
          {uploadedUrls.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {uploadedUrls.map((url, idx) => (
                <div key={url} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`참고 이미지 ${idx + 1}`}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      border: `1px solid ${C.border}`,
                    }}
                  />
                  <button
                    onClick={() => onRemoveImage(idx)}
                    style={{
                      position: 'absolute',
                      top: '2px',
                      right: '2px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 에러 */}
        {error && (
          <div
            style={{
              padding: '10px 12px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#dc2626',
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* 생성 버튼 (하단 고정) */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '14px',
            fontWeight: 700,
            borderRadius: '8px',
            border: 'none',
            background: canGenerate ? BRAND_PURPLE : C.border,
            color: canGenerate ? '#fff' : C.textSub,
            cursor: canGenerate ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          {isGenerating ? '✨ 생성 중...' : '✨ AI 상세페이지 생성'}
        </button>
        {!productName.trim() && (
          <div style={{ fontSize: '11px', color: C.textSub, textAlign: 'center', marginTop: '6px' }}>
            상품명을 입력하세요
          </div>
        )}
        {productName.trim() && uploadedUrls.length === 0 && (
          <div style={{ fontSize: '11px', color: C.textSub, textAlign: 'center', marginTop: '6px' }}>
            이미지를 1장 이상 업로드하세요
          </div>
        )}
      </div>
    </div>
  );
}
