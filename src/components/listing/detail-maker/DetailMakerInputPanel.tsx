'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { C } from '@/lib/design-tokens';
import CreativeBriefPanel from './CreativeBriefPanel';
import DetailMakerThumbnailPanel from './DetailMakerThumbnailPanel';
import type { TextBadgeOptions } from '@/lib/detail-page/thumbnail-flow';
import ImageCleanupModal from '@/components/common/ImageCleanupModal';

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
  onReplaceImage: (idx: number, newUrl: string) => void;
  onAddImage: (newUrl: string) => void;
  onReplaceExtraRef?: (idx: number, newUrl: string) => void;
  onAddExtraRef?: (newUrl: string) => void;
  onGenerate: () => void;
  suggestedMoodIds: string[];
  selectedMoodId: string | null;
  isSuggestingMood: boolean;
  onSelectMood: (id: string) => void;
  thumbnailRefUrls: string[];
  isGeneratingThumbnail: boolean;
  thumbnailError: string | null;
  onGenerateThumbnail: (direction: string, textBadge?: TextBadgeOptions) => void;
  thumbnailExtraUrls: string[];
  uploadingThumbnailRef: boolean;
  onUploadThumbnailRef: (files: FileList | File[]) => void;
  onRemoveThumbnailRef: (idx: number) => void;
  referenceText: string;
  setReferenceText: (v: string) => void;
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
  onReplaceImage,
  onAddImage,
  onReplaceExtraRef,
  onAddExtraRef,
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
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>('detail');
  const [showReferenceText, setShowReferenceText] = useState(false);
  const [cleanupTargetIdx, setCleanupTargetIdx] = useState<number | null>(null);
  const [watermarkTargetIdx, setWatermarkTargetIdx] = useState<number | null>(null);

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: C.text }}>
            상품상세 자동만들기
          </div>
          <Link
            href="/listing/new/detail-maker-pro"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              background: '#6366f1',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            ⚡ PRO 모드
          </Link>
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
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                    {uploadedUrls.map((url, idx) => (
                      <div key={url} style={{ position: 'relative' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url || undefined}
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
                        <button
                          onClick={() => setCleanupTargetIdx(idx)}
                          aria-label="한자 제거"
                          style={{
                            position: 'absolute',
                            bottom: '2px',
                            left: '2px',
                            background: 'rgba(0,0,0,0.6)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '10px',
                            padding: '2px 4px',
                            cursor: 'pointer',
                            lineHeight: 1,
                          }}
                        >
                          한자
                        </button>
                        <button
                          onClick={() => setWatermarkTargetIdx(idx)}
                          aria-label="워터마크 제거"
                          style={{
                            position: 'absolute',
                            bottom: '2px',
                            right: '2px',
                            background: 'rgba(0,0,0,0.6)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '10px',
                            padding: '2px 4px',
                            cursor: 'pointer',
                            lineHeight: 1,
                          }}
                        >
                          WM
                        </button>
                        {cleanupTargetIdx === idx && (
                          <ImageCleanupModal
                            imageUrl={url}
                            onReplace={newUrl => {
                              onReplaceImage(idx, newUrl);
                              setCleanupTargetIdx(null);
                            }}
                            onAdd={newUrl => {
                              onAddImage(newUrl);
                              setCleanupTargetIdx(null);
                            }}
                            onClose={() => setCleanupTargetIdx(null)}
                            canAdd={uploadedUrls.length < 10}
                          />
                        )}
                        {watermarkTargetIdx === idx && (
                          <ImageCleanupModal
                            imageUrl={url}
                            mode="watermark"
                            onReplace={newUrl => {
                              onReplaceImage(idx, newUrl);
                              setWatermarkTargetIdx(null);
                            }}
                            onAdd={newUrl => {
                              onAddImage(newUrl);
                              setWatermarkTargetIdx(null);
                            }}
                            onClose={() => setWatermarkTargetIdx(null)}
                            canAdd={uploadedUrls.length < 10}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                </>
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
              {isGenerating ? '✨ 기획 생성 중...' : '① 기획 생성'}
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
            onReplaceExtraRef={onReplaceExtraRef}
            onAddExtraRef={onAddExtraRef}
          />
        </div>
      )}
    </div>
  );
}
