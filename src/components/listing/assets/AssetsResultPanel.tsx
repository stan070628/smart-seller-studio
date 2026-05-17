'use client';

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import AiEditModal from '@/components/listing/AiEditModal';
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

export default function AssetsResultPanel() {
  const { assetsDraft, updateAssetsDraft } = useListingStore();
  const {
    generatedThumbnails,
    generatedDetailHtml,
    detailPageSections,
    detailPageTheme,
  } = assetsDraft;
  const hasResult = generatedThumbnails.length > 0 || generatedDetailHtml.length > 0;

  // 상세페이지 렌더 상태
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

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

  // 개별 썸네일 다운로드. fetch가 CORS로 막히면 새 탭에서 열어 사용자가 저장하도록 fallback.
  const handleDownloadOne = async (url: string, idx: number) => {
    try {
      const blob = await urlToBlob(url);
      const ext = inferExt(blob, url);
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

  // 모든 자산을 ZIP으로 일괄 다운로드. 각 썸네일을 Blob으로 받아서 그대로 zip에 넣는다.
  const handleDownloadZip = async () => {
    try {
      const JSZipMod = await import('jszip');
      const zip = new JSZipMod.default();
      let okCount = 0;
      for (let i = 0; i < generatedThumbnails.length; i++) {
        const url = generatedThumbnails[i];
        try {
          const blob = await urlToBlob(url);
          const ext = inferExt(blob, url);
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

  // 렌더링된 HTML 갱신
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

      {/* 상세페이지 (DetailPageEditor 또는 레거시 iframe) */}
      {generatedDetailHtml.length > 0 && (
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>상세페이지</span>
          </div>
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
    </div>
  );
}
