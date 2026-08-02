'use client';

import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import LabelPreview from './LabelPreview';
import QualityFieldsForm from './QualityFieldsForm';
import LabelSaveLoad from './LabelSaveLoad';
import CoupangProductPicker from './CoupangProductPicker';
import { generatePdf, printLabel } from '@/lib/label/label-pdf';
import type { QualityFields } from '@/lib/label/label-templates';
// 계산기(src/components/calculator/persist.ts)의 검증된 SSR-safe localStorage 헬퍼를 재사용한다.
import { loadCalcState as loadPersistedState, saveCalcState as savePersistedState, CALC_SAVE_DEBOUNCE_MS } from '@/components/calculator/persist';

const DRAFT_KEY = 'label_editor_draft';

interface LabelEditorDraft {
  fields?: QualityFields;
  imageUrl?: string;
}

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

  // 첫 렌더는 서버와 동일해야 한다(하이드레이션 불일치 방지). localStorage 복원은
  // 마운트 후 useEffect에서 한 번만 한다 — 지연 초기화(useState(() => ...))로 여기서
  // 바로 localStorage를 읽으면 서버가 보낸 빈 값 HTML과 클라이언트 첫 렌더가 어긋난다.
  const [fields, setFields] = useState<QualityFields>({ ...EMPTY_FIELDS, productName: initialProductName });
  const [imageUrl, setImageUrl] = useState<string>('');

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 마운트 후 1회 복원. URL의 productName 쿼리는 저장된 값보다 우선한다.
  useEffect(() => {
    const saved = loadPersistedState<LabelEditorDraft>(DRAFT_KEY);
    if (saved.fields) {
      setFields({ ...saved.fields, ...(initialProductName ? { productName: initialProductName } : {}) });
    }
    if (saved.imageUrl) setImageUrl(saved.imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만 복원
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      savePersistedState(DRAFT_KEY, { fields, imageUrl });
    }, CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fields, imageUrl]);

  // 라벨 인쇄용 최적 해상도(1400px)로 자동 리사이즈 → JPEG 변환
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
          else        { w = Math.round((w * MAX_PX) / h); h = MAX_PX; }
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
      // 3MB 초과 시 자동 리사이즈·압축
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
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          body * { visibility: hidden; }
          #label-preview, #label-preview * { visibility: visible; }
          #label-preview { position: fixed; top: 0; left: 0; margin: 0; }
          @page { margin: 0; size: A4; }
        }
      `}</style>

      <div style={{ display: 'flex', height: '100%', background: C.bg }}>

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
            <div style={SECTION_TITLE}>내 쿠팡 상품 불러오기</div>
            <CoupangProductPicker
              onLoad={(url, name) => {
                if (url) setImageUrl(url);
                setFields((prev) => ({ ...prev, productName: name }));
              }}
            />
          </div>

          {/* 저장 / 불러오기 */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>저장 / 불러오기</div>
            <LabelSaveLoad
              labelType="quality"
              currentData={{ imageUrl, ...fields }}
              onLoad={(data) => {
                const { imageUrl: loadedUrl, ...rest } = data as { imageUrl?: string } & Record<string, unknown>;
                if (loadedUrl) setImageUrl(loadedUrl);
                setFields(rest as unknown as QualityFields);
              }}
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
