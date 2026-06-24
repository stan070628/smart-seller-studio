'use client';

import React, { useRef, useState } from 'react';
import { C } from '@/lib/design-tokens';
import CreativeBriefPanel from './CreativeBriefPanel';
import DetailMakerThumbnailPanel from './DetailMakerThumbnailPanel';

type Category = 'basic' | 'fashion' | 'living' | 'food';
type Tab = 'detail' | 'thumbnail';

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
  suggestedMoodIds: string[];
  selectedMoodId: string | null;
  isSuggestingMood: boolean;
  onSelectMood: (id: string) => void;
  thumbnailRefUrls: string[];
  isGeneratingThumbnail: boolean;
  thumbnailError: string | null;
  onGenerateThumbnail: (direction: string) => void;
  thumbnailExtraUrls: string[];
  uploadingThumbnailRef: boolean;
  onUploadThumbnailRef: (files: FileList | File[]) => void;
  onRemoveThumbnailRef: (idx: number) => void;
  referenceText: string;
  setReferenceText: (v: string) => void;
  // 1688 스펙 가져오기
  url1688: string;
  setUrl1688: (v: string) => void;
  specs1688: Array<{ label: string; value: string; checked: boolean }>;
  onToggleSpec: (idx: number) => void;
  isFetching1688: boolean;
  onFetch1688: () => void;
  fetch1688Error: string | null;
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
  suggestedMoodIds,
  selectedMoodId,
  isSuggestingMood,
  onSelectMood,
  thumbnailRefUrls,
  isGeneratingThumbnail,
  thumbnailError,
  onGenerateThumbnail,
  thumbnailExtraUrls,
  uploadingThumbnailRef,
  onUploadThumbnailRef,
  onRemoveThumbnailRef,
  referenceText,
  setReferenceText,
  url1688,
  setUrl1688,
  specs1688,
  onToggleSpec,
  isFetching1688,
  onFetch1688,
  fetch1688Error,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>('detail');
  const [showReferenceText, setShowReferenceText] = useState(false);
  const [isOpen1688, setIsOpen1688] = useState(false);

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

      {/* 탭 토글 */}
      <div
        style={{
          display: 'flex',
          padding: '8px 16px',
          borderBottom: `1px solid ${C.border}`,
          gap: '4px',
        }}
      >
        {(['detail', 'thumbnail'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '7px 0',
              fontSize: '13px',
              fontWeight: activeTab === tab ? 700 : 400,
              border: 'none',
              borderRadius: '6px',
              background: activeTab === tab ? BRAND_PURPLE : 'transparent',
              color: activeTab === tab ? '#fff' : C.textSub,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {tab === 'detail' ? '상세페이지' : '썸네일'}
          </button>
        ))}
      </div>

      {/* ── 상세페이지 탭 ── */}
      {activeTab === 'detail' && (
        <>
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

            {/* 브랜드명 */}
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
                  ({uploadedUrls.length}/10, 권장 3장)
                </span>
              </label>

              {uploadedUrls.length < 10 && (
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

            {/* 무드 브리프 */}
            <CreativeBriefPanel
              suggestedMoodIds={suggestedMoodIds}
              selectedMoodId={selectedMoodId}
              isSuggesting={isSuggestingMood}
              onSelectMood={onSelectMood}
            />

            {/* 참고 텍스트 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowReferenceText(v => !v)}
                  style={{
                    fontSize: '12px',
                    color: BRAND_PURPLE,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontWeight: 600,
                  }}
                >
                  {showReferenceText ? '참고 텍스트 ▲' : '+ 참고 텍스트 추가'}
                </button>
                {showReferenceText && (
                  <button
                    type="button"
                    onClick={() => { setReferenceText(''); setShowReferenceText(false); }}
                    aria-label="참고 텍스트 초기화"
                    style={{
                      fontSize: '14px',
                      color: C.textSub,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0 2px',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {showReferenceText && (
                <div style={{ marginTop: '8px' }}>
                  <textarea
                    value={referenceText}
                    onChange={e => setReferenceText(e.target.value)}
                    placeholder="경쟁사 상세페이지, 제품 스펙, 셀링 포인트 등 참고할 내용을 자유롭게 입력하세요"
                    maxLength={3000}
                    rows={5}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      fontSize: '12px',
                      color: '#111827',
                      border: `1px solid ${C.border}`,
                      borderRadius: '8px',
                      resize: 'vertical',
                      outline: 'none',
                      lineHeight: 1.5,
                      boxSizing: 'border-box',
                      fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ textAlign: 'right', fontSize: '11px', color: C.textSub, marginTop: '2px' }}>
                    {referenceText.length}/3000
                  </div>
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

          {/* ─── 1688 스펙 가져오기 ───────────────────────────── */}
          <div style={{ padding: '0 16px', marginBottom: 12 }}>
            <button
              type="button"
              aria-label="1688 스펙 섹션 열기닫기"
              onClick={() => setIsOpen1688(v => !v)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '9px 12px',
                background: isOpen1688 ? '#eef2ff' : '#f9fafb',
                border: `1px solid ${isOpen1688 ? '#a5b4fc' : '#e5e7eb'}`,
                borderRadius: isOpen1688 ? '8px 8px 0 0' : 8,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                color: isOpen1688 ? '#3730a3' : '#374151',
              }}
            >
              <span>🔗 1688에서 스펙 가져오기</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{isOpen1688 ? '▲' : '▼'}</span>
            </button>

            {isOpen1688 && (
              <div
                style={{
                  border: '1px solid #a5b4fc',
                  borderTop: 'none',
                  borderRadius: '0 0 8px 8px',
                  padding: 12,
                  background: '#fff',
                }}
              >
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5 }}>
                  1688 상품 URL 붙여넣기
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    type="url"
                    value={url1688}
                    onChange={e => setUrl1688(e.target.value)}
                    placeholder="https://detail.1688.com/..."
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 12,
                      color: '#111',
                      outline: 'none',
                    }}
                    onKeyDown={e => { if (e.key === 'Enter' && !isFetching1688) onFetch1688(); }}
                  />
                  <button
                    type="button"
                    aria-label="가져오기"
                    onClick={onFetch1688}
                    disabled={isFetching1688}
                    style={{
                      padding: '6px 12px',
                      background: isFetching1688 ? '#e0e7ff' : '#6366f1',
                      color: isFetching1688 ? '#6366f1' : '#fff',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: isFetching1688 ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      fontWeight: 500,
                    }}
                  >
                    {isFetching1688 ? '가져오는 중...' : '가져오기'}
                  </button>
                </div>

                {fetch1688Error && (
                  <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 8, lineHeight: 1.5 }}>
                    {fetch1688Error}
                  </div>
                )}

                {specs1688.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      스펙 선택 ({specs1688.filter(s => s.checked).length}/{specs1688.length}개 선택)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {specs1688.map((spec, idx) => (
                        <label
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 7,
                            padding: '5px 6px',
                            background: spec.checked ? '#f0fdf4' : '#f9fafb',
                            borderRadius: 5,
                            cursor: 'pointer',
                            fontSize: 12,
                            opacity: spec.checked ? 1 : 0.6,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={spec.checked}
                            onChange={() => onToggleSpec(idx)}
                            style={{ marginTop: 2, cursor: 'pointer' }}
                          />
                          <div>
                            <span style={{ color: '#6b7280', fontSize: 11 }}>{spec.label}</span>
                            <br />
                            <span style={{ color: '#111', fontWeight: spec.checked ? 500 : 400 }}>
                              {spec.value}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6 }}>
                      체크된 항목만 상세페이지에 반영됩니다
                    </div>
                  </>
                )}
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
        </>
      )}

      {/* ── 썸네일 탭 ── */}
      {activeTab === 'thumbnail' && (
        <div style={{ padding: '16px', flex: 1 }}>
          <DetailMakerThumbnailPanel
            refImageUrls={thumbnailRefUrls}
            isGenerating={isGeneratingThumbnail}
            error={thumbnailError}
            onGenerate={onGenerateThumbnail}
            extraRefUrls={thumbnailExtraUrls}
            uploadingExtraRef={uploadingThumbnailRef}
            onUploadExtraRef={onUploadThumbnailRef}
            onRemoveExtraRef={onRemoveThumbnailRef}
          />
        </div>
      )}
    </div>
  );
}
