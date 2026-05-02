'use client';

import React from 'react';
import AssetsInputPanel from './AssetsInputPanel';
import AssetsResultPanel from './AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';
import { parseSpecText } from '@/lib/utils/parseSpecText';

/** 상세페이지용 이미지를 자동 편집할 때 적용할 기본 프롬프트 (가이드라인 강제) */
const DETAIL_AUTO_EDIT_PROMPT =
  'Replace the background with pure white (#FFFFFF). Reframe and zoom so the product is centered and fills at least 85% of the image. Square 1:1 framing. Keep the product unchanged. Add only a small soft shadow under the product. No text, no logo, no badge, no people.';

export default function AssetsTab() {
  const { assetsDraft, updateAssetsDraft, sharedDraft } = useListingStore();

  /** 단일 이미지 URL을 /api/ai/edit-thumbnail로 보내 편집된 URL을 반환 */
  const editOneImage = async (imageUrl: string, prompt: string): Promise<string> => {
    const res = await fetch('/api/ai/edit-thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, prompt }),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error(`AI 편집 실패 (HTTP ${res.status}): ${text.slice(0, 120)}`);
    }
    const json = (await res.json()) as
      | { success: true; data: { editedUrl: string } }
      | { success: false; error: string };
    if (!res.ok || !json.success) {
      throw new Error(!json.success ? json.error : `AI 편집 실패 (HTTP ${res.status})`);
    }
    return json.data.editedUrl;
  };

  /** 이미지 URL 배열을 /api/ai/generate-detail-html에 보내 상세 HTML 생성 */
  const generateDetailHtml = async (imageUrls: string[]): Promise<string> => {
    if (imageUrls.length === 0) return '';
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
    const data = (await res.json()) as { html?: string; error?: string };
    if (!res.ok || !data.html) {
      throw new Error(data.error ?? '상세페이지 생성 실패');
    }
    return data.html;
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
        if (!detailHtml && thumbnails.length > 0) {
          updateAssetsDraft({ generatingMessage: '상세페이지 HTML 생성 중...' });
          detailHtml = await generateDetailHtml(thumbnails);
        }
        updateAssetsDraft({
          isGenerating: false,
          generatingMessage: null,
          generatedThumbnails: thumbnails,
          generatedDetailHtml: detailHtml,
        });
        return;
      }

      // ── 업로드 모드 ─────────────────────────────────────────────────────────
      // 1. 썸네일용 이미지: 그대로 결과 썸네일로 사용
      // 2. 상세페이지용 이미지: 각각 AI 편집 (흰 배경·85% 강제) → 편집된 URL
      // 3. 편집된 상세 이미지로 상세 HTML 생성
      const thumbnails = [...assetsDraft.thumbnailFiles];
      const detailSources = [...assetsDraft.detailFiles];

      const editedDetail: string[] = [];
      for (let i = 0; i < detailSources.length; i++) {
        updateAssetsDraft({
          generatingMessage: `상세 이미지 AI 편집 중 (${i + 1}/${detailSources.length})...`,
        });
        try {
          const editedUrl = await editOneImage(detailSources[i], DETAIL_AUTO_EDIT_PROMPT);
          editedDetail.push(editedUrl);
        } catch (err) {
          // 일부 실패해도 나머지는 계속 진행. 실패 항목은 원본 URL로 fallback.
          console.warn('[assets] 상세 이미지 AI 편집 실패, 원본 사용:', err);
          editedDetail.push(detailSources[i]);
        }
      }

      let detailHtml = '';
      if (editedDetail.length > 0) {
        updateAssetsDraft({
          generatingMessage: '편집된 상세 이미지로 상세페이지 HTML 생성 중...',
        });
        detailHtml = await generateDetailHtml(editedDetail);
      }

      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        generatedThumbnails: thumbnails,
        generatedDetailHtml: detailHtml,
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
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '20px', alignItems: 'start' }}>
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

