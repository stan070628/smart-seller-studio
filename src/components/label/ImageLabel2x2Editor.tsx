'use client';

import { useState, useRef } from 'react';
import ImageLabel2x2Preview from './ImageLabel2x2Preview';
import { generatePdf, printLabel } from '@/lib/label/label-pdf';

const C = { border: '#e5e7eb', bg: '#f9fafb' };

const SECTION_TITLE: React.CSSProperties = {
  fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#374151',
};
const SECTION: React.CSSProperties = { marginBottom: 16 };

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '6px 8px',
  border: '1px solid #d1d5db', borderRadius: 4,
  fontSize: 12, boxSizing: 'border-box' as const,
  background: '#fff', color: '#111',
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: 'none',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff',
};

export default function ImageLabel2x2Editor() {
  const [imageUrl, setImageUrl] = useState('');
  const [footerText, setFooterText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeImage = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX_PX = 1400;
        let { naturalWidth: w, naturalHeight: h } = img;
        if (w > MAX_PX || h > MAX_PX) {
          if (w >= h) { h = Math.round((h * MAX_PX) / w); w = MAX_PX; }
          else { w = Math.round((w * MAX_PX) / h); h = MAX_PX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('변환 실패')), 'image/jpeg', 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')); };
      img.src = url;
    });

  const handleImageFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const uploadBlob = file.size > 3 * 1024 * 1024 ? await resizeImage(file) : file;
      const fd = new FormData();
      fd.append('file', new File([uploadBlob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
      const res = await fetch('/api/label/upload-image', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (json.success) {
        setImageUrl(json.data.url);
      } else {
        setUploadError(
          res.status === 401
            ? '로그인이 필요합니다. 다시 로그인 후 시도해주세요.'
            : json.error ?? '이미지 업로드에 실패했습니다.',
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handlePdf = async () => { if (previewRef.current) await generatePdf(previewRef.current); };
  const handlePrint = () => { if (previewRef.current) printLabel(previewRef.current); };

  return (
    <>
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          body * { visibility: hidden; }
          #image-label-2x2-preview, #image-label-2x2-preview * { visibility: visible; }
          #image-label-2x2-preview { position: fixed; top: 0; left: 0; margin: 0; }
          @page { margin: 0; size: A4; }
        }
      `}</style>

      <div style={{ display: 'flex', height: '100%', background: C.bg }}>
        {/* 좌측 폼 */}
        <div style={{
          width: 300, flexShrink: 0,
          background: '#fff', color: '#111', colorScheme: 'light',
          borderRight: `1px solid ${C.border}`,
          padding: 16, overflowY: 'auto',
        }}>
          <div style={SECTION}>
            <div style={SECTION_TITLE}>제품 이미지</div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              style={{
                border: '2px dashed #d1d5db', borderRadius: 6, padding: 16,
                textAlign: 'center', cursor: 'pointer', fontSize: 12, color: '#6b7280',
              }}
            >
              {uploading ? '업로드 중...' : imageUrl ? '이미지 변경' : '클릭하여 이미지 선택 (PNG/JPG)'}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
            />
            {uploadError && <p style={{ fontSize: 11, color: '#dc2626', margin: '6px 0 0' }}>{uploadError}</p>}
            {imageUrl && (
              <img src={imageUrl} alt="미리보기" style={{ marginTop: 8, maxWidth: '100%', maxHeight: 80, objectFit: 'contain' }} />
            )}
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>하단 텍스트 (제품명 / 바코드)</div>
            <input
              style={INPUT_STYLE}
              placeholder="예: 제품명 / 바코드번호"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
            />
          </div>
        </div>

        {/* 우측 미리보기 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
            background: '#fff', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>
              미리보기 — A4 · 2×2 (이미지 라벨)
            </span>
            <button style={{ ...BTN_PRIMARY, background: '#6366f1' }} onClick={handlePdf}>⬇ PDF 저장</button>
            <button style={{ ...BTN_PRIMARY, background: '#059669' }} onClick={handlePrint}>🖨 바로 인쇄</button>
          </div>

          <div style={{
            flex: 1, overflow: 'auto', padding: 20,
            background: '#e5e7eb', display: 'flex', justifyContent: 'center',
          }}>
            <ImageLabel2x2Preview ref={previewRef} imageUrl={imageUrl} footerText={footerText} />
          </div>
        </div>
      </div>
    </>
  );
}
