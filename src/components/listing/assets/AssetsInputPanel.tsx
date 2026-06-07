'use client';

import React, { useRef, useState } from 'react';
import AiEditModal from '@/components/listing/AiEditModal';
import ConversationalDetailModal from './ConversationalDetailModal';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import { prepareUpload } from '@/lib/image/prepare-upload';
import AssetsSaveLoad from './AssetsSaveLoad';
import type { CategoryKey } from '@/lib/conversational-detail/types';
import { contentToSections } from '@/lib/detail-page/section-parser';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

const CATEGORY_OPTIONS: Array<{ key: CategoryKey; label: string }> = [
  { key: 'basic', label: '기본' },
  { key: 'fashion', label: '패션' },
  { key: 'living', label: '리빙' },
  { key: 'food', label: '식품' },
];

interface Props {
  onGenerate: () => void;
  onAnalyze: () => void;
}

type UploadSlot = 'thumbnail' | 'detail';

export default function AssetsInputPanel({ onGenerate, onAnalyze }: Props) {
  const { assetsDraft, updateAssetsDraft, sharedDraft, updateSharedDraft } = useListingStore();
  const { mode, url, thumbnailFiles, detailFiles, isGenerating, isAnalyzing, includeAiImages, category } = assetsDraft;
  const {
    isGenerating: _ig,
    generatingMessage: _gm,
    lastError: _le,
    ...currentDraftData
  } = assetsDraft;
  const thumbInputRef = useRef<HTMLInputElement | null>(null);
  const detailInputRef = useRef<HTMLInputElement | null>(null);
  const [inputImageEditTarget, setInputImageEditTarget] = useState<{
    slot: 'thumbnail' | 'detail';
    index: number;
    url: string;
  } | null>(null);
  const [conversationModalOpen, setConversationModalOpen] = useState(false);
  const [thumbUrlInput, setThumbUrlInput] = useState('');
  const [thumbUrlLoading, setThumbUrlLoading] = useState(false);
  const [detailUrlInput, setDetailUrlInput] = useState('');
  const [detailUrlLoading, setDetailUrlLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  // 생성 가능 조건: URL 모드면 URL이 있거나, 업로드 모드면 두 슬롯 중 하나라도 채워져야 함
  const canGenerate = !isGenerating && (
    (mode === 'url' && url.trim().length > 0) ||
    (mode === 'upload' && (thumbnailFiles.length > 0 || detailFiles.length > 0))
  );

  // 대화로 만들기 활성화 조건: 업로드 모드 + 이미지 1장 이상(썸네일 또는 상세) + 상품명 + 카테고리
  const canStartConversation =
    !isGenerating &&
    mode === 'upload' &&
    (thumbnailFiles.length > 0 || detailFiles.length > 0) &&
    sharedDraft.name.trim().length > 0 &&
    category !== null;

  // URL 모드 Q&A: URL + 카테고리 있으면 활성화
  const canStartUrlQA =
    !isGenerating &&
    mode === 'url' &&
    url.trim().length > 0 &&
    category !== null;

  // 씬 분석 버튼 활성화 조건
  const canAnalyze = canGenerate && !isGenerating && !isAnalyzing;

  // URL 모드면 이미 추출된 generatedThumbnails, 업로드 모드면 기존 로직
  const conversationImageUrls =
    mode === 'url'
      ? assetsDraft.generatedThumbnails
      : detailFiles.length > 0
        ? detailFiles
        : thumbnailFiles;

  const handleConversationComplete = ({
    html,
    content,
    conversationContext,
  }: {
    html: string;
    content?: DetailPageContent;
    conversationContext: import('@/lib/conversational-detail/types').ConversationContext;
  }) => {
    let detailPageSections = assetsDraft.detailPageSections;
    if (content) {
      try {
        detailPageSections = contentToSections(content);
      } catch {
        // 파싱 실패 시 silent fallback
      }
    }
    updateAssetsDraft({
      // URL 모드면 이미 추출된 썸네일 유지, 업로드 모드면 업로드 파일 사용
      generatedThumbnails: mode === 'url' ? assetsDraft.generatedThumbnails : thumbnailFiles,
      generatedDetailHtml: html,
      detailPageSections,
      aiDetailContent: content ?? null,
      conversationAnswers: conversationContext.answers,
      lastError: null,
    });
    setConversationModalOpen(false);
  };

  const handleStartUrlQA = async () => {
    updateAssetsDraft({ isGenerating: true, generatingMessage: '이미지 가져오는 중...', lastError: null });
    try {
      const res = await fetch('/api/listing/assets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'url', url: url.trim() }),
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        const text = await res.text();
        throw new Error(`이미지 추출 실패 (HTTP ${res.status}): ${text.slice(0, 160)}`);
      }
      const json = (await res.json()) as {
        success: boolean;
        data?: { thumbnails: string[]; detailHtml: string };
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? '이미지 추출 실패');
      }
      const thumbnails = json.data.thumbnails ?? [];
      // 이미지가 없으면 Q&A 모달을 열지 않고 에러 표시
      if (thumbnails.length === 0) {
        updateAssetsDraft({
          isGenerating: false,
          generatingMessage: null,
          lastError: 'URL에서 이미지를 찾을 수 없습니다. 직접 업로드 모드를 사용해 주세요.',
        });
        return;
      }
      // 썸네일만 저장 (HTML 생성 없이 Q&A로 넘긴다)
      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        generatedThumbnails: thumbnails,
      });
      setConversationModalOpen(true);
    } catch (e) {
      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        lastError: e instanceof Error ? e.message : '이미지 추출 중 오류',
      });
    }
  };

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

  const handleInputImageAiEditSaved = (resultUrl: string) => {
    if (!inputImageEditTarget) return;
    const { slot, index } = inputImageEditTarget;
    if (slot === 'thumbnail') {
      const next = [...thumbnailFiles];
      next[index] = resultUrl;
      updateAssetsDraft({ thumbnailFiles: next });
    } else {
      const next = [...detailFiles];
      next[index] = resultUrl;
      updateAssetsDraft({ detailFiles: next });
    }
    setInputImageEditTarget(null);
  };

  const handleAddByUrl = async (slot: UploadSlot) => {
    const rawUrl = slot === 'thumbnail' ? thumbUrlInput : detailUrlInput;
    const setLoading = slot === 'thumbnail' ? setThumbUrlLoading : setDetailUrlLoading;
    const setInput = slot === 'thumbnail' ? setThumbUrlInput : setDetailUrlInput;
    if (!rawUrl.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/image/coupang-resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: rawUrl.trim() }),
      });
      const json = await res.json() as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? 'URL 추가 실패');
      if (slot === 'thumbnail') {
        updateAssetsDraft({ thumbnailFiles: [...thumbnailFiles, json.url] });
      } else {
        updateAssetsDraft({ detailFiles: [...detailFiles, json.url] });
      }
      setInput('');
    } catch (e) {
      updateAssetsDraft({ lastError: e instanceof Error ? e.message : 'URL 추가 중 오류' });
    } finally {
      setLoading(false);
    }
  };

  // 슬롯 이미지 개별 다운로드 핸들러
  const handleDownloadSlotImage = async (url: string, index: number) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `image-${index + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(url, '_blank');
    }
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
      {/* URL 직접 추가 */}
      <div style={{ display: 'flex', gap: '4px' }}>
        <input
          type="url"
          placeholder="이미지 URL 붙여넣기..."
          value={slot === 'thumbnail' ? thumbUrlInput : detailUrlInput}
          onChange={e => slot === 'thumbnail' ? setThumbUrlInput(e.target.value) : setDetailUrlInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleAddByUrl(slot); }}
          disabled={(slot === 'thumbnail' ? thumbUrlLoading : detailUrlLoading) || isGenerating}
          style={{
            flex: 1,
            fontSize: '11px',
            padding: '4px 8px',
            border: `1px solid ${C.border}`,
            borderRadius: '6px',
            outline: 'none',
            color: C.text,
          }}
        />
        <button
          type="button"
          onClick={() => void handleAddByUrl(slot)}
          disabled={
            !(slot === 'thumbnail' ? thumbUrlInput : detailUrlInput).trim() ||
            (slot === 'thumbnail' ? thumbUrlLoading : detailUrlLoading) ||
            isGenerating
          }
          style={{
            flexShrink: 0,
            fontSize: '11px',
            padding: '4px 10px',
            borderRadius: '6px',
            backgroundColor: '#7c3aed',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {(slot === 'thumbnail' ? thumbUrlLoading : detailUrlLoading) ? '...' : '추가'}
        </button>
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
              {!isGenerating && (
                <button
                  type="button"
                  onClick={() => setInputImageEditTarget({ slot, index: i, url: u })}
                  title="AI로 편집"
                  aria-label="AI로 편집"
                  style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: '2px 6px',
                    fontSize: 10,
                    fontWeight: 600,
                    background: '#7c3aed',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  🪄
                </button>
              )}
              {/* 다운로드 버튼 — URL 복사 버튼 왼쪽에 위치 */}
              <button
                type="button"
                title="이미지 다운로드"
                aria-label="이미지 다운로드"
                onClick={() => void handleDownloadSlotImage(u, i)}
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 22,
                  width: 18,
                  height: 18,
                  padding: 0,
                  border: 'none',
                  borderRadius: 3,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  fontSize: 9,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ↓
              </button>
              <button
                type="button"
                title="URL 복사"
                aria-label="URL 복사"
                onClick={() => {
                  void navigator.clipboard.writeText(u);
                  setCopiedIndex(`${slot}-${i}`);
                  setTimeout(() => setCopiedIndex(null), 800);
                }}
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 2,
                  width: 18,
                  height: 18,
                  padding: 0,
                  border: 'none',
                  borderRadius: 3,
                  backgroundColor: copiedIndex === `${slot}-${i}` ? '#22c55e' : 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  fontSize: 9,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {copiedIndex === `${slot}-${i}` ? '✓' : '🔗'}
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
      {/* 임시저장·불러오기 */}
      <AssetsSaveLoad
        currentDraftData={currentDraftData as Record<string, unknown>}
        onLoad={(data) => updateAssetsDraft(data as Parameters<typeof updateAssetsDraft>[0])}
      />
      <hr style={{ border: 'none', borderTop: '1px solid #eeeeee', margin: 0 }} />
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
        <>
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
          {/* URL 모드 카테고리 선택 (AI와 함께 만들기 활성화용) */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>
              카테고리 (AI와 함께 만들기 시 필수)
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {CATEGORY_OPTIONS.map((opt) => {
                const selected = category === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => updateAssetsDraft({ category: opt.key })}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      borderRadius: '999px',
                      border: `1px solid ${selected ? C.accent : C.border}`,
                      backgroundColor: selected ? C.accent : '#fff',
                      color: selected ? '#fff' : C.text,
                      cursor: 'pointer',
                      fontWeight: selected ? 700 : 500,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
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
            '업로드한 이미지가 그대로 상세페이지 HTML 생성에 사용됩니다.',
            detailFiles,
            detailInputRef,
          )}
        </div>
      )}

      {/* 상품명 입력 — 대화 모드 활성화에 필요. sharedDraft.name에 양방향 바인딩 */}
      {mode === 'upload' && (
        <div>
          <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>
            상품명 (대화로 만들기 시 필수)
          </p>
          <input
            type="text"
            value={sharedDraft.name}
            onChange={(e) => updateSharedDraft({ name: e.target.value })}
            placeholder="예: 프리미엄 스테인리스 텀블러 500ml"
            maxLength={100}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '13px',
              border: `1px solid ${C.border}`,
              borderRadius: '8px',
              outline: 'none',
              boxSizing: 'border-box',
              color: C.text,
            }}
          />
        </div>
      )}

      {/* 카테고리 칩 — 대화 모드 보충 질문 결정에 사용 */}
      {mode === 'upload' && (
        <div>
          <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 600, color: C.textSub }}>
            카테고리 (대화로 만들기 시 필수)
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {CATEGORY_OPTIONS.map((opt) => {
              const selected = category === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => updateAssetsDraft({ category: opt.key })}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    borderRadius: '999px',
                    border: `1px solid ${selected ? C.accent : C.border}`,
                    backgroundColor: selected ? C.accent : '#fff',
                    color: selected ? '#fff' : C.text,
                    cursor: 'pointer',
                    fontWeight: selected ? 700 : 500,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Gemini AI 이미지 포함 생성 토글 */}
      {canGenerate && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#374151', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={includeAiImages}
            onChange={e => updateAssetsDraft({ includeAiImages: e.target.checked })}
            style={{ width: '15px', height: '15px', accentColor: '#7c3aed', cursor: 'pointer' }}
          />
          <span>
            <strong style={{ color: '#7c3aed' }}>Gemini AI 이미지</strong> 포함 생성
            <span style={{ color: '#9ca3af', marginLeft: '4px' }}>(+30~50초)</span>
          </span>
        </label>
      )}

      {/* 자산 생성 / 대화로 만들기 버튼 */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {/* 자동 생성 버튼 */}
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
          }}
        >
          {isGenerating ? '생성 중...' : '⚡ 자동 생성'}
        </button>

        {/* 업로드 모드 Q&A */}
        {mode === 'upload' && (
          <button
            type="button"
            onClick={() => setConversationModalOpen(true)}
            disabled={!canStartConversation}
            title={
              canStartConversation
                ? 'AI 마케터와 대화하며 상세페이지 작성'
                : '이미지·상품명·카테고리를 모두 입력하면 활성화됩니다'
            }
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 700,
              backgroundColor: canStartConversation ? '#7c3aed' : C.border,
              color: canStartConversation ? '#fff' : C.textSub,
              border: 'none',
              borderRadius: '8px',
              cursor: canStartConversation ? 'pointer' : 'not-allowed',
            }}
          >
            💬 AI와 함께 만들기
          </button>
        )}

        {/* URL 모드 Q&A: 이미지 추출 후 Q&A 모달 오픈 */}
        {mode === 'url' && (
          <button
            type="button"
            onClick={() => void handleStartUrlQA()}
            disabled={!canStartUrlQA}
            title={
              canStartUrlQA
                ? 'URL에서 이미지를 가져와 AI와 대화하며 상세페이지 작성'
                : 'URL과 카테고리를 입력하면 활성화됩니다'
            }
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 700,
              backgroundColor: canStartUrlQA ? '#7c3aed' : C.border,
              color: canStartUrlQA ? '#fff' : C.textSub,
              border: 'none',
              borderRadius: '8px',
              cursor: canStartUrlQA ? 'pointer' : 'not-allowed',
            }}
          >
            💬 AI와 함께 만들기
          </button>
        )}
      </div>

      {/* 씬 이미지 분석 버튼 — Gemini AI 이미지 포함 생성 ON일 때만 표시 */}
      {includeAiImages && (
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze}
          style={{
            width: '100%',
            padding: '10px 0',
            backgroundColor: canAnalyze ? '#7c3aed' : '#c4b5fd',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: canAnalyze ? 'pointer' : 'not-allowed',
            marginTop: 6,
          }}
        >
          {isAnalyzing ? '이미지 분석 중...' : '🔍 씬 이미지 분석'}
        </button>
      )}

      {/* 업로드 이미지 AI 편집 모달 — 상세 슬롯이면 detail 컨텍스트로 자유롭게 편집 */}
      {inputImageEditTarget && (
        <AiEditModal
          imageUrl={inputImageEditTarget.url}
          imageFile={null}
          onClose={() => setInputImageEditTarget(null)}
          onSave={handleInputImageAiEditSaved}
          context={inputImageEditTarget.slot === 'detail' ? 'detail' : 'thumbnail'}
        />
      )}

      {/* 대화식 상세페이지 생성 모달 */}
      {conversationModalOpen && category !== null && (
        <ConversationalDetailModal
          productName={sharedDraft.name}
          category={category}
          imageUrls={conversationImageUrls}
          initialAnswers={
            assetsDraft.conversationAnswers.length > 0
              ? assetsDraft.conversationAnswers
              : undefined
          }
          onClose={() => setConversationModalOpen(false)}
          onComplete={handleConversationComplete}
        />
      )}
    </div>
  );
}
