'use client';

import React from 'react';
import { Download, Copy, Check } from 'lucide-react';
import type { TranslatedImage } from '@/lib/listing/import-1688-types';

const C = {
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#666666',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

// ─────────────────────────────────────────
// ImageWithToggle — 한국어/원본 토글 가능한 이미지 카드
// ─────────────────────────────────────────

interface ImageWithToggleProps {
  originalUrl: string;
  translatedUrl: string | null;
  alt: string;
  className?: string;
}

export function ImageWithToggle({
  originalUrl,
  translatedUrl,
  alt,
  className,
}: ImageWithToggleProps) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const src = translatedUrl && !showOriginal ? translatedUrl : originalUrl;
  const canToggle = translatedUrl !== null;

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <img
        src={src}
        alt={alt}
        className={className}
        data-original-src={originalUrl}
        style={{ width: '100%', display: 'block', borderRadius: 8 }}
      />
      {canToggle && (
        <button
          type="button"
          onClick={() => setShowOriginal((v) => !v)}
          aria-label={showOriginal ? '한국어로 보기' : '원본으로 보기'}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 999,
            border: 'none',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {showOriginal ? '🇰🇷 한국어' : '🇨🇳 원본'}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// ResultPreview
// ─────────────────────────────────────────

interface Props {
  thumbnailUrl: string;
  detailPageHtml: string;
  /** 1688 번역 결과. 있으면 "이미지 번역 검수" 섹션 표시. */
  translatedImages?: TranslatedImage[];
}

export default function ResultPreview({
  thumbnailUrl,
  detailPageHtml,
  translatedImages,
}: Props) {
  const [copied, setCopied] = React.useState(false);

  function handleDownloadThumbnail() {
    try {
      const url = new URL(thumbnailUrl);
      if (url.protocol !== 'https:') return;
      const a = document.createElement('a');
      a.href = thumbnailUrl;
      a.download = 'thumbnail.jpg';
      a.click();
    } catch {
      // invalid URL
    }
  }

  async function handleCopyHtml() {
    await navigator.clipboard.writeText(detailPageHtml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const translatedToShow = (translatedImages ?? []).filter(
    (i) => i.translationStatus !== 'skipped'
  );

  return (
    <div style={{ padding: '24px 20px', maxWidth: 780, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 700, color: C.text }}>
        생성 결과
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: C.text }}>
            썸네일 (500×500)
          </p>
          <img
            src={thumbnailUrl}
            alt="생성된 썸네일"
            style={{ width: '100%', maxWidth: 500, border: `1px solid ${C.border}`, borderRadius: 8 }}
          />
          <button
            onClick={handleDownloadThumbnail}
            style={{
              marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: C.btnPrimaryBg, color: C.btnPrimaryText,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Download size={14} />
            썸네일 JPG 다운로드
          </button>
        </div>

        <div>
          <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: C.text }}>
            상세페이지 미리보기
          </p>
          <div style={{
            border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden',
            height: 500,
          }}>
            <iframe
              srcDoc={detailPageHtml}
              sandbox="allow-same-origin"
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="상세페이지 미리보기"
            />
          </div>
          <button
            onClick={handleCopyHtml}
            style={{
              marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 20px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.btnSecondaryBg, color: C.btnSecondaryText,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '복사됨!' : '상세페이지 HTML 복사'}
          </button>
        </div>
      </div>

      {translatedToShow.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: C.text }}>
            이미지 번역 검수 ({translatedToShow.length}장)
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: C.textSub }}>
            번역이 어색한 이미지는 토글로 원본을 확인할 수 있습니다.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
          }}>
            {translatedToShow.map((img, idx) => (
              <ImageWithToggle
                key={img.url + idx}
                originalUrl={img.url}
                translatedUrl={img.translatedUrl}
                alt={`이미지 ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
