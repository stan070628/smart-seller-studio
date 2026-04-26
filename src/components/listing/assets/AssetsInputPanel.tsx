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

  // 파일 선택 시 FileReader로 base64 변환 후 스토어에 저장
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const arr = await Promise.all(
      Array.from(files).map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(f);
          }),
      ),
    );
    updateAssetsDraft({ uploadedFiles: arr });
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
            onChange={(e) => handleFiles(e.target.files)}
            style={{ fontSize: '12px' }}
          />
          {uploadedFiles.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: C.textSub }}>
              {uploadedFiles.length}장 업로드됨
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
