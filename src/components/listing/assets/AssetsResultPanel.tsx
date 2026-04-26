'use client';

import React from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

interface Props {
  onSave: () => void;
}

export default function AssetsResultPanel({ onSave }: Props) {
  const { assetsDraft } = useListingStore();
  const { generatedThumbnails, generatedDetailHtml } = assetsDraft;
  const hasResult = generatedThumbnails.length > 0 || generatedDetailHtml.length > 0;

  // 결과가 없을 때 안내 문구 표시
  if (!hasResult) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        color: C.textSub,
        fontSize: '13px',
        backgroundColor: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: '12px',
      }}>
        좌측에서 자산을 먼저 생성하세요.
      </div>
    );
  }

  // 개별 썸네일 다운로드
  const handleDownloadOne = (url: string, idx: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `thumbnail-${idx + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 모든 자산을 ZIP으로 일괄 다운로드
  const handleDownloadZip = async () => {
    const JSZipMod = await import('jszip');
    const zip = new JSZipMod.default();
    generatedThumbnails.forEach((url, i) => {
      const base64 = url.split(',')[1] ?? '';
      zip.file(`thumbnail-${i + 1}.png`, base64, { base64: true });
    });
    if (generatedDetailHtml) {
      zip.file('detail.html', generatedDetailHtml);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = 'assets.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 썸네일 미리보기 섹션 */}
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '16px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '12px' }}>
          썸네일 ({generatedThumbnails.length})
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {generatedThumbnails.map((url, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={url}
                alt={`썸네일 ${i + 1}`}
                style={{
                  width: '120px',
                  height: '120px',
                  objectFit: 'cover',
                  borderRadius: '8px',
                  border: `1px solid ${C.border}`,
                }}
              />
              <button
                onClick={() => handleDownloadOne(url, i)}
                style={{
                  position: 'absolute', bottom: '4px', right: '4px',
                  padding: '2px 6px', fontSize: '10px',
                  backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                }}
              >
                다운로드
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 상세 HTML iframe 미리보기 섹션 */}
      {generatedDetailHtml && (
        <div style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          padding: '16px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '12px' }}>
            상세 HTML
          </div>
          <iframe
            srcDoc={generatedDetailHtml}
            title="상세 HTML 미리보기"
            style={{
              width: '100%',
              height: '400px',
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
            }}
            sandbox="allow-same-origin"
          />
        </div>
      )}

      {/* 액션 버튼 영역 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={handleDownloadZip}
          style={{
            padding: '10px 16px', fontSize: '13px', fontWeight: 600,
            backgroundColor: C.text, color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          ZIP 다운로드
        </button>
        <button
          type="button"
          onClick={onSave}
          style={{
            padding: '10px 16px', fontSize: '13px', fontWeight: 600,
            backgroundColor: C.accent, color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          Supabase에 저장
        </button>
      </div>
    </div>
  );
}
