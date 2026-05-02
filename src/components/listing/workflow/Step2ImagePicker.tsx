'use client';

/**
 * Step2ImagePicker.tsx
 * Step 2 — 이미지 분류 (썸네일 / 상세페이지) + AI 편집 + Supabase 저장
 * 레이아웃: 썸네일 버킷 → 상세 버킷 → 원본 풀 (T/D 토글 버튼)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Upload, Sparkles, X,
  AlertTriangle, CloudUpload, CheckCircle2,
} from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import SharedAiEditModal from '@/components/listing/AiEditModal';

// ─────────────────────────────────────────────────────────────────────────────
// 내부 타입
// ─────────────────────────────────────────────────────────────────────────────

interface ImageEntry {
  key: string;
  url: string;
  inThumb: boolean;   // 썸네일 버킷에 포함
  inDetail: boolean;  // 상세페이지 버킷에 포함
}

interface EditModalState {
  targetKey: string;
  imageUrl: string;
  prompt: string;
  loading: boolean;
  error: string | null;
}

type SaveStatus = 'idle' | 'saving' | 'done' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────

function isSavedUrl(url: string): boolean {
  return url.includes('supabase.co/storage') || url.includes('supabase.in/storage');
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; });
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function Step2ImagePicker() {
  const { sharedDraft, updateSharedDraft } = useListingStore();
  const { thumbnailImages, detailImages } = sharedDraft;

  const [entries, setEntries] = useState<ImageEntry[]>(() => {
    const all = dedupe([...thumbnailImages, ...detailImages]);
    return all.map((url) => ({ key: url, url, inThumb: false, inDetail: false }));
  });

  // 버킷 삽입 순서를 별도 배열로 관리 (클릭 순서 = 표시 순서)
  // thumbOrder: thumbnailImages 그대로 pre-load (썸네일은 파싱 결과를 유지)
  // detailOrder: 빈 배열로 시작 → 사용자가 클릭한 순서대로 쌓임
  //   (단, pickedDetailImages가 이미 있으면 이전 선택 복원)
  const [thumbOrder, setThumbOrder] = useState<string[]>(() =>
    dedupe(thumbnailImages),
  );
  const [detailOrder, setDetailOrder] = useState<string[]>(() => {
    const { pickedDetailImages } = sharedDraft;
    return dedupe(pickedDetailImages.length > 0 ? pickedDetailImages : []);
  });

  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 썸네일 합치기 (다중 선택 → 2장 합치기 모달) ────────────────────────────
  const [selectedMergeKeys, setSelectedMergeKeys] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState<{ url1: string; url2: string } | null>(null);

  const toggleMergeSelect = (key: string) => {
    setSelectedMergeKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // 최대 2장: 이미 2장이면 가장 먼저 선택한 것을 밀어낸다
      if (prev.length >= 2) return [prev[1], key];
      return [...prev, key];
    });
  };

  // ── store 동기화 ──────────────────────────────────────────────────────────
  const syncStore = useCallback(
    (nextEntries: ImageEntry[], nextThumbOrder: string[], nextDetailOrder: string[]) => {
      const entryMap = new Map(nextEntries.map((e) => [e.key, e.url]));
      updateSharedDraft({
        thumbnailImages: nextThumbOrder.map((k) => entryMap.get(k) ?? k),
        pickedDetailImages: nextDetailOrder.map((k) => entryMap.get(k) ?? k),
      });
    },
    [updateSharedDraft],
  );

  const applyUpdate = useCallback(
    (nextEntries: ImageEntry[], nextThumbOrder: string[], nextDetailOrder: string[]) => {
      setEntries(nextEntries);
      setThumbOrder(nextThumbOrder);
      setDetailOrder(nextDetailOrder);
      syncStore(nextEntries, nextThumbOrder, nextDetailOrder);
    },
    [syncStore],
  );

  // ── 마운트 시 store 초기화 ────────────────────────────────────────────────
  useEffect(() => {
    syncStore(entries, thumbOrder, detailOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 합치기 시작 / 결과 적용 ──────────────────────────────────────────────
  const handleStartMerge = () => {
    if (selectedMergeKeys.length !== 2) return;
    const [k1, k2] = selectedMergeKeys;
    const e1 = entries.find((e) => e.key === k1);
    const e2 = entries.find((e) => e.key === k2);
    if (!e1 || !e2) return;
    setMergeTarget({ url1: e1.url, url2: e2.url });
  };

  // 합쳐진 결과를 새 ImageEntry로 추가하고 썸네일 버킷 끝에 붙인다.
  const handleMergeSaved = (resultUrl: string) => {
    const newEntry: ImageEntry = {
      key: resultUrl,
      url: resultUrl,
      inThumb: true,
      inDetail: false,
    };
    applyUpdate(
      [...entries, newEntry],
      [...thumbOrder, resultUrl],
      detailOrder,
    );
    setSelectedMergeKeys([]);
    setMergeTarget(null);
  };

  // ── 토글 / 삭제 ──────────────────────────────────────────────────────────
  const toggleThumb = (key: string) => {
    const already = thumbOrder.includes(key);
    const nextThumb = already ? thumbOrder.filter((k) => k !== key) : [...thumbOrder, key];
    applyUpdate(entries, nextThumb, detailOrder);
  };

  const toggleDetail = (key: string) => {
    const already = detailOrder.includes(key);
    const nextDetail = already ? detailOrder.filter((k) => k !== key) : [...detailOrder, key];
    applyUpdate(entries, thumbOrder, nextDetail);
  };

  const removeEntry = (key: string) => {
    applyUpdate(
      entries.filter((e) => e.key !== key),
      thumbOrder.filter((k) => k !== key),
      detailOrder.filter((k) => k !== key),
    );
  };

  // ── 파일 업로드 ───────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    Promise.all(
      files.map(
        (file) =>
          new Promise<ImageEntry>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                key: `uploaded:${Date.now()}:${file.name}`,
                url: reader.result as string,
                inThumb: false,
                inDetail: true,
              });
            reader.readAsDataURL(file);
          }),
      ),
    ).then((newEntries) => {
      const nextEntries = [...entries, ...newEntries];
      const newKeys = newEntries.map((e) => e.key);
      // 새로 업로드된 파일은 상세 버킷에 자동 추가 (클릭 순서 끝에)
      applyUpdate(nextEntries, thumbOrder, [...detailOrder, ...newKeys]);
    });
    e.target.value = '';
  };

  // ── AI 편집 ───────────────────────────────────────────────────────────────
  const openEditModal = (entry: ImageEntry) =>
    setEditModal({ targetKey: entry.key, imageUrl: entry.url, prompt: '', loading: false, error: null });

  const handleAiEdit = async () => {
    if (!editModal || !editModal.prompt.trim()) return;
    setEditModal((prev) => prev && { ...prev, loading: true, error: null });
    try {
      const res = await fetch('/api/ai/edit-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imageUrl: editModal.imageUrl, prompt: editModal.prompt.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `AI 편집 실패 (${res.status})`);
      const editedUrl: string = json.data?.editedUrl;
      if (!editedUrl) throw new Error('편집된 이미지 URL을 받지 못했습니다.');
      const oldKey = editModal.targetKey;
      const nextEntries = entries.map((e) =>
        e.key === oldKey ? { ...e, url: editedUrl, key: editedUrl } : e,
      );
      const replaceKey = (arr: string[]) => arr.map((k) => (k === oldKey ? editedUrl : k));
      applyUpdate(nextEntries, replaceKey(thumbOrder), replaceKey(detailOrder));
      setEditModal(null);
      setPreviewUrl(editedUrl);
    } catch (err) {
      setEditModal(
        (prev) =>
          prev && { ...prev, loading: false, error: err instanceof Error ? err.message : 'AI 편집 중 오류가 발생했습니다.' },
      );
    }
  };

  // ── 이미지 저장 (Supabase) ─────────────────────────────────────────────────
  const unsavedCount = entries.filter((e) => !isSavedUrl(e.url)).length;

  const handleSaveImages = async () => {
    const urlsToSave = [...new Set(entries.map((e) => e.url).filter((u) => !isSavedUrl(u)))];
    if (urlsToSave.length === 0) { setSaveStatus('done'); return; }
    setSaveStatus('saving');
    setSaveErrors([]);
    try {
      const res = await fetch('/api/storage/save-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls: urlsToSave, folder: 'listing-images' }),
      });
      const data = await res.json() as {
        success: boolean;
        results: Array<{ originalUrl: string; savedUrl: string }>;
        errors: Array<{ url: string; error: string }>;
      };
      if (!res.ok) throw new Error('저장 API 오류');

      const urlMap = new Map<string, string>(data.results.map((r) => [r.originalUrl, r.savedUrl]));
      const updatedEntries = entries.map((e) => {
        const newUrl = urlMap.get(e.url);
        return newUrl ? { ...e, url: newUrl, key: newUrl } : e;
      });
      const remapOrder = (arr: string[]) =>
        arr.map((k) => {
          const entry = entries.find((e) => e.key === k);
          if (!entry) return k;
          return urlMap.get(entry.url) ?? k;
        });
      applyUpdate(updatedEntries, remapOrder(thumbOrder), remapOrder(detailOrder));
      setSaveStatus(data.errors?.length > 0 ? 'error' : 'done');
      if (data.errors?.length > 0) setSaveErrors(data.errors.map((e) => e.error));
    } catch (err) {
      setSaveStatus('error');
      setSaveErrors([err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.']);
    }
  };

  // ── 파생값: 클릭 순서 기반으로 버킷 구성 ──────────────────────────────────
  const entryMap = new Map(entries.map((e) => [e.key, e]));
  const thumbEntries = thumbOrder.map((k) => entryMap.get(k)).filter(Boolean) as ImageEntry[];
  const detailEntries = detailOrder.map((k) => entryMap.get(k)).filter(Boolean) as ImageEntry[];

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

        {/* ── 썸네일 버킷 ──────────────────────────────────────────────────── */}
        <BucketPanel
          title="📸 썸네일 이미지"
          accentColor="#be0014"
          bg="#fff8f8"
          borderColor="#fecaca"
          entries={thumbEntries}
          emptyText="아래 풀에서 [썸네일] 버튼을 눌러 추가하세요"
          onAiEdit={openEditModal}
          onRemove={(key) => applyUpdate(entries, thumbOrder.filter((k) => k !== key), detailOrder)}
          onPreview={setPreviewUrl}
          selectable
          selectedKeys={selectedMergeKeys}
          onToggleSelect={toggleMergeSelect}
          headerExtra={
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
              {selectedMergeKeys.length > 0 && (
                <span style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 600 }}>
                  {selectedMergeKeys.length}장 선택
                </span>
              )}
              <button
                type="button"
                onClick={handleStartMerge}
                disabled={selectedMergeKeys.length !== 2}
                title={selectedMergeKeys.length === 2 ? '두 이미지를 한 컷으로 합치기' : '체크박스로 정확히 2장을 선택하세요'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '4px 9px', fontSize: '11px', fontWeight: 600,
                  backgroundColor: selectedMergeKeys.length === 2 ? '#7c3aed' : '#ede9fe',
                  color: selectedMergeKeys.length === 2 ? '#fff' : '#a78bfa',
                  border: 'none', borderRadius: '6px',
                  cursor: selectedMergeKeys.length === 2 ? 'pointer' : 'not-allowed',
                }}
              >
                <Sparkles size={11} />선택한 2장 합치기
              </button>
            </div>
          }
        />

        {/* ── 상세페이지 버킷 ──────────────────────────────────────────────── */}
        <BucketPanel
          title="📄 상세페이지 이미지"
          accentColor="#1d4ed8"
          bg="#f0f6ff"
          borderColor="#bfdbfe"
          entries={detailEntries}
          emptyText="아래 풀에서 [상세] 버튼을 눌러 추가하세요"
          onAiEdit={openEditModal}
          onRemove={(key) => applyUpdate(entries, thumbOrder, detailOrder.filter((k) => k !== key))}
          onPreview={setPreviewUrl}
        />

        {/* ── 원본 이미지 풀 ───────────────────────────────────────────────── */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          {/* 풀 헤더 */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '11px 14px', borderBottom: `1px solid ${C.border}`,
              backgroundColor: C.tableHeader, flexWrap: 'wrap', gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>원본 이미지 풀</span>
              <span style={{ fontSize: '11px', color: C.textSub, background: '#fff', border: `1px solid ${C.border}`, borderRadius: '12px', padding: '1px 8px' }}>
                {entries.length}장
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={handleSaveImages}
                disabled={saveStatus === 'saving' || entries.length === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '6px 12px', fontSize: '11px', fontWeight: 600,
                  backgroundColor:
                    saveStatus === 'done' && unsavedCount === 0 ? '#15803d' :
                    saveStatus === 'error' ? '#b91c1c' :
                    saveStatus === 'saving' ? '#94a3b8' : '#1d4ed8',
                  color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
                }}
              >
                {saveStatus === 'saving'
                  ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />저장 중</>
                  : saveStatus === 'done' && unsavedCount === 0
                    ? <><CheckCircle2 size={11} />저장 완료</>
                    : <><CloudUpload size={11} />{unsavedCount > 0 ? `이미지 저장 (${unsavedCount})` : '이미지 저장'}</>
                }
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '6px 12px', fontSize: '11px', fontWeight: 600,
                  backgroundColor: C.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
                }}
              >
                <Upload size={11} />이미지 추가
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
            </div>
          </div>

          {/* 저장 오류 */}
          {saveStatus === 'error' && saveErrors.length > 0 && (
            <div style={{ padding: '8px 14px', backgroundColor: '#fee2e2', borderBottom: `1px solid ${C.border}`, fontSize: '11px', color: '#b91c1c', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>{saveErrors.slice(0, 3).join(' / ')}</div>
            </div>
          )}

          {/* 이미지 그리드 */}
          {entries.length === 0 ? (
            <div style={{ padding: '36px', textAlign: 'center', fontSize: '13px', color: C.textSub }}>
              이미지가 없습니다. Step 1에서 URL을 파싱하거나 위 버튼으로 업로드하세요.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', padding: '12px' }}>
              {entries.map((entry) => (
                <PoolImageCell
                  key={entry.key}
                  entry={{ ...entry, inThumb: thumbOrder.includes(entry.key), inDetail: detailOrder.includes(entry.key) }}
                  saved={isSavedUrl(entry.url)}
                  onToggleThumb={() => toggleThumb(entry.key)}
                  onToggleDetail={() => toggleDetail(entry.key)}
                  onAiEdit={() => openEditModal(entry)}
                  onRemove={() => removeEntry(entry.key)}
                  onPreview={() => setPreviewUrl(entry.url)}
                />
              ))}
            </div>
          )}

          {/* 저장 완료 안내 */}
          {saveStatus === 'done' && unsavedCount === 0 && entries.length > 0 && (
            <div style={{ padding: '8px 14px', backgroundColor: '#dcfce7', borderTop: `1px solid #86efac`, fontSize: '11px', color: '#15803d', fontWeight: 600 }}>
              ✓ 모든 이미지가 Supabase Storage에 저장되었습니다.
            </div>
          )}
        </div>
      </div>

      {/* ── AI 편집 모달 ────────────────────────────────────────────────────── */}
      {editModal && (
        <AiEditModal
          modal={editModal}
          onPromptChange={(prompt) => setEditModal((prev) => prev && { ...prev, prompt })}
          onConfirm={handleAiEdit}
          onClose={() => setEditModal(null)}
        />
      )}

      {/* ── 두 이미지 합치기 모달 ────────────────────────────────────────────── */}
      {mergeTarget && (
        <SharedAiEditModal
          imageUrl={mergeTarget.url1}
          imageUrl2={mergeTarget.url2}
          imageFile={null}
          onClose={() => setMergeTarget(null)}
          onSave={handleMergeSaved}
        />
      )}

      {/* ── 이미지 미리보기 라이트박스 ────────────────────────────────────────── */}
      {previewUrl && (
        <div
          style={{
            position: 'fixed', inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            zIndex: 9100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            style={{
              position: 'absolute', top: '16px', right: '16px',
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="미리보기"
            style={{
              maxWidth: '90vw', maxHeight: '90vh',
              objectFit: 'contain', borderRadius: '8px',
              boxShadow: '0 8px 60px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 버킷 패널 (썸네일 / 상세페이지)
// ─────────────────────────────────────────────────────────────────────────────

interface BucketPanelProps {
  title: string;
  accentColor: string;
  bg: string;
  borderColor: string;
  entries: ImageEntry[];
  emptyText: string;
  onAiEdit: (entry: ImageEntry) => void;
  onRemove: (key: string) => void;
  onPreview: (url: string) => void;
  /** 합치기 등 다중 선택 모드 활성화 */
  selectable?: boolean;
  selectedKeys?: string[];
  onToggleSelect?: (key: string) => void;
  /** 헤더 우측에 노출할 추가 컨트롤 (예: 합치기 버튼) */
  headerExtra?: React.ReactNode;
}

function BucketPanel({
  title, accentColor, bg, borderColor, entries, emptyText,
  onAiEdit, onRemove, onPreview,
  selectable = false, selectedKeys, onToggleSelect, headerExtra,
}: BucketPanelProps) {
  return (
    <div
      style={{
        backgroundColor: bg,
        border: `1.5px solid ${borderColor}`,
        borderRadius: '10px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '9px 12px', borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 700, color: accentColor }}>{title}</span>
        <span
          style={{
            fontSize: '10px', fontWeight: 600,
            background: accentColor, color: '#fff',
            borderRadius: '10px', padding: '0 7px',
          }}
        >
          {entries.length}
        </span>
        {headerExtra}
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: '10px 12px', fontSize: '11px', color: accentColor, opacity: 0.6 }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '10px 12px' }}>
          {entries.map((entry, idx) => {
            const isSelected = selectable && selectedKeys?.includes(entry.key);
            return (
              <div key={entry.key} style={{ position: 'relative', width: '60px', height: '60px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.url}
                  alt={`이미지 ${idx + 1}`}
                  style={{
                    width: '60px', height: '60px', objectFit: 'cover',
                    borderRadius: '7px',
                    border: isSelected ? '2px solid #7c3aed' : `1.5px solid ${borderColor}`,
                    display: 'block', cursor: 'zoom-in',
                  }}
                  onClick={() => onPreview(entry.url)}
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                />
                {/* 순서 번호 */}
                <span
                  style={{
                    position: 'absolute', top: '3px', left: '3px',
                    fontSize: '8px', fontWeight: 800,
                    background: accentColor, color: '#fff',
                    borderRadius: '3px', padding: '0 4px',
                    pointerEvents: 'none',
                  }}
                >
                  {idx + 1}
                </span>
                {/* 합치기 선택 체크박스 (selectable 모드에서만) */}
                {selectable && onToggleSelect && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={!!isSelected}
                    aria-label={`${idx + 1}번 이미지 합치기 대상 선택`}
                    title="합치기 대상으로 선택"
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(entry.key); }}
                    style={{
                      position: 'absolute', bottom: '3px', right: '3px',
                      width: '16px', height: '16px', padding: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: isSelected ? '#7c3aed' : 'rgba(255,255,255,0.92)',
                      border: isSelected ? '1px solid #7c3aed' : '1px solid rgba(0,0,0,0.2)',
                      borderRadius: '4px', cursor: 'pointer',
                      color: '#fff', fontSize: '10px', lineHeight: 1, fontWeight: 800,
                    }}
                  >
                    {isSelected ? '✓' : ''}
                  </button>
                )}
                {/* AI 편집 */}
                <button
                  onClick={(e) => { e.stopPropagation(); onAiEdit(entry); }}
                  title="AI 편집"
                  style={{
                    position: 'absolute', bottom: '3px', left: '3px',
                    fontSize: '8px', fontWeight: 700,
                    background: 'rgba(0,0,0,0.62)', color: '#fff',
                    border: 'none', borderRadius: '3px', padding: '1px 5px', cursor: 'pointer',
                  }}
                >
                  AI
                </button>
                {/* 제거 */}
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(entry.key); }}
                  title="제거"
                  style={{
                    position: 'absolute', top: '3px', right: '3px',
                    width: '15px', height: '15px', borderRadius: '50%',
                    background: 'rgba(0,0,0,0.5)', border: 'none',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: '10px', lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 풀 이미지 셀
// ─────────────────────────────────────────────────────────────────────────────

interface PoolImageCellProps {
  entry: ImageEntry;
  saved: boolean;
  onToggleThumb: () => void;
  onToggleDetail: () => void;
  onAiEdit: () => void;
  onRemove: () => void;
  onPreview: () => void;
}

function PoolImageCell({ entry, saved, onToggleThumb, onToggleDetail, onAiEdit, onRemove, onPreview }: PoolImageCellProps) {
  const [hovered, setHovered] = useState(false);

  const borderColor =
    entry.inThumb && entry.inDetail ? '#7c3aed' :
    entry.inThumb ? '#be0014' :
    entry.inDetail ? '#1d4ed8' : C.border;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {/* 이미지 */}
      <div
        style={{
          position: 'relative', aspectRatio: '4/3', borderRadius: '8px',
          overflow: 'hidden', backgroundColor: '#f3f4f6',
          border: `2px solid ${borderColor}`, transition: 'border-color 0.15s',
          cursor: 'pointer',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onPreview}
      >
        {/* T / D 배지 */}
        <div style={{ position: 'absolute', top: '4px', left: '4px', display: 'flex', gap: '2px', zIndex: 5 }}>
          {entry.inThumb && (
            <span style={{ fontSize: '8px', fontWeight: 800, background: '#be0014', color: '#fff', borderRadius: '3px', padding: '0 4px' }}>T</span>
          )}
          {entry.inDetail && (
            <span style={{ fontSize: '8px', fontWeight: 800, background: '#1d4ed8', color: '#fff', borderRadius: '3px', padding: '0 4px' }}>D</span>
          )}
        </div>

        {/* 저장 상태 */}
        <div
          style={{
            position: 'absolute', top: '4px', right: '4px', zIndex: 5,
            width: '16px', height: '16px', borderRadius: '50%',
            background: saved ? '#15803d' : '#b45309',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title={saved ? 'Supabase에 저장됨' : '아직 저장 안 됨'}
        >
          {saved ? <CheckCircle2 size={10} color="#fff" /> : <CloudUpload size={9} color="#fff" />}
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={entry.url}
          alt="이미지"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
        />

        {/* hover overlay */}
        {hovered && (
          <div
            style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
            }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onAiEdit(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '3px',
                padding: '5px 9px', fontSize: '10px', fontWeight: 700,
                background: '#fff', color: C.accent,
                border: 'none', borderRadius: '5px', cursor: 'pointer',
              }}
            >
              <Sparkles size={10} />AI 편집
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      {/* 썸네일 / 상세 토글 버튼 */}
      <div style={{ display: 'flex', gap: '3px' }}>
        <button
          onClick={onToggleThumb}
          style={{
            flex: 1, padding: '4px 0', fontSize: '10px', fontWeight: 700,
            background: entry.inThumb ? '#fee2e2' : '#f1f5f9',
            color: entry.inThumb ? '#be0014' : '#94a3b8',
            border: `1px solid ${entry.inThumb ? '#fca5a5' : '#e2e8f0'}`,
            borderRadius: '4px', cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          썸네일
        </button>
        <button
          onClick={onToggleDetail}
          style={{
            flex: 1, padding: '4px 0', fontSize: '10px', fontWeight: 700,
            background: entry.inDetail ? '#dbeafe' : '#f1f5f9',
            color: entry.inDetail ? '#1d4ed8' : '#94a3b8',
            border: `1px solid ${entry.inDetail ? '#93c5fd' : '#e2e8f0'}`,
            borderRadius: '4px', cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          상세
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: AI 편집 모달
// ─────────────────────────────────────────────────────────────────────────────

interface AiEditModalProps {
  modal: EditModalState;
  onPromptChange: (prompt: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

function AiEditModal({ modal, onPromptChange, onConfirm, onClose }: AiEditModalProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          backgroundColor: '#fff', borderRadius: '14px', padding: '24px',
          width: '100%', maxWidth: '440px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', gap: '16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={16} color={C.accent} />
            <span style={{ fontSize: '15px', fontWeight: 700, color: C.text }}>AI 이미지 편집</span>
          </div>
          <button
            onClick={onClose}
            disabled={modal.loading}
            style={{
              width: '28px', height: '28px', borderRadius: '50%',
              border: `1px solid ${C.border}`, backgroundColor: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: modal.loading ? 'not-allowed' : 'pointer', color: C.textSub,
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ aspectRatio: '4/3', borderRadius: '10px', overflow: 'hidden', backgroundColor: '#f3f4f6', border: `1px solid ${C.border}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={modal.imageUrl}
            alt="편집 대상 이미지"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: C.textSub, marginBottom: '6px' }}>
            편집 지시사항
          </label>
          <textarea
            value={modal.prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            disabled={modal.loading}
            placeholder="예: 배경을 흰색으로 바꿔주세요. 상품이 더 밝게 보이도록 조명을 개선해주세요."
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', fontSize: '13px',
              border: `1px solid ${C.border}`, borderRadius: '8px', outline: 'none',
              color: C.text, backgroundColor: modal.loading ? '#f9f9f9' : '#fff',
              resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
            }}
          />
        </div>

        {modal.error && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c' }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
            {modal.error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={modal.loading}
            style={{ padding: '9px 18px', fontSize: '13px', fontWeight: 600, backgroundColor: '#fff', color: C.textSub, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: modal.loading ? 'not-allowed' : 'pointer' }}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={modal.loading || !modal.prompt.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '9px 18px', fontSize: '13px', fontWeight: 700,
              backgroundColor: modal.loading || !modal.prompt.trim() ? '#ccc' : C.accent,
              color: '#fff', border: 'none', borderRadius: '8px',
              cursor: modal.loading || !modal.prompt.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {modal.loading
              ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />편집 중...</>
              : <><Sparkles size={13} />편집 시작</>}
          </button>
        </div>
      </div>
    </div>
  );
}
