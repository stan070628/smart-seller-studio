'use client';

import { useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import LabelPreview from './LabelPreview';
import QualityFieldsForm from './QualityFieldsForm';
import TemplatePicker from './TemplatePicker';
import { generatePdf, printLabel } from '@/lib/label/label-pdf';
import type { QualityFields } from '@/lib/label/label-templates';

const EMPTY_FIELDS: QualityFields = {
  productName: '',
  material: '',
  size: '',
  country: '',
  importer: '',
  address: '',
  phone: '',
  extra: '',
};

const C = {
  border: '#e5e7eb',
  bg: '#f9fafb',
};

const SECTION_TITLE: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 12,
  marginBottom: 8,
  color: '#374151',
};

const SECTION: React.CSSProperties = { marginBottom: 16 };

const BTN_PRIMARY: React.CSSProperties = {
  padding: '7px 16px',
  borderRadius: 6,
  border: 'none',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  color: '#fff',
};

export default function LabelEditor() {
  const searchParams = useSearchParams();
  const initialProductName = searchParams.get('productName') ?? '';

  const [fields, setFields] = useState<QualityFields>({
    ...EMPTY_FIELDS,
    productName: initialProductName,
  });
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/label/upload-image', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.success) {
        setImageUrl(json.data.url);
      } else {
        setUploadError(
          res.status === 401
            ? '로그인이 필요합니다. 다시 로그인 후 시도해주세요.'
            : json.error ?? '이미지 업로드에 실패했습니다.',
        );
      }
    } catch {
      setUploadError('네트워크 오류. 연결 상태를 확인해주세요.');
    } finally {
      setUploading(false);
    }
  };

  const handlePdf = async () => {
    if (!previewRef.current) return;
    await generatePdf(previewRef.current);
  };

  const handlePrint = () => {
    if (!previewRef.current) return;
    printLabel(previewRef.current);
  };

  return (
    <>
      <style>{`
        @media print {
          body > * { display: none !important; }
          #label-preview { display: grid !important; }
          @page { margin: 0; size: A4; }
        }
      `}</style>

      <div style={{ display: 'flex', height: 'calc(100vh - 60px)', background: C.bg }}>

        {/* 좌측 폼 패널 */}
        <div style={{
          width: 300,
          flexShrink: 0,
          background: '#fff',
          color: '#111',
          colorScheme: 'light',
          borderRight: `1px solid ${C.border}`,
          padding: 16,
          overflowY: 'auto',
        }}>
          <div style={SECTION}>
            <div style={SECTION_TITLE}>템플릿</div>
            <TemplatePicker
              currentImageUrl={imageUrl}
              currentFields={fields}
              onLoad={setFields}
              onImageLoad={setImageUrl}
            />
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>상표 이미지</div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              style={{
                border: '2px dashed #d1d5db',
                borderRadius: 6,
                padding: 16,
                textAlign: 'center',
                cursor: 'pointer',
                fontSize: 12,
                color: '#6b7280',
              }}
            >
              {uploading ? '업로드 중...' : imageUrl ? '이미지 변경' : '클릭하여 이미지 선택 (PNG/JPG)'}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageFile(f);
              }}
            />
            {uploadError && (
              <p style={{ fontSize: 11, color: '#dc2626', margin: '6px 0 0' }}>{uploadError}</p>
            )}
            {imageUrl && (
              <img
                src={imageUrl}
                alt="미리보기"
                style={{ marginTop: 8, maxWidth: '100%', maxHeight: 80, objectFit: 'contain' }}
              />
            )}
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>품질표시 항목</div>
            <QualityFieldsForm fields={fields} onChange={setFields} />
          </div>
        </div>

        {/* 우측 미리보기 + 액션 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 16px',
            borderBottom: `1px solid ${C.border}`,
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: '#6b7280' }}>
              미리보기 — A4 · 99.1×93mm × 6칸
            </span>
            <button
              style={{ ...BTN_PRIMARY, background: '#6366f1' }}
              onClick={handlePdf}
            >
              ⬇ PDF 저장
            </button>
            <button
              style={{ ...BTN_PRIMARY, background: '#059669' }}
              onClick={handlePrint}
            >
              🖨 바로 인쇄
            </button>
          </div>

          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: 20,
            background: '#e5e7eb',
            display: 'flex',
            justifyContent: 'center',
          }}>
            <LabelPreview ref={previewRef} imageUrl={imageUrl} fields={fields} />
          </div>
        </div>

      </div>
    </>
  );
}
