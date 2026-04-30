'use client';

import React, { useRef } from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import { prepareUpload } from '@/lib/image/prepare-upload';

interface Props {
  onGenerate: () => void;
}

type UploadSlot = 'thumbnail' | 'detail';

export default function AssetsInputPanel({ onGenerate }: Props) {
  const { assetsDraft, updateAssetsDraft } = useListingStore();
  const { mode, url, thumbnailFiles, detailFiles, isGenerating } = assetsDraft;
  const thumbInputRef = useRef<HTMLInputElement | null>(null);
  const detailInputRef = useRef<HTMLInputElement | null>(null);

  // 생성 가능 조건: URL 모드면 URL이 있거나, 업로드 모드면 두 슬롯 중 하나라도 채워져야 함
  const canGenerate = !isGenerating && (
    (mode === 'url' && url.trim().length > 0) ||
    (mode === 'upload' && (thumbnailFiles.length > 0 || detailFiles.length > 0))
  );

  // 파일 선택 시 Supabase Storage에 업로드하고 반환된 URL만 스토어에 저장.
  // base64 data URL을 JSON으로 보내면 Vercel 4.5MB body 한계를 초과해 413으로 떨어진다.
  // 여러 번 나눠 선택해도 누적되도록, 기존 URL에 새 업로드 결과를 합친다.
  const handleFiles = async (slot: UploadSlot, files: FileList | null) => {
    if (!files || files.length === 0) return;
    updateAssetsDraft({ isGenerating: true, lastError: null, generatingMessage: '이미지 업로드 중...' });
    try {
      const newUrls: string[] = [];
      for (const file of Array.from(files)) {
        const { blob, filename } = await prepareUpload(file);
        const fd = new FormData();
        fd.append('file', blob, filename);
        fd.append('usageContext', slot === 'thumbnail' ? 'listing_thumbnail' : 'listing_detail');
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
        thumbnailFiles: slot === 'thumbnail' ? [...thumbnailFiles, ...newUrls] : thumbnailFiles,
        detailFiles: slot === 'detail' ? [...detailFiles, ...newUrls] : detailFiles,
        isGenerating: false,
        generatingMessage: null,
      });
    } catch (e) {
      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        lastError: e instanceof Error ? e.message : '이미지 업로드 중 오류가 발생했습니다.',
      });
    }
  };

  const removeAt = (slot: UploadSlot, index: number) => {
    if (slot === 'thumbnail') {
      updateAssetsDraft({ thumbnailFiles: thumbnailFiles.filter((_, i) => i !== index) });
    } else {
      updateAssetsDraft({ detailFiles: detailFiles.filter((_, i) => i !== index) });
    }
  };

  const clearSlot = (slot: UploadSlot) => {
    if (slot === 'thumbnail') updateAssetsDraft({ thumbnailFiles: [] });
    else updateAssetsDraft({ detailFiles: [] });
  };

  const renderSlot = (
    slot: UploadSlot,
    label: string,
    helperText: string,
    files: string[],
    inputRef: React.MutableRefObject<HTMLInputElement | null>,
  ) => (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        padding: '12px',
        backgroundColor: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>{label}</span>
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => clearSlot(slot)}
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
        )}
      </div>
      <p style={{ margin: 0, fontSize: '11px', color: C.textSub }}>{helperText}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={isGenerating}
        onChange={(e) => {
          handleFiles(slot, e.target.files);
          e.target.value = '';
        }}
        style={{ display: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isGenerating}
          style={{
            padding: '7px 14px',
            fontSize: '12px',
            fontWeight: 600,
            color: C.text,
            backgroundColor: '#fff',
            border: `1px solid ${C.text}`,
            borderRadius: '7px',
            cursor: isGenerating ? 'not-allowed' : 'pointer',
          }}
        >
          파일 선택
        </button>
        <span style={{ fontSize: '12px', color: C.text }}>
          {files.length === 0 ? '선택된 파일 없음' : `${files.length}개 선택됨`}
        </span>
      </div>
      {files.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
            gap: '6px',
          }}
        >
          {files.map((u, i) => (
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
                onClick={() => removeAt(slot, i)}
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
      )}
    </div>
  );

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {renderSlot(
            'thumbnail',
            '썸네일용 이미지',
            '대표 이미지에 사용. 업로드한 그대로 결과 썸네일이 됩니다.',
            thumbnailFiles,
            thumbInputRef,
          )}
          {renderSlot(
            'detail',
            '상세페이지용 이미지',
            '자산 생성 시 자동으로 흰 배경·85% 가이드라인에 맞게 AI 편집되어 상세페이지에 사용됩니다.',
            detailFiles,
            detailInputRef,
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
