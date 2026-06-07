'use client';

import React from 'react';
import AssetsInputPanel from './AssetsInputPanel';
import AssetsResultPanel from './AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';
import { parseSpecText } from '@/lib/utils/parseSpecText';
import { contentToSections } from '@/lib/detail-page/section-parser';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
import type { ImagePromptsResponse, SectionImagePrompt } from '@/lib/ai/prompts/detail-image-prompts';
import SceneReviewPanel from './SceneReviewPanel';
import type { CropItem } from '@/store/useListingStore';


export default function AssetsTab() {
  const { assetsDraft, updateAssetsDraft, sharedDraft } = useListingStore();

  /** 이미지 URL 배열을 /api/ai/generate-detail-html에 보내 상세 HTML 및 content 생성 */
  const generateDetailHtml = async (
    imageUrls: string[],
    requestImagePrompts = false,
  ): Promise<{ html: string; content?: DetailPageContent; imagePrompts?: ImagePromptsResponse; imagePromptsError?: string }> => {
    if (imageUrls.length === 0) return { html: '' };
    const productSpecs = parseSpecText(sharedDraft.productSpecText);
    const res = await fetch('/api/ai/generate-detail-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls: imageUrls.slice(0, 6),
        studioMode: true,
        ...(requestImagePrompts ? { includeImagePrompts: true } : {}),
        ...(productSpecs ? { productSpecs } : {}),
      }),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error(`상세페이지 생성 실패 (HTTP ${res.status}): ${text.slice(0, 160)}`);
    }
    const data = (await res.json()) as { html?: string; content?: DetailPageContent; imagePrompts?: ImagePromptsResponse; imagePromptsError?: string; error?: string };
    if (!res.ok || !data.html) {
      throw new Error(data.error ?? '상세페이지 생성 실패');
    }
    return {
      html: data.html,
      content: data.content,
      imagePrompts: data.imagePrompts,
      imagePromptsError: data.imagePromptsError,
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

  /** 기존 aiDetailContent를 재사용해서 URL 이미지를 레퍼런스로 4개 섹션 씬 이미지 생성 */
  const runSceneImageGenerationFromUrl = async (
    content: DetailPageContent,
    referenceImageUrl: string,
  ): Promise<AiImageSlot[]> => {
    let refBase64: string | undefined;
    let refMime: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
    try {
      const refRes = await fetch(referenceImageUrl);
      const blob = await refRes.blob();
      const rawMime = blob.type || 'image/jpeg';
      refMime = (['image/jpeg', 'image/png', 'image/webp'].includes(rawMime) ? rawMime : 'image/jpeg') as typeof refMime;
      const ab = await blob.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.slice(i, i + 8192));
      }
      refBase64 = btoa(binary);
    } catch { /* base64 없이 계속 */ }

    const sectionTypes: Array<'hero' | 'lifestyle' | 'detail' | 'feature'> = ['hero', 'lifestyle', 'detail', 'feature'];
    let doneCount = 0;
    const results = await Promise.allSettled(
      sectionTypes.map(async (sectionType) => {
        const sceneRes = await fetch('/api/ai/generate-scene-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionType,
            ...(refBase64 ? { productImageBase64: refBase64, productImageMimeType: refMime } : {}),
            productInfo: {
              headline: content.headline,
              subheadline: content.subheadline,
              sellingPoints: content.sellingPoints.map((sp) => ({ title: sp.title, description: sp.description })),
              features: content.features.map((f) => ({ title: f.title })),
            },
          }),
        });
        const sceneData = (await sceneRes.json()) as { success: boolean; data?: { imageBase64: string; mimeType: string; prompt: string }; error?: string };
        if (!sceneRes.ok || !sceneData.success || !sceneData.data) throw new Error(sceneData.error ?? '씬 이미지 생성 실패');

        const uploadRes = await fetch('/api/image/upload-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: sceneData.data.imageBase64, mimeType: sceneData.data.mimeType, role: sectionType }),
        });
        const uploadData = (await uploadRes.json()) as { success: boolean; url?: string };
        if (!uploadData.success || !uploadData.url) throw new Error('이미지 업로드 실패');

        doneCount++;
        updateAssetsDraft({ generatingMessage: `씬 이미지 생성 중 (${doneCount}/${sectionTypes.length})...` });

        return { role: sectionType, url: uploadData.url, prompt: sceneData.data.prompt, isReplaced: false } as AiImageSlot;
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
      .map((r) => r.value);
  };

  const handleAnalyze = async () => {
    if (assetsDraft.isAnalyzing) return;
    const { mode, url, thumbnailFiles, detailFiles } = assetsDraft;
    // URL 모드에서도 크롤링된 이미지가 있으면 우선 사용 (쿠팡 페이지 URL은 이미지가 아님)
    const imageUrls = detailFiles.length > 0
      ? detailFiles
      : (thumbnailFiles.length > 0 ? thumbnailFiles : [url.trim()]);

    if (imageUrls.length === 0 || imageUrls[0] === '') return;

    updateAssetsDraft({ isAnalyzing: true, lastError: null });
    try {
      const res = await fetch('/api/image/analyze-detail-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls: imageUrls.slice(0, 8) }),
      });
      const data = (await res.json()) as { success: boolean; crops?: CropItem[]; error?: string };
      if (!res.ok || !data.success || !data.crops) {
        throw new Error(data.error ?? '이미지 분석 실패');
      }
      updateAssetsDraft({ isAnalyzing: false, pendingCrops: data.crops });
    } catch (e) {
      updateAssetsDraft({
        isAnalyzing: false,
        lastError: e instanceof Error ? e.message : '이미지 분석 중 오류가 발생했습니다.',
      });
    }
  };

  const handleConfirmCrops = async (confirmedCrops: CropItem[]) => {
    updateAssetsDraft({
      pendingCrops: null,
      confirmedCrops,
      isGenerating: true,
      generatingMessage: '상세페이지 분석 중...',
      lastError: null,
    });

    try {
      const imageUrls = [...new Set(confirmedCrops.map(c => c.originalImageUrl))];

      // 1. 기존 "AI와 함께 만들기" 결과 재사용. 없으면 새로 생성
      const existingContentForCrops = assetsDraft.aiDetailContent;
      let baseHtml: string;
      let detailContent: DetailPageContent | undefined;

      if (existingContentForCrops) {
        detailContent = existingContentForCrops;
        baseHtml = assetsDraft.generatedDetailHtml;
      } else {
        updateAssetsDraft({ generatingMessage: '상세페이지 HTML 생성 중...' });
        const generated = await generateDetailHtml(imageUrls, false);
        baseHtml = generated.html;
        detailContent = generated.content;
      }

      // 2. Claude + Gemini로 섹션별 완성된 씬 이미지 생성 (병렬)
      updateAssetsDraft({ generatingMessage: 'AI 씬 이미지 생성 중...' });
      let doneCount = 0;
      const results = await Promise.allSettled(
        confirmedCrops.map(async (crop) => {
          // 크롭 이미지를 참조 이미지(base64)로 변환
          let refBase64: string | undefined;
          let refMime: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
          try {
            const refRes = await fetch(crop.croppedImageUrl);
            const blob = await refRes.blob();
            const rawMime = blob.type || 'image/jpeg';
            refMime = (['image/jpeg', 'image/png', 'image/webp'].includes(rawMime)
              ? rawMime
              : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';
            const ab = await blob.arrayBuffer();
            const bytes = new Uint8Array(ab);
            // 큰 이미지의 경우 btoa spread 대신 청크 처리
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
            }
            refBase64 = btoa(binary);
          } catch {
            // 변환 실패 시 참조 없이 생성
          }

          // generate-scene-image: Claude 프롬프트 생성 + Gemini 이미지 생성 통합
          const sceneRes = await fetch('/api/ai/generate-scene-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sectionType: crop.sectionType,
              ...(refBase64 ? { productImageBase64: refBase64, productImageMimeType: refMime } : {}),
              productInfo: detailContent ? {
                headline: detailContent.headline,
                subheadline: detailContent.subheadline,
                sellingPoints: detailContent.sellingPoints.map((sp) => ({ title: sp.title, description: sp.description })),
                features: detailContent.features.map((f) => ({ title: f.title })),
              } : undefined,
            }),
          });
          const sceneData = (await sceneRes.json()) as {
            success: boolean;
            data?: { imageBase64: string; mimeType: string; prompt: string };
            error?: string;
          };
          if (!sceneRes.ok || !sceneData.success || !sceneData.data) {
            throw new Error(sceneData.error ?? '씬 이미지 생성 실패');
          }

          // 생성된 이미지 업로드
          const uploadRes = await fetch('/api/image/upload-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: sceneData.data.imageBase64,
              mimeType: sceneData.data.mimeType,
              role: crop.sectionType,
            }),
          });
          const uploadData = (await uploadRes.json()) as { success: boolean; url?: string };
          if (!uploadData.success || !uploadData.url) throw new Error('이미지 업로드 실패');

          doneCount++;
          updateAssetsDraft({ generatingMessage: `씬 이미지 생성 중 (${doneCount}/${confirmedCrops.length})...` });

          return {
            role: crop.sectionType,
            url: uploadData.url,
            prompt: sceneData.data.prompt,
            isReplaced: false,
          } as AiImageSlot;
        }),
      );

      const aiSlots = results
        .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
        .map(r => r.value);

      const finalContent = detailContent;

      let detailPageSections = assetsDraft.detailPageSections;
      if (!existingContentForCrops && finalContent) {
        try { detailPageSections = contentToSections(finalContent); } catch { /* silent */ }
      }

      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        generatedDetailHtml: baseHtml,
        detailPageSections,
        aiImageSlots: aiSlots,
        aiDetailContent: finalContent ?? null,
        confirmedCrops: null,
      });
    } catch (e) {
      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        confirmedCrops: null,
        lastError: e instanceof Error ? e.message : '알 수 없는 오류',
      });
    }
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

        const existingContentUrl = assetsDraft.aiDetailContent;
        if (existingContentUrl && includeAiImages && thumbnails.length > 0) {
          // 기존 "AI와 함께 만들기" content 재사용 — 씬 이미지만 새로 생성
          detailContent = existingContentUrl;
          detailHtml = assetsDraft.generatedDetailHtml;
          aiSlots = await runSceneImageGenerationFromUrl(existingContentUrl, thumbnails[0]);
        } else if ((includeAiImages || !detailHtml) && thumbnails.length > 0) {
          updateAssetsDraft({ generatingMessage: '상세페이지 HTML 생성 중...' });
          const result = await generateDetailHtml(thumbnails, includeAiImages);
          detailHtml = result.html;
          detailContent = result.content;
          if (includeAiImages && result.imagePrompts) {
            aiSlots = await runGeminiImageGeneration(result.imagePrompts, thumbnails[0], (done, total) => {
              updateAssetsDraft({ generatingMessage: `Gemini 이미지 생성 중 (${done}/${total})...` });
            });
          } else if (includeAiImages && result.imagePromptsError) {
            updateAssetsDraft({ lastError: `AI 이미지 프롬프트 생성 실패: ${result.imagePromptsError}` });
          }
        }

        let detailPageSections = assetsDraft.detailPageSections;
        if (!existingContentUrl && detailContent) {
          try { detailPageSections = contentToSections(detailContent); } catch { /* silent */ }
          if (detailPageSections.length > 0 && thumbnails.length > 0) {
            detailPageSections = detailPageSections.map((s, idx) =>
              idx === 0 ? { ...s, attachedImages: thumbnails.map((url, order) => ({ url, order, processingMode: 'original' as const })) } : s
            );
          }
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

      const existingContentUpload = assetsDraft.aiDetailContent;
      if (existingContentUpload && includeAiImages && detailSources.length > 0) {
        // 기존 "AI와 함께 만들기" content 재사용 — 씬 이미지만 새로 생성
        detailContent = existingContentUpload;
        detailHtml = assetsDraft.generatedDetailHtml;
        aiSlots = await runSceneImageGenerationFromUrl(existingContentUpload, detailSources[0]);
      } else if (detailSources.length > 0) {
        updateAssetsDraft({ generatingMessage: '상품 분석 중...' });
        const result = await generateDetailHtml(detailSources, includeAiImages);
        detailHtml = result.html;
        detailContent = result.content;

        if (includeAiImages && result.imagePrompts) {
          aiSlots = await runGeminiImageGeneration(result.imagePrompts, detailSources[0], (done, total) => {
            updateAssetsDraft({ generatingMessage: `Gemini 이미지 생성 중 (${done}/${total})...` });
          });
        } else if (includeAiImages && result.imagePromptsError) {
          updateAssetsDraft({ lastError: `AI 이미지 프롬프트 생성 실패: ${result.imagePromptsError}` });
        }
      }

      let detailPageSections = assetsDraft.detailPageSections;
      if (!existingContentUpload && detailContent) {
        try { detailPageSections = contentToSections(detailContent); } catch { /* silent */ }
        if (detailPageSections.length > 0 && detailSources.length > 0) {
          detailPageSections = detailPageSections.map((s, idx) =>
            idx === 0 ? { ...s, attachedImages: detailSources.map((url, order) => ({ url, order, processingMode: 'original' as const })) } : s
          );
        }
      }

      updateAssetsDraft({ isGenerating: false, generatingMessage: null, generatedThumbnails: thumbnails, generatedDetailHtml: detailHtml, detailPageSections, aiImageSlots: aiSlots, aiDetailContent: detailContent ?? null });
    } catch (e) {
      updateAssetsDraft({ isGenerating: false, generatingMessage: null, lastError: e instanceof Error ? e.message : '알 수 없는 오류' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px', alignItems: 'start' }}>
        <AssetsInputPanel onGenerate={handleGenerate} onAnalyze={handleAnalyze} />
        <AssetsResultPanel />
      </div>
      {assetsDraft.pendingCrops && (
        <SceneReviewPanel
          crops={assetsDraft.pendingCrops}
          onConfirm={handleConfirmCrops}
          onCancel={() => updateAssetsDraft({ pendingCrops: null, isAnalyzing: false })}
        />
      )}
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

