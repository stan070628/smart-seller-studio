'use client';

import React from 'react';
import { Download, Copy, Check } from 'lucide-react';

const C = {
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#666666',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

interface Props {
  thumbnailUrl: string;
  detailPageHtml: string;
}

export default function ResultPreview({ thumbnailUrl, detailPageHtml }: Props) {
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
    </div>
  );
}
