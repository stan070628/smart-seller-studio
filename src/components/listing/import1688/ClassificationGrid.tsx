'use client';

import React from 'react';
import { Loader2, Star } from 'lucide-react';
import type { ClassifiedImage, ImageClassificationType } from '@/lib/listing/import-1688-types';

const C = {
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#666666',
  accent: '#be0014',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

const TYPE_LABELS: Record<ImageClassificationType, string> = {
  main_product: '주력컷',
  lifestyle: '라이프스타일',
  infographic: '인포그래픽',
  size_chart: '사이즈표',
};

const TYPE_COLORS: Record<ImageClassificationType, string> = {
  main_product: '#be0014',
  lifestyle: '#0066cc',
  infographic: '#6600cc',
  size_chart: '#00884b',
};

interface Props {
  images: ClassifiedImage[];
  thumbnailUrl: string;
  onThumbnailChange: (url: string) => void;
  onGenerate: () => void;
  generating: boolean;
}

export default function ClassificationGrid({
  images,
  thumbnailUrl,
  onThumbnailChange,
  onGenerate,
  generating,
}: Props) {
  return (
    <div style={{ padding: '24px 20px', maxWidth: 780, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: C.text }}>
        이미지 분류 결과
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: C.textSub }}>
        ★ 표시된 이미지가 썸네일 후보입니다. 다른 이미지의 &quot;썸네일로 설정&quot; 버튼으로 변경할 수 있습니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {images.map((img) => {
          const isThumb = img.url === thumbnailUrl;
          return (
            <div
              key={img.url}
              style={{
                border: `2px solid ${isThumb ? C.accent : C.border}`,
                borderRadius: 12,
                overflow: 'hidden',
                background: '#fff',
                position: 'relative',
              }}
            >
              {isThumb && (
                <div style={{
                  position: 'absolute', top: 6, right: 6,
                  background: C.accent, borderRadius: '50%', padding: 4,
                }}>
                  <Star size={12} color="#fff" fill="#fff" />
                </div>
              )}
              <img
                src={img.url}
                alt=""
                loading="lazy"
                style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
              />
              <div style={{ padding: '8px 10px' }}>
                <span style={{
                  display: 'inline-block',
                  fontSize: 11, fontWeight: 600,
                  color: '#fff',
                  background: TYPE_COLORS[img.type],
                  borderRadius: 4, padding: '2px 6px',
                  marginBottom: 6,
                }}>
                  {TYPE_LABELS[img.type]}
                </span>
                {!isThumb && (
                  <button
                    onClick={() => onThumbnailChange(img.url)}
                    style={{
                      display: 'block', width: '100%', fontSize: 11,
                      padding: '4px 0', borderRadius: 6, border: `1px solid ${C.border}`,
                      background: C.btnSecondaryBg, color: C.btnSecondaryText,
                      cursor: 'pointer',
                    }}
                  >
                    썸네일로 설정
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 32, textAlign: 'right' }}>
        <button
          onClick={onGenerate}
          disabled={generating}
          style={{
            padding: '12px 28px', borderRadius: 8, border: 'none',
            background: generating ? '#ccc' : C.btnPrimaryBg,
            color: C.btnPrimaryText, fontSize: 15, fontWeight: 700,
            cursor: generating ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}
        >
          {generating && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
          {generating ? '생성 중...' : '한국어 콘텐츠 생성'}
        </button>
      </div>
    </div>
  );
}
