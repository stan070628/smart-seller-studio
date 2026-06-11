'use client';

import React, { useState } from 'react';
import { C } from '@/lib/design-tokens';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';
import { contentToSections } from '@/lib/detail-page/section-parser';
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import DetailMakerInputPanel from '@/components/listing/detail-maker/DetailMakerInputPanel';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

type Category = 'basic' | 'fashion' | 'living' | 'food';

export default function DetailMakerClient() {
  // 입력
  const [productName, setProductName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [category, setCategory] = useState<Category>('basic');
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // 결과
  const [sections, setSections] = useState<DetailSection[]>([]);
  const [theme, setTheme] = useState<DetailPageTheme>(DEFAULT_THEME);
  const [generatedHtml, setGeneratedHtml] = useState<string>('');

  // 진행 상태
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── 이미지 업로드 ──────────────────────────────────────────────────────────
  async function uploadOne(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('usageContext', 'listing_detail');
    const res = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? `업로드 실패 (${res.status})`);
    return json.data.url as string;
  }

  async function handleUploadFiles(files: FileList | File[]) {
    setUploading(true);
    setError(null);
    try {
      const arr = Array.from(files).slice(0, 6 - uploadedUrls.length);
      const urls = await Promise.all(arr.map(uploadOne));
      setUploadedUrls(prev => [...prev, ...urls].slice(0, 6));
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지 업로드 실패');
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveImage(idx: number) {
    setUploadedUrls(prev => prev.filter((_, i) => i !== idx));
  }

  // ─── render API 헬퍼 ────────────────────────────────────────────────────────
  async function refreshRenderedHtml(
    nextSections: DetailSection[],
    nextTheme: DetailPageTheme,
  ) {
    if (nextSections.length === 0) return;
    setIsRendering(true);
    setError(null);
    try {
      const res = await fetch('/api/detail-page/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: nextSections, theme: nextTheme }),
      });
      const json = await res.json();
      if (res.ok) {
        setGeneratedHtml(json.html);
      } else {
        setError(json.error ?? '미리보기 갱신에 실패했습니다.');
      }
    } catch {
      setError('미리보기 갱신 중 오류가 발생했습니다.');
    } finally {
      setIsRendering(false);
    }
  }

  // ─── AI 생성 ────────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!productName.trim()) { setError('상품명을 입력하세요.'); return; }
    if (uploadedUrls.length === 0) { setError('이미지를 1장 이상 업로드하세요.'); return; }
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/generate-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrls: uploadedUrls,
          productName: productName.trim(),
          category,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `생성 실패 (${res.status})`);

      setGeneratedHtml(json.html);

      if (json.content) {
        try {
          const parsed = contentToSections(json.content as DetailPageContent);
          setSections(parsed);
          await refreshRenderedHtml(parsed, theme);
        } catch (e) {
          console.warn('[detail-maker] contentToSections 실패:', e);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  }

  // ─── 섹션/테마 변경 ─────────────────────────────────────────────────────────
  function handleSectionsChange(next: DetailSection[]) {
    setSections(next);
    void refreshRenderedHtml(next, theme);
  }

  function handleThemeChange(next: DetailPageTheme) {
    setTheme(next);
    void refreshRenderedHtml(sections, next);
  }

  // ─── 섹션 AI 편집 ───────────────────────────────────────────────────────────
  async function handleSectionAiEdit(section: DetailSection, instruction: string): Promise<void> {
    const res = await fetch('/api/detail-page/edit-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        instruction,
        theme,
        productName: productName.trim() || undefined,
        existingSections: sections.map(s => ({ type: s.type, content: s.content })),
      }),
    });
    let json: Record<string, unknown>;
    try { json = await res.json(); }
    catch { throw new Error(`섹션 편집 실패 (${res.status})`); }
    if (!res.ok) throw new Error((json.error as string | undefined) ?? '섹션 편집 실패');

    const updatedSection = json.section as DetailSection | undefined;
    if (!updatedSection) throw new Error('섹션 편집 응답이 유효하지 않습니다.');
    const updated = sections.map(s => s.id === section.id ? { ...s, ...updatedSection } : s);
    setSections(updated);
    await refreshRenderedHtml(updated, theme);
  }

  // ─── HTML 복사 / 다운로드 ────────────────────────────────────────────────────
  async function handleHtmlCopy() {
    await navigator.clipboard.writeText(generatedHtml).catch(() => {});
  }

  function handleDownload() {
    const blob = new Blob([generatedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'detail-page.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── 렌더 ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: '100vh', background: C.bg }}>
      {/* 좌측 300px 입력 패널 */}
      <DetailMakerInputPanel
        productName={productName}
        setProductName={setProductName}
        brandName={brandName}
        setBrandName={setBrandName}
        category={category}
        setCategory={setCategory}
        uploadedUrls={uploadedUrls}
        uploading={uploading}
        isGenerating={isGenerating}
        error={error}
        onUploadFiles={handleUploadFiles}
        onRemoveImage={handleRemoveImage}
        onGenerate={handleGenerate}
      />

      {/* 우측 — DetailPageEditor 또는 EmptyState */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {sections.length > 0 ? (
          <DetailPageEditor
            sections={sections}
            theme={theme}
            isGenerating={isRendering}
            onSectionsChange={handleSectionsChange}
            onThemeChange={handleThemeChange}
            onSectionAiEdit={handleSectionAiEdit}
            onHtmlCopy={handleHtmlCopy}
            onDownload={handleDownload}
            generatedHtml={generatedHtml}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: C.textSub,
              gap: '12px',
            }}
          >
            {isGenerating ? (
              <>
                <div style={{ fontSize: '32px' }}>✨</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: C.text }}>AI가 상세페이지를 생성하고 있어요</div>
                <div style={{ fontSize: '13px' }}>잠시만 기다려주세요 (30~60초 소요)</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '40px' }}>📄</div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: C.text }}>상품상세 자동만들기</div>
                <div style={{ fontSize: '13px', textAlign: 'center', lineHeight: 1.6 }}>
                  왼쪽에서 상품명과 이미지를 입력하고
                  <br />
                  AI 생성 버튼을 눌러보세요
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
