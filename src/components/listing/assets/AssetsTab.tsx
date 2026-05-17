'use client';

import React from 'react';
import AssetsInputPanel from './AssetsInputPanel';
import AssetsResultPanel from './AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';
import { parseSpecText } from '@/lib/utils/parseSpecText';
import { contentToSections } from '@/lib/detail-page/section-parser';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

export default function AssetsTab() {
  const { assetsDraft, updateAssetsDraft, sharedDraft } = useListingStore();

  /** 이미지 URL 배열을 /api/ai/generate-detail-html에 보내 상세 HTML 및 content 생성 */
  const generateDetailHtml = async (
    imageUrls: string[],
  ): Promise<{ html: string; content?: DetailPageContent }> => {
    if (imageUrls.length === 0) return { html: '' };
    const productSpecs = parseSpecText(sharedDraft.productSpecText);
    const res = await fetch('/api/ai/generate-detail-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls: imageUrls.slice(0, 5),
        studioMode: true,
        ...(productSpecs ? { productSpecs } : {}),
      }),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error(`상세페이지 생성 실패 (HTTP ${res.status}): ${text.slice(0, 160)}`);
    }
    const data = (await res.json()) as { html?: string; content?: DetailPageContent; error?: string };
    if (!res.ok || !data.html) {
      throw new Error(data.error ?? '상세페이지 생성 실패');
    }
    return { html: data.html, content: data.content };
  };

  const handleGenerate = async () => {
    updateAssetsDraft({
      isGenerating: true,
      generatingMessage: '시작합니다...',
      lastError: null,
    });

    try {
      // ── URL 모드 ────────────────────────────────────────────────────────────
      // 외부 사이트(도매꾹·코스트코)에서 썸네일/상세 HTML을 가져온다. detailHtml이
      // 비어있으면 fallback으로 AI 상세페이지 생성.
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
        if (!detailHtml && thumbnails.length > 0) {
          updateAssetsDraft({ generatingMessage: '상세페이지 HTML 생성 중...' });
          const result = await generateDetailHtml(thumbnails);
          detailHtml = result.html;
          detailContent = result.content;
        }

        // content가 있으면 섹션 편집기 초기화 (DetailPageEditor 활성화)
        let detailPageSections = assetsDraft.detailPageSections;
        if (detailContent) {
          try {
            detailPageSections = contentToSections(detailContent);
          } catch {
            // 파싱 실패 시 silent fallback
          }
        }

        updateAssetsDraft({
          isGenerating: false,
          generatingMessage: null,
          generatedThumbnails: thumbnails,
          generatedDetailHtml: detailHtml,
          detailPageSections,
        });
        return;
      }

      // ── 업로드 모드 ─────────────────────────────────────────────────────────
      // 썸네일은 그대로, 상세 이미지도 원본 그대로 상세페이지 HTML 생성에 전달한다.
      // (개별 이미지를 다듬고 싶으면 결과 패널의 AI 편집 모달을 사용한다.)
      const thumbnails = [...assetsDraft.thumbnailFiles];
      const detailSources = [...assetsDraft.detailFiles];

      let detailHtml = '';
      let detailContent: DetailPageContent | undefined;
      if (detailSources.length > 0) {
        updateAssetsDraft({ generatingMessage: '상세페이지 HTML 생성 중...' });
        const result = await generateDetailHtml(detailSources);
        detailHtml = result.html;
        detailContent = result.content;
      }

      let detailPageSections = assetsDraft.detailPageSections;
      if (detailContent) {
        try {
          detailPageSections = contentToSections(detailContent);
        } catch {
          // 파싱 실패 시 silent fallback
        }
      }

      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        generatedThumbnails: thumbnails,
        generatedDetailHtml: detailHtml,
        detailPageSections,
      });
    } catch (e) {
      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        lastError: e instanceof Error ? e.message : '알 수 없는 오류',
      });
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

