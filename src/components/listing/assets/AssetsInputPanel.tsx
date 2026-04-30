'use client';

import React from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

interface Props {
  onGenerate: () => void;
}

export default function AssetsInputPanel({ onGenerate }: Props) {
  const { assetsDraft, updateAssetsDraft } = useListingStore();
  const { mode, url, uploadedFiles, isGenerating } = assetsDraft;

  // 생성 버튼 활성화 조건: 로딩 중이 아니고, URL 모드면 URL이 있거나, 업로드 모드면 파일이 있어야 함
  const canGenerate = !isGenerating && (
    (mode === 'url' && url.trim().length > 0) ||
    (mode === 'upload' && uploadedFiles.length > 0)
  );

  // 파일 선택 시 Supabase Storage에 업로드하고 반환된 URL만 스토어에 저장.
  // base64 data URL을 JSON으로 보내면 Vercel 4.5MB body 한계를 초과해 413으로 떨어진다.
  // 여러 번 나눠 선택해도 누적되도록, 기존 URL에 새 업로드 결과를 합친다.
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    updateAssetsDraft({ isGenerating: true, lastError: null });
    try {
      const newUrls: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('usageContext', 'listing_thumbnail');
        const res = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) {
          const text = await res.text();
          throw new Error(`업로드 실패 (HTTP ${res.status}): ${text.slice(0, 120)}`);
        }
        const json = (await res.json()) as
          | { success: true; data: { url: string } }
          | { success: false; error: string };
        if (!res.ok || !json.success) {
          throw new Error(!json.success ? json.error : `업로드 실패 (HTTP ${res.status})`);
        }
        newUrls.push(json.data.url);
      }
      updateAssetsDraft({
        uploadedFiles: [...uploadedFiles, ...newUrls],
        isGenerating: false,
      });
    } catch (e) {
      updateAssetsDraft({
        isGenerating: false,
        lastError: e instanceof Error ? e.message : '이미지 업로드 중 오류가 발생했습니다.',
      });
    }
  };

  const removeUploaded = (index: number) => {
    updateAssetsDraft({
      uploadedFiles: uploadedFiles.filter((_, i) => i !== index),
    });
  };

  const clearUploaded = () => {
    updateAssetsDraft({ uploadedFiles: [] });
  };

  return (
    <div style={{
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '12px',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    }}>
      {/* 모드 선택 라디오 버튼 */}
      <div style={{ display: 'flex', gap: '16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="assets-mode"
            checked={mode === 'url'}
            onChange={() => updateAssetsDraft({ mode: 'url' })}
          />
          <span style={{ fontSize: '13px', color: C.text }}>URL</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="assets-mode"
            checked={mode === 'upload'}
            onChange={() => updateAssetsDraft({ mode: 'upload' })}
          />
          <span style={{ fontSize: '13px', color: C.text }}>직접 업로드</span>
        </label>
      </div>

      {/* 모드별 입력 영역 */}
      {mode === 'url' ? (
        <input
          type="url"
          value={url}
          onChange={(e) => updateAssetsDraft({ url: e.target.value })}
          placeholder="https://"
          style={{
            width: '100%',
            padding: '10px 14px',
            fontSize: '13px',
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            outline: 'none',
            color: C.text,
            backgroundColor: '#fff',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <div>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={isGenerating}
            onChange={(e) => {
              handleFiles(e.target.files);
              // 동일 파일 재선택을 허용하기 위해 input value 초기화.
              e.target.value = '';
            }}
            style={{ fontSize: '12px' }}
          />
          {uploadedFiles.length > 0 && (
            <>
              <div
                style={{
                  marginTop: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  color: C.textSub,
                }}
              >
                <span>{uploadedFiles.length}장 업로드됨</span>
                <button
                  type="button"
                  onClick={clearUploaded}
                  disabled={isGenerating}
                  style={{
                    padding: '2px 8px',
                    fontSize: '11px',
                    color: C.textSub,
                    border: `1px solid ${C.border}`,
                    backgroundColor: '#fff',
                    borderRadius: '6px',
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                  }}
                >
                  전체 삭제
                </button>
              </div>
              <div
                style={{
                  marginTop: '8px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                  gap: '6px',
                }}
              >
                {uploadedFiles.map((u, i) => (
                  <div
                    key={`${u}-${i}`}
                    style={{
                      position: 'relative',
                      aspectRatio: '1 / 1',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      border: `1px solid ${C.border}`,
                      backgroundColor: '#fafafa',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    <button
                      type="button"
                      onClick={() => removeUploaded(i)}
                      disabled={isGenerating}
                      aria-label="이미지 삭제"
                      style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        width: 18,
                        height: 18,
                        padding: 0,
                        border: 'none',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(0,0,0,0.65)',
                        color: '#fff',
                        fontSize: 12,
                        lineHeight: 1,
                        cursor: isGenerating ? 'not-allowed' : 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {isGenerating && (
            <div style={{ marginTop: '6px', fontSize: '12px', color: C.textSub }}>
              업로드 중...
            </div>
          )}
        </div>
      )}

      {/* 자산 생성 버튼 */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          padding: '10px 20px',
          fontSize: '13px',
          fontWeight: 700,
          backgroundColor: canGenerate ? C.accent : C.border,
          color: canGenerate ? '#fff' : C.textSub,
          border: 'none',
          borderRadius: '8px',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          alignSelf: 'flex-start',
        }}
      >
        {isGenerating ? '생성 중...' : '자산 생성'}
      </button>
    </div>
  );
}
