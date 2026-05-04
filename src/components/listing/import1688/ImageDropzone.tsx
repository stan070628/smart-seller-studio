'use client';

import React, { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';

const C = {
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#666666',
  accent: '#be0014',
  bg: '#f9f9f9',
};

interface Props {
  onUploaded: (urls: string[]) => void;
}

const MAX_FILES = 20;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function ImageDropzone({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (uploading) return;
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files).filter((f) => ALLOWED_TYPES.includes(f.type));
    if (fileArr.length === 0) {
      setError('JPG, PNG, WebP 파일만 업로드 가능합니다.');
      return;
    }
    if (fileArr.length > MAX_FILES) {
      setError(`최대 ${MAX_FILES}장까지 업로드 가능합니다.`);
      return;
    }
    setError(null);
    setUploading(true);

    try {
      const urls: string[] = [];
      for (const file of fileArr) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('usageContext', 'listing_detail');
        const res = await fetch('/api/listing/upload-image', {
          method: 'POST',
          body: formData,
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? '업로드 실패');
        urls.push(json.data.url);
      }
      onUploaded(urls);
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px' }}>
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${dragOver ? C.accent : C.border}`,
          borderRadius: 16,
          padding: '60px 32px',
          textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: dragOver ? '#fff5f5' : C.bg,
          transition: 'all 0.15s',
        }}
      >
        {uploading ? (
          <Loader2 size={40} style={{ color: C.accent, margin: '0 auto 16px', display: 'block', animation: 'spin 1s linear infinite' }} />
        ) : (
          <Upload size={40} style={{ color: C.textSub, margin: '0 auto 16px', display: 'block' }} />
        )}
        <p style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: C.text }}>
          {uploading ? '업로드 중...' : '이미지를 여기에 드래그하거나 클릭해서 업로드'}
        </p>
        <p style={{ margin: 0, fontSize: 13, color: C.textSub }}>
          JPG / PNG / WebP, 최대 {MAX_FILES}장
        </p>
      </div>
      {error && (
        <p style={{ marginTop: 12, color: C.accent, fontSize: 13, textAlign: 'center' }}>{error}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
