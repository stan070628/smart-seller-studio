'use client';

/**
 * Step3ReviewRegister.tsx
 * Step 3 — 좌측: AI 생성 + 미리보기 + AI 수정 / 우측: 등록 폼 (AI 자동완성)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy, CheckCheck, Download, AlertCircle, Plus, Loader2,
  RefreshCw, AlertTriangle, Sparkles, BookmarkCheck,
} from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import CoupangAutoRegisterPanel from '@/components/listing/workflow/CoupangAutoRegisterPanel';
import NaverAutoRegisterPanel from '@/components/listing/workflow/NaverAutoRegisterPanel';
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import { renderAllSections } from '@/lib/detail-page/section-renderer';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
import type { DetailPageTheme, DetailSection } from '@/types/detail-page';

const AI_STEPS = [
  { label: '이미지 분석', activeOn: 'analyzing' as const },
  { label: 'HTML 생성', activeOn: 'generating' as const },
];

const PREVIEW_GUIDE_CSS = `
  [data-section-id] {
    position: relative;
    outline: 1px dashed transparent;
    outline-offset: -2px;
    transition: outline-color 120ms ease, background-color 120ms ease;
  }
  [data-section-id]:hover {
    outline-color: #7c3aed;
    background-image: linear-gradient(rgba(124, 58, 237, 0.035), rgba(124, 58, 237, 0.035));
  }
  [data-section-id]:hover::before {
    content: attr(data-section-label);
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 20;
    padding: 4px 8px;
    border-radius: 6px;
    background: #5b21b6;
    color: #fff;
    font: 700 12px/1.2 system-ui, -apple-system, sans-serif;
    box-shadow: 0 4px 14px rgba(0,0,0,0.18);
    pointer-events: none;
  }
  [data-edit-path] {
    border-radius: 4px;
    cursor: text;
    min-height: 1em;
  }
  [data-edit-path]:hover {
    box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.24);
  }
  [data-edit-path][contenteditable="true"]:focus {
    outline: 2px solid #7c3aed;
    outline-offset: 2px;
    background: rgba(255,255,255,0.72);
  }
`;

function renderSectionsHtml(sections: DetailSection[], theme: DetailPageTheme) {
  const renderedSections = renderAllSections(sections, theme);
  const snippet = `<div style="max-width:780px;margin:0 auto;font-family:sans-serif;">\n${renderedSections}\n</div>`;
  return { snippet, html: appendPrivacyFooter(snippet) };
}

function updatePathValue(target: unknown, parts: string[], value: string): unknown {
  if (parts.length === 0) return value;
  const [head, ...rest] = parts;
  if (Array.isArray(target)) {
    const index = Number(head);
    const next = [...target];
    next[index] = updatePathValue(next[index], rest, value);
    return next;
  }
  if (target && typeof target === 'object') {
    return {
      ...(target as Record<string, unknown>),
      [head]: updatePathValue((target as Record<string, unknown>)[head], rest, value),
    };
  }
  return target;
}

function updateSectionText(section: DetailSection, path: string, value: string): DetailSection {
  return updatePathValue(section, path.split('.'), value) as DetailSection;
}

function buildEditablePreviewDocument(html: string) {
  const script = `
    (() => {
      const post = (type, el) => {
        const section = el.closest('[data-section-id]');
        if (!section) return;
        window.parent.postMessage({
          source: 'detail-preview-inline-editor',
          type,
          sectionId: section.getAttribute('data-section-id'),
          path: el.getAttribute('data-edit-path'),
          value: el.textContent || ''
        }, '*');
      };
      document.querySelectorAll('[data-edit-path]').forEach((el) => {
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
        el.addEventListener('input', () => post('input', el));
        el.addEventListener('blur', () => post('commit', el));
      });
    })();
  `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${PREVIEW_GUIDE_CSS}</style>
</head>
<body style="margin:0;background:#fff;">
${html}
<script>${script}</script>
</body>
</html>`;
}

export default function Step3ReviewRegister() {
  const {
    sharedDraft,
    updateSharedDraft,
    resetWorkflow,
    generateDetailPageFromPicked,
    setDetailPageSections,
    setDetailPageTheme,
    updateDetailPageSection,
  } = useListingStore();

  const {
    detailPageFullHtml,
    detailPageSnippet,
    detailPageSnippetNaver,
    description,
    name,
    detailPageStatus,
    detailPageError,
    pickedDetailImages,
    thumbnailImages,
    detailImages,
    sourceUrl,
    selectedPlatform,
    detailPageSections,
    detailPageTheme,
  } = sharedDraft;

  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetNaverCopied, setSnippetNaverCopied] = useState(false);
  const [copiedImageIndex, setCopiedImageIndex] = useState<number | null>(null);
  const [copiedSourceUrl, setCopiedSourceUrl] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(true);

  // 렌더링 갱신 상태
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const sectionsRef = useRef(detailPageSections);

  useEffect(() => {
    sectionsRef.current = detailPageSections;
  }, [detailPageSections]);

  // 레거시 모드: 섹션 데이터 없이 HTML만 있는 경우 iframe 표시
  const isLegacyMode = detailPageSections.length === 0 && !!detailPageFullHtml;

  // 쿠팡 임시저장
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const hasHtml = !!detailPageFullHtml;
  const hasDescription = !!description;
  const hasImages =
    pickedDetailImages.length > 0 ||
    thumbnailImages.length > 0 ||
    detailImages.length > 0;

  const isGenerating =
    detailPageStatus === 'analyzing' || detailPageStatus === 'generating';

  const applyRenderedSections = useCallback(
    (sections: DetailSection[], theme = detailPageTheme) => {
      const rendered = renderSectionsHtml(sections, theme);
      updateSharedDraft({
        detailPageFullHtml: rendered.html,
        detailPageSnippet: rendered.snippet,
        description: rendered.snippet,
      });
    },
    [detailPageTheme, updateSharedDraft],
  );

  const handleSectionsChange = useCallback(
    (sections: DetailSection[]) => {
      sectionsRef.current = sections;
      setDetailPageSections(sections);
      applyRenderedSections(sections);
    },
    [applyRenderedSections, setDetailPageSections],
  );

  const handleThemeChange = useCallback(
    (theme: DetailPageTheme) => {
      setDetailPageTheme(theme);
      applyRenderedSections(sectionsRef.current, theme);
    },
    [applyRenderedSections, setDetailPageTheme],
  );

  const editablePreviewHtml = useMemo(
    () => (detailPageFullHtml ? buildEditablePreviewDocument(detailPageFullHtml) : ''),
    [detailPageFullHtml],
  );

  const handleInlinePreviewEdit = useCallback(
    (sectionId: string, path: string, value: string, commit: boolean) => {
      const next = sectionsRef.current.map((section) =>
        section.id === sectionId ? updateSectionText(section, path, value) : section,
      );
      sectionsRef.current = next;
      setDetailPageSections(next);
      if (commit) applyRenderedSections(next);
    },
    [applyRenderedSections, setDetailPageSections],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        sectionId?: string;
        path?: string;
        value?: string;
      };
      if (data?.source !== 'detail-preview-inline-editor') return;
      if (!data.sectionId || !data.path || typeof data.value !== 'string') return;
      handleInlinePreviewEdit(data.sectionId, data.path, data.value, data.type === 'commit');
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handleInlinePreviewEdit]);

  const getStepState = (index: number): 'done' | 'active' | 'idle' | 'error' => {
    if (detailPageStatus === 'error') return index === 0 ? 'error' : 'idle';
    if (detailPageStatus === 'done') return 'done';
    if (detailPageStatus === 'analyzing') return index === 0 ? 'active' : 'idle';
    if (detailPageStatus === 'generating') return index === 0 ? 'done' : 'active';
    return 'idle';
  };

  // 썸네일 URL 복사
  const handleCopyImageUrl = async (url: string, index: number) => {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedImageIndex(index);
    setTimeout(() => setCopiedImageIndex(null), 2000);
  };

  const handleCopySourceUrl = async () => {
    if (!sourceUrl) return;
    await navigator.clipboard.writeText(sourceUrl).catch(() => {});
    setCopiedSourceUrl(true);
    setTimeout(() => setCopiedSourceUrl(false), 2000);
  };

  // 복사 / 다운로드
  const handleCopy = async () => {
    const html = detailPageFullHtml || description;
    if (!html) return;
    await navigator.clipboard.writeText(html).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSnippetCopy = async () => {
    if (!detailPageSnippet) return;
    await navigator.clipboard.writeText(detailPageSnippet).catch(() => {});
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 2000);
  };

  const handleSnippetNaverCopy = async () => {
    if (!detailPageSnippetNaver) return;
    await navigator.clipboard.writeText(detailPageSnippetNaver).catch(() => {});
    setSnippetNaverCopied(true);
    setTimeout(() => setSnippetNaverCopied(false), 2000);
  };

  const handleDownload = () => {
    const html = detailPageFullHtml || description;
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = name
      ? name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40)
      : 'detail-page';
    a.download = `${safeName}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 전체 HTML 재렌더링
  const refreshRenderedHtml = async () => {
    if (detailPageSections.length === 0) return;
    setIsRendering(true);
    setRenderError(null);
    try {
      applyRenderedSections(detailPageSections);
    } catch {
      setRenderError('미리보기 갱신 중 오류가 발생했습니다.');
    } finally {
      setIsRendering(false);
    }
  };

  // 섹션 단위 AI 편집
  const handleSectionAiEdit = async (section: DetailSection, instruction: string): Promise<void> => {
    const res = await fetch('/api/detail-page/edit-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        instruction,
        theme: detailPageTheme,
        productName: name,
        existingSections: detailPageSections.map((s) => ({ type: s.type, content: s.content })),
      }),
    });
    let json: Record<string, unknown>;
    try {
      json = await res.json();
    } catch {
      throw new Error(`섹션 편집 실패 (${res.status})`);
    }
    if (!res.ok) throw new Error((json.error as string | undefined) ?? '섹션 편집 실패');
    updateDetailPageSection(section.id, json.section as DetailSection);
    await refreshRenderedHtml();
  };

  // 임시저장 (sharedDraft 전체 저장)
  const handleSaveDraft = async () => {
    if (draftSaving) return;
    setDraftSaving(true);
    setDraftError(null);
    try {
      const res = await fetch('/api/listing/coupang/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: sharedDraft.name || '이름 없음',
          sourceType: 'workflow',
          sourceUrl: sharedDraft.sourceUrl ?? null,
          draftData: sharedDraft,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.id) throw new Error(json.error ?? '임시저장 실패');
      setDraftSaved(json.id);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : '임시저장 중 오류가 발생했습니다.');
    } finally {
      setDraftSaving(false);
    }
  };

  function handleCoupangRegistered() {
    setRegistered(true);
  }

  function handleNaverRegistered(_originProductNo: number) {
    setRegistered(true);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* 등록 성공 배너 */}
      {registered && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCheck size={15} color="#fff" />
            </div>
            <div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: '#14532d', margin: 0 }}>등록 완료!</p>
              <p style={{ fontSize: '12px', color: '#15803d', margin: 0 }}>마켓에 상품이 등록되었습니다.</p>
            </div>
          </div>
          <button
            onClick={resetWorkflow}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, backgroundColor: '#15803d', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
          >
            <Plus size={14} />새 상품 등록
          </button>
        </div>
      )}

      {/* ── 3컬럼 레이아웃 ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr 380px', gap: '20px', alignItems: 'start' }}>

        {/* ══ 열 1: 섹션 에디터 + 썸네일 ══════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'sticky', top: '16px', alignSelf: 'start' }}>

          {/* 썸네일 이미지 + 소스 URL */}
          {(thumbnailImages.length > 0 || sourceUrl) && (
            <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: C.text }}>썸네일 이미지</span>
                  {thumbnailImages.length > 0 && (
                    <span style={{ marginLeft: '6px', fontSize: '11px', color: C.textSub }}>{thumbnailImages.length}장</span>
                  )}
                </div>
                {sourceUrl && (
                  <button
                    onClick={handleCopySourceUrl}
                    style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '4px 9px', fontSize: '11px', fontWeight: 600, backgroundColor: copiedSourceUrl ? '#15803d' : '#fff', color: copiedSourceUrl ? '#fff' : C.text, border: `1px solid ${copiedSourceUrl ? '#15803d' : C.border}`, borderRadius: '5px', cursor: 'pointer', transition: 'all 0.15s' }}
                  >
                    {copiedSourceUrl ? <><CheckCheck size={10} />소스 URL 복사됨</> : <><Copy size={10} />소스 URL 복사</>}
                  </button>
                )}
              </div>
              {thumbnailImages.length > 0 ? (
                <div style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {thumbnailImages.map((url, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden', borderRadius: '6px', border: `1px solid ${C.border}`, backgroundColor: '#f8f9fa' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`썸네일 ${i + 1}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </div>
                      <button
                        onClick={() => handleCopyImageUrl(url, i)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
                          padding: '3px 6px', fontSize: '10px', fontWeight: 600,
                          backgroundColor: copiedImageIndex === i ? '#15803d' : '#fff',
                          color: copiedImageIndex === i ? '#fff' : C.textSub,
                          border: `1px solid ${copiedImageIndex === i ? '#15803d' : C.border}`,
                          borderRadius: '4px', cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >
                        {copiedImageIndex === i ? <><CheckCheck size={9} />복사됨</> : <><Copy size={9} />URL 복사</>}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '10px 14px', fontSize: '12px', color: C.textSub }}>
                  썸네일 이미지가 없습니다.
                </div>
              )}
            </div>
          )}

          {/* AI 상세페이지 생성 카드 */}
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: '#f8f4ff',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#7c3aed' }}>✦ AI 상세페이지 생성</div>
                <div style={{ fontSize: '11px', color: '#a78bfa', marginTop: '1px' }}>
                  {hasImages ? '선택된 이미지와 원본 스팩을 기반으로 생성' : '⚠ Step 2에서 이미지를 분류해 주세요'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* 진행 스텝 표시 */}
                {(isGenerating || detailPageStatus === 'done') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {AI_STEPS.map((step, i) => {
                      const state = getStepState(i);
                      return (
                        <React.Fragment key={i}>
                          <div
                            style={{
                              width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                              backgroundColor:
                                state === 'done' ? '#15803d' :
                                state === 'active' ? '#7c3aed' :
                                state === 'error' ? '#b91c1c' : '#e2e8f0',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                            title={step.label}
                          >
                            {state === 'done' && <CheckCheck size={10} color="#fff" />}
                            {state === 'active' && <div style={{ width: '9px', height: '9px', border: '1.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
                            {state === 'error' && <AlertTriangle size={8} color="#fff" />}
                          </div>
                          {i < AI_STEPS.length - 1 && (
                            <div style={{ width: '16px', height: '1px', backgroundColor: state === 'done' ? '#15803d' : '#e2e8f0' }} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
                {detailPageStatus === 'error' && (
                  <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 600 }}>오류 발생</span>
                )}
                {detailPageStatus === 'done' && (
                  <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>생성 완료</span>
                )}
                {hasImages && (
                  <button
                    onClick={() => {
                      updateSharedDraft({ detailPageStatus: 'idle', detailPageError: null });
                      generateDetailPageFromPicked();
                    }}
                    disabled={isGenerating}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '7px 14px', fontSize: '12px', fontWeight: 700,
                      backgroundColor: isGenerating ? '#ede9fe' : '#7c3aed',
                      color: isGenerating ? '#a78bfa' : '#fff',
                      border: 'none', borderRadius: '7px',
                      cursor: isGenerating ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isGenerating
                      ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />생성 중...</>
                      : detailPageStatus === 'done'
                        ? <><RefreshCw size={13} />재생성</>
                        : <><Sparkles size={13} />AI 생성</>}
                  </button>
                )}
              </div>
            </div>

            {/* 에러 메시지 */}
            {detailPageStatus === 'error' && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 16px', backgroundColor: '#fee2e2', fontSize: '12px', color: '#b91c1c' }}>
                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
                {detailPageError ?? '생성 중 오류가 발생했습니다.'}
              </div>
            )}

            {/* 상태 없음 안내 */}
            {detailPageStatus === 'idle' && !hasHtml && (
              <div style={{ padding: '10px 16px', fontSize: '12px', color: C.textSub }}>
                {hasImages ? '위 AI 생성 버튼을 눌러 상세페이지를 만드세요.' : 'Step 2에서 이미지를 분류한 후 생성하세요.'}
              </div>
            )}
          </div>

          {/* 경고: 이미지도 HTML도 없음 */}
          {!hasHtml && !hasDescription && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', backgroundColor: '#fef9c3', border: '1px solid #fde047', borderRadius: '10px', fontSize: '13px', color: '#92400e' }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
              상세페이지가 없습니다. 위에서 AI 생성을 먼저 실행하세요.
            </div>
          )}

          {/* 상세페이지 섹션 에디터 (sections 있을 때 hidePreview=true로 렌더링) */}
          {detailPageSections.length > 0 && (
            <DetailPageEditor
              sections={detailPageSections}
              theme={detailPageTheme}
              isGenerating={isRendering}
              onSectionsChange={handleSectionsChange}
              onThemeChange={handleThemeChange}
              onSectionAiEdit={handleSectionAiEdit}
              onRegenerateAll={generateDetailPageFromPicked}
              generatedHtml={detailPageFullHtml ?? undefined}
              hidePreview
            />
          )}

          {/* 미리보기 갱신 에러 */}
          {renderError && (
            <div style={{ padding: '8px 12px', fontSize: '12px', color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', marginTop: '8px' }}>
              {renderError}
            </div>
          )}

          {/* 원본 description만 있을 때 */}
          {!hasHtml && hasDescription && (
            <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: C.text }}>원본 상세페이지</span>
                <button onClick={handleCopy} style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '4px 9px', fontSize: '11px', fontWeight: 600, backgroundColor: '#fff', color: C.text, border: `1px solid ${C.border}`, borderRadius: '5px', cursor: 'pointer' }}>
                  {copied ? <><CheckCheck size={10} color="#15803d" />복사됨</> : <><Copy size={10} />HTML 복사</>}
                </button>
              </div>
              <iframe srcDoc={description} title="원본 상세페이지" style={{ width: '100%', height: '360px', border: 'none', display: 'block' }} sandbox="allow-same-origin" />
            </div>
          )}

          {/* HTML 스니펫 (쿠팡 + 네이버) — 열 1 하단에 유지 */}
          {(detailPageSnippet || detailPageSnippetNaver) && (
            <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: C.text }}>마켓 HTML 스니펫</span>
                <p style={{ fontSize: '11px', color: C.textSub, margin: '1px 0 0' }}>마켓 상품 등록 › 상세설명 HTML 에디터에 붙여넣기</p>
              </div>
              <div style={{ padding: '10px 14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {detailPageSnippet && (
                  <button
                    onClick={handleSnippetCopy}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 14px', fontSize: '12px', fontWeight: 600, backgroundColor: snippetCopied ? '#15803d' : '#be0014', color: '#fff', border: 'none', borderRadius: '7px', cursor: 'pointer' }}
                  >
                    {snippetCopied ? <><CheckCheck size={12} />복사됨</> : <><Copy size={12} />쿠팡용 780px</>}
                  </button>
                )}
                {detailPageSnippetNaver && (
                  <button
                    onClick={handleSnippetNaverCopy}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 14px', fontSize: '12px', fontWeight: 600, backgroundColor: snippetNaverCopied ? '#15803d' : '#03c75a', color: '#fff', border: 'none', borderRadius: '7px', cursor: 'pointer' }}
                  >
                    {snippetNaverCopied ? <><CheckCheck size={12} />복사됨</> : <><Copy size={12} />네이버용 860px</>}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 임시저장 */}
          <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>임시저장</div>
                <div style={{ fontSize: '11px', color: C.textSub, marginTop: '2px' }}>
                  현재 작업 내용을 저장하고 나중에 이어서 진행합니다
                </div>
              </div>
              <button
                onClick={handleSaveDraft}
                disabled={draftSaving}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', fontSize: '12px', fontWeight: 700,
                  backgroundColor: draftSaved ? '#15803d' : draftSaving ? '#ccc' : C.accent,
                  color: '#fff', border: 'none', borderRadius: '7px',
                  cursor: draftSaving ? 'not-allowed' : 'pointer',
                }}
              >
                {draftSaving
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />저장 중...</>
                  : draftSaved
                    ? <><BookmarkCheck size={13} />저장됨</>
                    : <><BookmarkCheck size={13} />임시저장</>}
              </button>
            </div>
            {draftSaved && (
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#15803d', background: '#dcfce7', borderRadius: '5px', padding: '5px 10px' }}>
                <span>✓ 임시저장 완료</span>
                <button
                  onClick={() => useListingStore.getState().setListingMode('drafts')}
                  style={{ fontSize: '11px', fontWeight: 600, color: '#15803d', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  목록에서 보기 →
                </button>
              </div>
            )}
            {draftError && (
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#b91c1c' }}>
                <AlertCircle size={12} />{draftError}
              </div>
            )}
          </div>
        </div>

        {/* ══ 열 2: 대형 미리보기 패널 ══════════════════════ */}
        <div style={{ position: 'sticky', top: '16px', alignSelf: 'start' }}>
          {(detailPageSections.length > 0 || isLegacyMode) ? (
            <>
              {/* 미리보기 헤더 */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 16px',
                  background: '#fff',
                  border: `1px solid ${C.border}`,
                  borderRadius: '12px 12px 0 0',
                  borderBottom: 'none',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>미리보기</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {/* 렌더링 스피너 */}
                  {isRendering && (
                    <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: C.textSub }} />
                  )}
                  {/* 렌더 에러 */}
                  {renderError && (
                    <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 600 }}>갱신 오류</span>
                  )}
                  {/* HTML 복사 버튼 */}
                  <button
                    onClick={handleCopy}
                    style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '4px 9px', fontSize: '11px', fontWeight: 600, backgroundColor: '#fff', color: C.text, border: `1px solid ${C.border}`, borderRadius: '5px', cursor: 'pointer' }}
                  >
                    {copied ? <><CheckCheck size={10} color="#15803d" />복사됨</> : <><Copy size={10} />HTML 복사</>}
                  </button>
                  {/* 다운로드 버튼 */}
                  <button
                    onClick={handleDownload}
                    style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '4px 9px', fontSize: '11px', fontWeight: 600, backgroundColor: C.text, color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                  >
                    <Download size={10} />다운로드
                  </button>
                </div>
              </div>
              {/* iframe 미리보기 */}
              {detailPageFullHtml ? (
                <iframe
                  srcDoc={editablePreviewHtml}
                  title="상세페이지 미리보기"
                  style={{
                    width: '100%',
                    height: '780px',
                    border: `1px solid ${C.border}`,
                    borderRadius: '0 0 12px 12px',
                    background: '#fff',
                    display: 'block',
                  }}
                  sandbox="allow-same-origin allow-scripts"
                />
              ) : (
                /* 빈 상태 */
                <div
                  style={{
                    height: '780px',
                    border: `1px solid ${C.border}`,
                    borderRadius: '0 0 12px 12px',
                    background: '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    color: C.textSub,
                    textAlign: 'center',
                    padding: '32px',
                  }}
                >
                  <div
                    style={{
                      width: '56px', height: '56px', borderRadius: '50%',
                      background: '#f5f5f5',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Download size={24} style={{ color: '#cccccc' }} />
                  </div>
                  <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6 }}>
                    AI로 상세페이지를 생성하면
                    <br />
                    여기에 미리보기가 표시됩니다.
                  </p>
                </div>
              )}
            </>
          ) : (
            /* 섹션도 레거시 HTML도 없을 때 빈 안내 */
            <div
              style={{
                height: '400px',
                border: `2px dashed ${C.border}`,
                borderRadius: '12px',
                background: '#fafafa',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                color: C.textSub,
                textAlign: 'center',
                padding: '32px',
              }}
            >
              <div
                style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: '#f5f5f5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Download size={24} style={{ color: '#cccccc' }} />
              </div>
              <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6 }}>
                AI로 상세페이지를 생성하면
                <br />
                여기에 미리보기가 표시됩니다.
              </p>
            </div>
          )}
        </div>

        {/* ══ 열 3: 등록 폼 ══════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {showRegisterForm && !registered && (
            <>
              <CoupangAutoRegisterPanel onSuccess={handleCoupangRegistered} />
              {(selectedPlatform === 'naver' || selectedPlatform === 'both') && (
                <div style={{ marginTop: '16px' }}>
                  <NaverAutoRegisterPanel onSuccess={handleNaverRegistered} />
                </div>
              )}
            </>
          )}
          {registered && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '48px 24px', backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCheck size={28} color="#15803d" />
              </div>
              <div>
                <p style={{ fontSize: '16px', fontWeight: 700, color: C.text, margin: '0 0 6px' }}>등록 완료!</p>
                <p style={{ fontSize: '13px', color: C.textSub, margin: 0 }}>상품이 성공적으로 등록되었습니다.</p>
              </div>
              <button
                onClick={resetWorkflow}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 20px', fontSize: '13px', fontWeight: 600, backgroundColor: C.accent, color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
              >
                <Plus size={14} />새 상품 등록
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
