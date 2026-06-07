'use client';

import React from 'react';
import AssetsInputPanel from './AssetsInputPanel';
import AssetsResultPanel from './AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';
import { parseSpecText } from '@/lib/utils/parseSpecText';
import { contentToSections } from '@/lib/detail-page/section-parser';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import { buildAiDetailPageHtml } from '@/lib/detail-page/ai-html-builder';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
import type { ImagePromptsResponse, SectionImagePrompt } from '@/lib/ai/prompts/detail-image-prompts';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';

export default function AssetsTab() {
  const { assetsDraft, updateAssetsDraft, sharedDraft } = useListingStore();

  /** 이미지 URL 배열을 /api/ai/generate-detail-html에 보내 상세 HTML 및 content 생성 */
  const generateDetailHtml = async (
    imageUrls: string[],
    requestImagePrompts = false,
  ): Promise<{ html: string; content?: DetailPageContent; imagePrompts?: ImagePromptsResponse }> => {
    if (imageUrls.length === 0) return { html: '' };
    const productSpecs = parseSpecText(sharedDraft.productSpecText);
    const res = await fetch('/api/ai/generate-detail-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls: imageUrls.slice(0, 6),
        studioMode: true,
        ...(productSpecs ? { productSpecs } : {}),
      }),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error(`상세페이지 생성 실패 (HTTP ${res.status}): ${text.slice(0, 160)}`);
    }
    const data = (await res.json()) as { html?: string; content?: DetailPageContent; imagePrompts?: ImagePromptsResponse; error?: string };
    if (!res.ok || !data.html) {
      throw new Error(data.error ?? '상세페이지 생성 실패');
    }
    return {
      html: data.html,
      content: data.content,
      imagePrompts: requestImagePrompts ? data.imagePrompts : undefined,
    };
  };

  /** Gemini 이미지 생성 → 업로드 → AiImageSlot 배열 반환 */
  const runGeminiImageGeneration = async (
    imagePromptsResponse: ImagePromptsResponse,
    referenceImageUrl: string,
    onProgress: (done: number, total: number) => void,
  ): Promise<AiImageSlot[]> => {
    const { imagePrompts } = imagePromptsResponse;
    if (imagePrompts.length === 0) return [];

    let refBase64 = '';
    let refMime = 'image/jpeg';
    try {
      const refRes = await fetch(referenceImageUrl);
      const blob = await refRes.blob();
      refMime = blob.type || 'image/jpeg';
      const ab = await blob.arrayBuffer();
      refBase64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
    } catch {
      // reference 없이도 생성 가능
    }

    let doneCount = 0;
    const total = imagePrompts.length;

    const results = await Promise.allSettled(
      imagePrompts.map(async (p: SectionImagePrompt) => {
        const genRes = await fetch('/api/ai/generate-frame-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frameType: 'hero',
            imagePrompt: p.prompt ?? p.scene,
            ...(refBase64 ? { productImageBase64: refBase64, productImageMimeType: refMime } : {}),
          }),
        });
        const genData = (await genRes.json()) as { success: boolean; data?: { imageBase64: string; mimeType: string }; error?: string };
        if (!genRes.ok || !genData.success || !genData.data) {
          throw new Error(genData.error ?? 'Gemini 이미지 생성 실패');
        }

        const uploadRes = await fetch('/api/image/upload-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: genData.data.imageBase64,
            mimeType: genData.data.mimeType,
            role: p.role,
          }),
        });
        const uploadData = (await uploadRes.json()) as { success: boolean; url?: string; error?: string };
        if (!uploadRes.ok || !uploadData.success || !uploadData.url) {
          throw new Error(uploadData.error ?? '이미지 업로드 실패');
        }

        doneCount++;
        onProgress(doneCount, total);

        const slot: AiImageSlot = {
          role: p.role,
          url: uploadData.url,
          prompt: p.prompt ?? p.scene,
          isReplaced: false,
        };
        return slot;
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
      .map(r => r.value);
  };

  const handleGenerate = async () => {
    const { includeAiImages } = assetsDraft;

    updateAssetsDraft({ isGenerating: true, generatingMessage: '시작합니다...', lastError: null });

    try {
      // ── URL 모드 ────────────────────────────────────────────────────────────
      if (assetsDraft.mode === 'url') {
        updateAssetsDraft({ generatingMessage: '외부 사이트에서 자산 가져오는 중...' });
        const res = await fetch('/api/listing/assets/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'url', url: assetsDraft.url.trim() }),
        });
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) {
          const text = await res.text();
          throw new Error(`생성 실패 (HTTP ${res.status}): ${text.slice(0, 160)}`);
        }
        const json = (await res.json()) as {
          success: boolean;
          data?: { thumbnails: string[]; detailHtml: string };
          error?: string;
        };
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error ?? '생성 실패');
        }
        const thumbnails = json.data.thumbnails ?? [];
        let detailHtml = json.data.detailHtml ?? '';
        let detailContent: DetailPageContent | undefined;
        let aiSlots: AiImageSlot[] = [];

        if ((includeAiImages || !detailHtml) && thumbnails.length > 0) {
          updateAssetsDraft({ generatingMessage: '상세페이지 HTML 생성 중...' });
          const result = await generateDetailHtml(thumbnails, includeAiImages);
          detailHtml = result.html;
          detailContent = result.content;
          if (includeAiImages && result.imagePrompts) {
            aiSlots = await runGeminiImageGeneration(result.imagePrompts, thumbnails[0], (done, total) => {
              updateAssetsDraft({ generatingMessage: `Gemini 이미지 생성 중 (${done}/${total})...` });
            });
            if (aiSlots.length > 0 && detailContent) {
              updateAssetsDraft({ generatingMessage: 'HTML 완성 중...' });
              detailHtml = appendPrivacyFooter(buildAiDetailPageHtml(detailContent, aiSlots));
            }
          }
        }

        let detailPageSections = assetsDraft.detailPageSections;
        if (detailContent) {
          try { detailPageSections = contentToSections(detailContent); } catch { /* silent */ }
        }
        if (detailPageSections.length > 0 && thumbnails.length > 0) {
          detailPageSections = detailPageSections.map((s, idx) =>
            idx === 0 ? { ...s, attachedImages: thumbnails.map((url, order) => ({ url, order, processingMode: 'original' as const })) } : s
          );
        }

        updateAssetsDraft({ isGenerating: false, generatingMessage: null, generatedThumbnails: thumbnails, generatedDetailHtml: detailHtml, detailPageSections, aiImageSlots: aiSlots, aiDetailContent: detailContent ?? null });
        return;
      }

      // ── 업로드 모드 ─────────────────────────────────────────────────────────
      const thumbnails = [...assetsDraft.thumbnailFiles];
      const detailSources = assetsDraft.detailFiles.length > 0 ? [...assetsDraft.detailFiles] : [...assetsDraft.thumbnailFiles];

      let detailHtml = '';
      let detailContent: DetailPageContent | undefined;
      let aiSlots: AiImageSlot[] = [];

      if (detailSources.length > 0) {
        updateAssetsDraft({ generatingMessage: '상품 분석 중...' });
        const result = await generateDetailHtml(detailSources, includeAiImages);
        detailHtml = result.html;
        detailContent = result.content;

        if (includeAiImages && result.imagePrompts) {
          aiSlots = await runGeminiImageGeneration(result.imagePrompts, detailSources[0], (done, total) => {
            updateAssetsDraft({ generatingMessage: `Gemini 이미지 생성 중 (${done}/${total})...` });
          });
          if (aiSlots.length > 0 && detailContent) {
            updateAssetsDraft({ generatingMessage: 'HTML 완성 중...' });
            detailHtml = appendPrivacyFooter(buildAiDetailPageHtml(detailContent, aiSlots));
          }
        }
      }

      let detailPageSections = assetsDraft.detailPageSections;
      if (detailContent) {
        try { detailPageSections = contentToSections(detailContent); } catch { /* silent */ }
      }
      if (detailPageSections.length > 0 && detailSources.length > 0) {
        detailPageSections = detailPageSections.map((s, idx) =>
          idx === 0 ? { ...s, attachedImages: detailSources.map((url, order) => ({ url, order, processingMode: 'original' as const })) } : s
        );
      }

      updateAssetsDraft({ isGenerating: false, generatingMessage: null, generatedThumbnails: thumbnails, generatedDetailHtml: detailHtml, detailPageSections, aiImageSlots: aiSlots, aiDetailContent: detailContent ?? null });
    } catch (e) {
      updateAssetsDraft({ isGenerating: false, generatingMessage: null, lastError: e instanceof Error ? e.message : '알 수 없는 오류' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px', alignItems: 'start' }}>
        <AssetsInputPanel onGenerate={handleGenerate} />
        <AssetsResultPanel />
      </div>
      {assetsDraft.generatingMessage && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1d4ed8',
            fontSize: '13px',
            borderRadius: '8px',
          }}
        >
          {assetsDraft.generatingMessage}
        </div>
      )}
      {assetsDraft.lastError && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#fee2e2',
          color: '#b91c1c',
          fontSize: '13px',
          borderRadius: '8px',
        }}>
          {assetsDraft.lastError}
        </div>
      )}
    </div>
  );
}

