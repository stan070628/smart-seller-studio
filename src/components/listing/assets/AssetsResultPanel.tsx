'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import AiEditModal from '@/components/listing/AiEditModal';
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import ConversationalDetailModal from './ConversationalDetailModal';
import { contentToSections } from '@/lib/detail-page/section-parser';
import type { CategoryKey, ConversationContext } from '@/lib/conversational-detail/types';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import { buildAiDetailPageHtml } from '@/lib/detail-page/ai-html-builder';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
import { renderAllSections } from '@/lib/detail-page/section-renderer';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
import { ROLE_LABELS } from './roleLabels';
import SceneImageDrawer from './SceneImageDrawer';

const CATEGORY_OPTIONS: Array<{ key: CategoryKey; label: string }> = [
  { key: 'basic', label: '기본' },
  { key: 'fashion', label: '패션' },
  { key: 'living', label: '리빙' },
  { key: 'food', label: '식품' },
];

export default function AssetsResultPanel() {
  const { assetsDraft, updateAssetsDraft, sharedDraft, updateSharedDraft, setCurrentStep, setListingMode } = useListingStore();
  const {
    generatedThumbnails,
    generatedDetailHtml,
    detailPageSections,
    detailPageTheme,
    aiImageSlots,
    aiDetailContent,
    includeAiImages,
  } = assetsDraft;
  const hasResult = generatedThumbnails.length > 0 || generatedDetailHtml.length > 0;

  // 상세페이지 렌더 상태
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  // 씬 이미지 드로어 — 클릭된 슬롯 인덱스
  const [activeDrawerIndex, setActiveDrawerIndex] = useState<number | null>(null);

  // Q&A 개선 모달 상태
  const [improveModalOpen, setImproveModalOpen] = useState(false);
  const [improveCategory, setImproveCategory] = useState<CategoryKey>('basic');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // 썸네일 이미지 AI 편집 모달
  const [imageEditTarget, setImageEditTarget] = useState<{ url: string; index: number } | null>(null);

  // 합치기용 다중 선택 상태 (썸네일 인덱스의 집합)
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  // 합치기 모달 타겟 (선택된 썸네일 2장의 URL)
  const [mergeTarget, setMergeTarget] = useState<{ url1: string; url2: string } | null>(null);

  const [sectionImageEditTarget, setSectionImageEditTarget] = useState<{
    sectionId: string;
    imageUrl: string;
    imageIndex: number;
  } | null>(null);

  // 렌더링된 HTML 갱신 (data-edit-path 포함 HTML 반환)
  const refreshRenderedHtml = async (
    sections: DetailSection[] = detailPageSections,
    theme: DetailPageTheme = detailPageTheme,
  ) => {
    if (sections.length === 0) return;
    setIsRendering(true);
    setRenderError(null);
    try {
      const res = await fetch('/api/detail-page/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections, theme }),
      });
      const json = await res.json();
      if (res.ok) {
        updateAssetsDraft({ generatedDetailHtml: json.html });
      } else {
        setRenderError(json.error ?? '미리보기 갱신에 실패했습니다.');
      }
    } catch {
      setRenderError('미리보기 갱신 중 오류가 발생했습니다.');
    } finally {
      setIsRendering(false);
    }
  };

  // 대화 완료 후 sections가 처음 채워질 때 한 번만 render 호출 → data-edit-path 포함 HTML 확보
  const prevSectionsLengthRef = useRef(detailPageSections.length);
  useEffect(() => {
    // includeAiImages=true이고 aiDetailContent가 있으면 AI HTML을 직접 빌드했으므로 render API 자동 호출 불필요
    // 일반 생성(includeAiImages=false)에서는 refreshRenderedHtml로 data-edit-path 포함 HTML 확보
    if (prevSectionsLengthRef.current === 0 && detailPageSections.length > 0 && !(includeAiImages && aiDetailContent)) {
      void refreshRenderedHtml(detailPageSections, detailPageTheme);
    }
    prevSectionsLengthRef.current = detailPageSections.length;
  // detailPageTheme, refreshRenderedHtml, includeAiImages, aiDetailContent 의도적 제외:
  // sections가 0→N으로 처음 채워지는 단 한 번만 실행되어야 하므로 exhaustive-deps 억제
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailPageSections]);

  const toggleSelect = (idx: number) => {
    setSelectedIndices((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      // 최대 2장까지만 유지: 이미 2장 선택돼 있으면 가장 먼저 선택한 것을 밀어낸다.
      if (prev.length >= 2) return [prev[1], idx];
      return [...prev, idx];
    });
  };

  const handleStartMerge = () => {
    if (selectedIndices.length !== 2) return;
    const [a, b] = selectedIndices;
    setMergeTarget({
      url1: generatedThumbnails[a],
      url2: generatedThumbnails[b],
    });
  };

  const handleMergeSaved = (resultUrl: string) => {
    // 합쳐진 결과를 그리드에 새 썸네일로 추가하고 선택 해제. 원본 2장은 보존.
    updateAssetsDraft({ generatedThumbnails: [...generatedThumbnails, resultUrl] });
    setMergeTarget(null);
    setSelectedIndices([]);
  };

  const handleSectionImageAiEditSaved = (resultUrl: string) => {
    if (!sectionImageEditTarget) return;
    const { sectionId, imageIndex } = sectionImageEditTarget;
    const updated = detailPageSections.map((s) => {
      if (s.id !== sectionId) return s;
      const newImages = [...s.attachedImages];
      const existing = newImages[imageIndex];
      if (!existing) return s;
      newImages[imageIndex] = { ...existing, url: resultUrl };
      return { ...s, attachedImages: newImages };
    });
    updateAssetsDraft({ detailPageSections: updated });
    void refreshRenderedHtml(updated, detailPageTheme);
    setSectionImageEditTarget(null);
  };

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

  // 썸네일 URL은 data:, Supabase 공개 URL, 외부 사이트 URL이 섞여 들어온다.
  // <a download>는 cross-origin URL에서 무시되므로 fetch → Blob → ObjectURL 경로로 통일한다.
  const urlToBlob = async (url: string): Promise<Blob> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  };

  const inferExt = (blob: Blob, url: string): string => {
    const mime = blob.type.toLowerCase();
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    try {
      const path = new URL(url, window.location.href).pathname.toLowerCase();
      const m = path.match(/\.(jpe?g|png|webp|gif)(?:$|[?#])/);
      if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
    } catch {
      /* noop */
    }
    return 'jpg';
  };

  // 쿠팡 요건(min 1000px)에 맞게 리사이즈된 URL을 반환. 실패 시 원본 URL 그대로 반환.
  const toCoupangUrl = async (url: string): Promise<string> => {
    try {
      const res = await fetch('/api/image/coupang-resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      });
      if (!res.ok) return url;
      const json = await res.json() as { url?: string };
      return json.url ?? url;
    } catch {
      return url;
    }
  };

  // 개별 썸네일 다운로드. fetch가 CORS로 막히면 새 탭에서 열어 사용자가 저장하도록 fallback.
  const handleDownloadOne = async (url: string, idx: number) => {
    try {
      const resizedUrl = await toCoupangUrl(url);
      const blob = await urlToBlob(resizedUrl);
      const ext = inferExt(blob, resizedUrl);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `thumbnail-${idx + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.warn('[assets] 직접 다운로드 실패, 새 탭에서 엽니다:', err);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleGoToRegisterPreview = () => {
    // HTML이 없고 섹션만 있으면 클라이언트에서 즉시 빌드 (Step3 빈 화면 방지)
    let htmlToPass = generatedDetailHtml || null;
    if (!htmlToPass && detailPageSections.length > 0) {
      const snippet = `<div style="max-width:780px;margin:0 auto;font-family:sans-serif;">\n${renderAllSections(detailPageSections, detailPageTheme)}\n</div>`;
      htmlToPass = appendPrivacyFooter(snippet);
    }
    updateSharedDraft({
      detailPageSections,
      detailPageFullHtml: htmlToPass,
      detailPageTheme,
    });
    setCurrentStep(3);
    setListingMode('register');
  };

  // 모든 자산을 ZIP으로 일괄 다운로드. 각 썸네일을 Blob으로 받아서 그대로 zip에 넣는다.
  const handleDownloadZip = async () => {
    try {
      const JSZipMod = await import('jszip');
      const zip = new JSZipMod.default();
      let okCount = 0;
      for (let i = 0; i < generatedThumbnails.length; i++) {
        const url = generatedThumbnails[i];
        try {
          const resizedUrl = await toCoupangUrl(url);
          const blob = await urlToBlob(resizedUrl);
          const ext = inferExt(blob, resizedUrl);
          zip.file(`thumbnail-${i + 1}.${ext}`, blob);
          okCount++;
        } catch (err) {
          console.warn(`[assets] 썸네일 ${i + 1} ZIP 추가 실패:`, err);
        }
      }
      if (generatedDetailHtml) {
        zip.file('detail.html', generatedDetailHtml);
      }
      if (okCount === 0 && !generatedDetailHtml) {
        alert('ZIP에 포함할 자산을 가져오지 못했습니다.');
        return;
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
    } catch (err) {
      alert(`다운로드 중 오류가 발생했습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
  };

  // Q&A 개선 완료 후 스토어 업데이트
  const handleImproveComplete = ({
    html,
    content,
    conversationContext,
  }: {
    html: string;
    content?: DetailPageContent;
    conversationContext: ConversationContext;
  }) => {
    let newSections = assetsDraft.detailPageSections;
    let hasPreservedImages = false;
    if (content) {
      try {
        const parsed = contentToSections(content);
        const existing = assetsDraft.detailPageSections;
        // 개선 후 사용자가 첨부한 소스 이미지/지시사항 보존 (인덱스 + 타입 기준)
        // AI 개선 시 선택 섹션 추가/제거로 인덱스가 달라질 수 있으므로 타입 일치 확인
        newSections = parsed.map((section, idx) => {
          const prev = existing[idx];
          if (!prev || prev.type !== section.type) return section;
          return {
            ...section,
            ...(prev.attachedImages.length > 0 && { attachedImages: prev.attachedImages }),
            ...(prev.aiInstruction && { aiInstruction: prev.aiInstruction }),
          };
        });
        hasPreservedImages = newSections.some((s) => s.attachedImages.length > 0);
      } catch {
        // 파싱 실패 시 silent fallback
      }
    }
    // includeAiImages=true일 때 기존 씬 이미지 슬롯을 새 content에 맞춰 HTML 재빌드
    const finalHtml =
      includeAiImages && content && aiImageSlots.length > 0
        ? appendPrivacyFooter(buildAiDetailPageHtml(content, aiImageSlots))
        : html;
    updateAssetsDraft({
      generatedDetailHtml: finalHtml,
      detailPageSections: newSections,
      aiDetailContent: content ?? null,
      conversationAnswers: conversationContext.answers,
      lastError: null,
    });
    // 소스 이미지가 보존된 경우 미리보기 HTML 재빌드 (AI 씬 이미지 모드는 별도 파이프라인)
    if (hasPreservedImages && !includeAiImages) {
      void refreshRenderedHtml(newSections, detailPageTheme);
    }
    setImproveModalOpen(false);
    setShowCategoryPicker(false);
  };

  // Q&A 개선 버튼 클릭 — 카테고리 설정 여부에 따라 분기
  const handleImproveButtonClick = () => {
    const cat = assetsDraft.category;
    if (cat) {
      setImproveCategory(cat);
      setImproveModalOpen(true);
    } else {
      setShowCategoryPicker(true);
    }
  };

  // 섹션 AI 편집
  const handleSectionAiEdit = async (section: DetailSection, instruction: string): Promise<void> => {
    const res = await fetch('/api/detail-page/edit-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        instruction,
        theme: detailPageTheme,
        existingSections: detailPageSections.map(s => ({ type: s.type, content: s.content })),
      }),
    });
    let json: Record<string, unknown>;
    try {
      json = await res.json();
    } catch {
      throw new Error(`섹션 편집 실패 (${res.status})`);
    }
    if (!res.ok) throw new Error((json.error as string | undefined) ?? '섹션 편집 실패');
    // 편집된 섹션으로 업데이트
    const updatedSection = json.section as DetailSection;
    const updated = detailPageSections.map(s =>
      s.id === section.id ? { ...s, ...updatedSection } : s
    );
    updateAssetsDraft({ detailPageSections: updated });
    await refreshRenderedHtml(updated, detailPageTheme);
  };

  // 썸네일 AI 편집 결과 적용
  const handleImageEditSaved = (resultUrl: string) => {
    if (imageEditTarget === null) return;
    const next = [...generatedThumbnails];
    next[imageEditTarget.index] = resultUrl;
    updateAssetsDraft({ generatedThumbnails: next });
    setImageEditTarget(null);
  };

  const handleReplaceSlot = (index: number, newUrl: string, isReplaced: boolean) => {
    const newSlots = aiImageSlots.map((s, i) => i === index ? { ...s, url: newUrl, isReplaced } : s);
    const patch: Parameters<typeof updateAssetsDraft>[0] = { aiImageSlots: newSlots };
    // aiDetailContent는 includeAiImages=true일 때 slots와 함께 항상 존재하는 불변 조건
    if (aiDetailContent && newSlots.length > 0) {
      patch.generatedDetailHtml = appendPrivacyFooter(buildAiDetailPageHtml(aiDetailContent, newSlots));
    }
    updateAssetsDraft(patch);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* 썸네일 미리보기 + AI 편집 */}
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>
            썸네일 ({generatedThumbnails.length})
            {selectedIndices.length > 0 && (
              <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 500, color: C.textSub }}>
                · {selectedIndices.length}장 선택됨
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleStartMerge}
            disabled={selectedIndices.length !== 2}
            title={selectedIndices.length === 2 ? '두 이미지를 한 컷으로 합치기' : '체크박스로 정확히 2장을 선택하세요'}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '5px 10px', fontSize: '11px', fontWeight: 600,
              backgroundColor: selectedIndices.length === 2 ? '#7c3aed' : '#ede9fe',
              color: selectedIndices.length === 2 ? '#fff' : '#a78bfa',
              border: 'none', borderRadius: '6px',
              cursor: selectedIndices.length === 2 ? 'pointer' : 'not-allowed',
            }}
          >
            <Sparkles size={11} />선택한 2장 합치기
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {generatedThumbnails.map((url, i) => {
            const checked = selectedIndices.includes(i);
            return (
              <div key={`${url}-${i}`} style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`썸네일 ${i + 1}`}
                  style={{
                    width: '120px',
                    height: '120px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    border: checked ? '2px solid #7c3aed' : `1px solid ${C.border}`,
                    display: 'block',
                  }}
                />
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`썸네일 ${i + 1} 합치기 대상으로 선택`}
                  onClick={() => toggleSelect(i)}
                  title="합치기 대상으로 선택"
                  style={{
                    position: 'absolute', top: '4px', left: '4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '20px', height: '20px', padding: 0,
                    backgroundColor: checked ? '#7c3aed' : 'rgba(255,255,255,0.9)',
                    border: checked ? '1px solid #7c3aed' : `1px solid ${C.border}`,
                    borderRadius: '4px', cursor: 'pointer',
                    color: '#fff', fontSize: '12px', lineHeight: 1,
                  }}
                >
                  {checked ? '✓' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setImageEditTarget({ url, index: i })}
                  title="AI로 편집"
                  style={{
                    position: 'absolute', top: '4px', right: '4px',
                    display: 'flex', alignItems: 'center', gap: '3px',
                    padding: '2px 6px', fontSize: '10px', fontWeight: 600,
                    backgroundColor: '#7c3aed', color: '#fff',
                    border: 'none', borderRadius: '4px', cursor: 'pointer',
                  }}
                >
                  <Sparkles size={10} />AI 편집
                </button>
                <button
                  type="button"
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
            );
          })}
        </div>
      </div>

      {/* AI 씬 이미지 카드 그리드 */}
      {aiImageSlots.length > 0 && (
        <div style={{ backgroundColor: '#faf5ff', border: '1px solid #c4b5fd', borderRadius: '12px', padding: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#7c3aed', marginBottom: '12px' }}>
            AI 생성 이미지{' '}
            <span style={{ fontWeight: 400, fontSize: '12px', color: '#9ca3af' }}>— 씬을 클릭해서 교체</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            {aiImageSlots.map((slot, idx) => (
              <div
                key={slot.role}
                onClick={() => setActiveDrawerIndex(idx)}
                style={{
                  cursor: 'pointer',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: activeDrawerIndex === idx ? '2px solid #7c3aed' : '2px solid #e5e7eb',
                  transition: 'border-color 0.15s',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slot.url}
                  alt={ROLE_LABELS[slot.role]}
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                />
                <div style={{
                  padding: '4px 6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#374151',
                  backgroundColor: '#f9fafb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span>{ROLE_LABELS[slot.role]}</span>
                  {slot.isReplaced && <span style={{ color: '#16a34a', fontSize: '10px' }}>✓</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 씬 교체 드로어 */}
      {activeDrawerIndex !== null && (
        <SceneImageDrawer
          slots={aiImageSlots}
          activeIndex={activeDrawerIndex}
          uploadedImages={generatedThumbnails}
          onReplace={handleReplaceSlot}
          onClose={() => setActiveDrawerIndex(null)}
          onSelectScene={setActiveDrawerIndex}
        />
      )}

      {/* 상세페이지 (DetailPageEditor 또는 레거시 iframe) */}
      {generatedDetailHtml.length > 0 && (
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${C.border}`,
            backgroundColor: C.tableHeader,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>상세페이지</span>
            <button
              type="button"
              onClick={handleImproveButtonClick}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '5px 12px', fontSize: '12px', fontWeight: 600,
                backgroundColor: '#fff', color: '#7c3aed',
                border: '1px solid #ddd6fe', borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              💬 Q&A로 개선하기
            </button>
          </div>

          {/* 카테고리 선택 필요 시 인라인 피커 */}
          {showCategoryPicker && (
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: '#f5f3ff' }}>
              <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#5b21b6' }}>카테고리를 선택하세요</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setImproveCategory(opt.key);
                      updateAssetsDraft({ category: opt.key });
                      setShowCategoryPicker(false);
                      setImproveModalOpen(true);
                    }}
                    style={{
                      padding: '5px 12px', fontSize: '12px', borderRadius: '999px',
                      border: '1px solid #ddd6fe', backgroundColor: '#fff',
                      color: '#5b21b6', cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowCategoryPicker(false)}
                  style={{
                    padding: '5px 12px', fontSize: '12px', borderRadius: '999px',
                    border: '1px solid #e5e7eb', backgroundColor: '#fff',
                    color: '#6b7280', cursor: 'pointer',
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          )}
          {renderError && (
            <div style={{ padding: '8px 12px', fontSize: '12px', color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', margin: '8px' }}>
              {renderError}
            </div>
          )}
          {detailPageSections.length > 0 ? (
            <div style={{ padding: '8px' }}>
              <DetailPageEditor
                sections={detailPageSections}
                theme={detailPageTheme}
                isGenerating={isRendering}
                onSectionsChange={(sections) => {
                  updateAssetsDraft({ detailPageSections: sections });
                }}
                onThemeChange={(theme) => {
                  updateAssetsDraft({ detailPageTheme: theme });
                  refreshRenderedHtml(detailPageSections, theme);
                }}
                onSectionAiEdit={handleSectionAiEdit}
                onHtmlCopy={async () => {
                  await navigator.clipboard.writeText(generatedDetailHtml).catch(() => {});
                }}
                onDownload={() => {
                  const blob = new Blob([generatedDetailHtml], { type: 'text/html;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'detail-page.html';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                generatedHtml={generatedDetailHtml}
                onSectionImageAiEdit={(sectionId, imageUrl, imageIndex) =>
                  setSectionImageEditTarget({ sectionId, imageUrl, imageIndex })
                }
              />
            </div>
          ) : (
            /* 레거시 모드: 섹션 없음, HTML만 있음 */
            <div style={{ padding: '8px' }}>
              <iframe
                srcDoc={generatedDetailHtml}
                sandbox="allow-same-origin"
                style={{ width: '100%', height: '500px', border: 'none', borderRadius: '4px' }}
                title="상세페이지 미리보기"
              />
            </div>
          )}
        </div>
      )}

      {/* 액션 버튼 영역 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {(detailPageSections.length > 0 || generatedDetailHtml.length > 0) && (
          <button
            type="button"
            onClick={handleGoToRegisterPreview}
            style={{
              padding: '10px 16px', fontSize: '13px', fontWeight: 600,
              backgroundColor: '#2563eb', color: '#fff',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
            }}
          >
            등록 미리보기로 이동
          </button>
        )}
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
      </div>

      {/* 썸네일 이미지 AI 편집 모달 */}
      {imageEditTarget && (
        <AiEditModal
          imageUrl={imageEditTarget.url}
          imageFile={null}
          onClose={() => setImageEditTarget(null)}
          onSave={handleImageEditSaved}
        />
      )}

      {/* 섹션 이미지 AI 편집 모달 — 상세페이지 컨텍스트 (쿠팡 가이드 강제 없음) */}
      {sectionImageEditTarget && (
        <AiEditModal
          imageUrl={sectionImageEditTarget.imageUrl}
          imageFile={null}
          onClose={() => setSectionImageEditTarget(null)}
          onSave={handleSectionImageAiEditSaved}
          context="detail"
        />
      )}

      {/* 두 이미지 합치기 모달 */}
      {mergeTarget && (
        <AiEditModal
          imageUrl={mergeTarget.url1}
          imageUrl2={mergeTarget.url2}
          imageFile={null}
          onClose={() => setMergeTarget(null)}
          onSave={handleMergeSaved}
        />
      )}

      {/* Q&A 개선 모달 */}
      {improveModalOpen && (
        <ConversationalDetailModal
          productName={sharedDraft.name}
          category={improveCategory}
          imageUrls={assetsDraft.generatedThumbnails}
          initialAnswers={
            assetsDraft.conversationAnswers.length > 0
              ? assetsDraft.conversationAnswers
              : undefined
          }
          onClose={() => { setImproveModalOpen(false); setShowCategoryPicker(false); }}
          onComplete={handleImproveComplete}
        />
      )}
    </div>
  );
}
