'use client';

import React from 'react';
import ImageInputSection from '@/components/listing/ImageInputSection';
import { useRegisterForm } from '@/hooks/useRegisterForm';

const C = {
  textSub: '#71717a',
} as const;

export default function ImagesSection() {
  const { sharedDraft, updateDraft, errors, setErrors } = useRegisterForm();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 썸네일 이미지 섹션 */}
      <ImageInputSection
        label="상품 이미지 (썸네일)"
        required
        maxCount={10}
        urls={sharedDraft.thumbnailImages}
        onUrlsChange={(urls) => {
          updateDraft({ thumbnailImages: urls });
          if (errors.images) setErrors((prev) => ({ ...prev, images: '' }));
        }}
        usageContext="listing_thumbnail"
        error={errors.images}
      />

      {/* 상세페이지 이미지 섹션 */}
      <div style={{ marginTop: '4px' }}>
        <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '6px' }}>
          상세페이지 이미지는 상품 상세설명 하단에 자동 삽입됩니다.
        </div>
        <ImageInputSection
          label="상세페이지 이미지"
          maxCount={20}
          urls={sharedDraft.detailImages}
          onUrlsChange={(urls) => updateDraft({ detailImages: urls })}
          usageContext="listing_detail"
        />
      </div>
    </div>
  );
}
