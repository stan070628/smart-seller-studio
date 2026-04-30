'use client';

import React from 'react';
import AssetsInputPanel from './AssetsInputPanel';
import AssetsResultPanel from './AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';

export default function AssetsTab() {
  const { assetsDraft, updateAssetsDraft } = useListingStore();

  const handleGenerate = async () => {
    updateAssetsDraft({ isGenerating: true, lastError: null });
    const body =
      assetsDraft.mode === 'url'
        ? { mode: 'url', url: assetsDraft.url.trim() }
        : { mode: 'upload', images: assetsDraft.uploadedFiles };
    try {
      // 1) 썸네일 + (URL 모드의 경우) 외부 사이트에서 추출한 detailHtml 받기
      const res = await fetch('/api/listing/assets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        const text = await res.text();
        updateAssetsDraft({
          isGenerating: false,
          lastError: `생성 실패 (HTTP ${res.status}): ${text.slice(0, 160)}`,
        });
        return;
      }
      const json = (await res.json()) as {
        success: boolean;
        data?: { thumbnails: string[]; detailHtml: string; detailImage: string | null };
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        updateAssetsDraft({ isGenerating: false, lastError: json.error ?? '생성 실패' });
        return;
      }

      const thumbnails = json.data.thumbnails ?? [];
      let detailHtml = json.data.detailHtml ?? '';

      // 2) 업로드 모드이거나 detailHtml이 비어있으면 AI로 상세페이지 HTML 생성
      const needsAiDetail = thumbnails.length > 0 && (assetsDraft.mode === 'upload' || !detailHtml);
      if (needsAiDetail) {
        const aiRes = await fetch('/api/ai/generate-detail-html', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrls: thumbnails.slice(0, 5),
            studioMode: true,
          }),
        });
        const aiCt = aiRes.headers.get('content-type') ?? '';
        if (aiCt.includes('application/json')) {
          const aiData = (await aiRes.json()) as { html?: string; error?: string };
          if (aiRes.ok && aiData.html) {
            detailHtml = aiData.html;
          } else if (aiData.error) {
            // AI 단계 실패해도 썸네일은 살리고 에러만 표시
            updateAssetsDraft({
              isGenerating: false,
              generatedThumbnails: thumbnails,
              generatedDetailHtml: detailHtml,
              lastError: `상세페이지 생성 실패: ${aiData.error}`,
            });
            return;
          }
        } else {
          const aiText = await aiRes.text();
          updateAssetsDraft({
            isGenerating: false,
            generatedThumbnails: thumbnails,
            generatedDetailHtml: detailHtml,
            lastError: `상세페이지 생성 실패 (HTTP ${aiRes.status}): ${aiText.slice(0, 160)}`,
          });
          return;
        }
      }

      updateAssetsDraft({
        isGenerating: false,
        generatedThumbnails: thumbnails,
        generatedDetailHtml: detailHtml,
      });
    } catch (e) {
      updateAssetsDraft({
        isGenerating: false,
        lastError: e instanceof Error ? e.message : '알 수 없는 오류',
      });
    }
  };

  const handleSave = async () => {
    const body = {
      sourceType: assetsDraft.mode,
      sourceUrl: assetsDraft.mode === 'url' ? assetsDraft.url : undefined,
      thumbnails: assetsDraft.generatedThumbnails,
      detailHtml: assetsDraft.generatedDetailHtml,
    };
    try {
      const res = await fetch('/api/listing/assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        const text = await res.text();
        alert(`저장 실패 (HTTP ${res.status}): ${text.slice(0, 160)}`);
        return;
      }
      const json = (await res.json()) as { success: boolean; error?: string };
      if (res.ok && json.success) {
        alert('자산이 저장되었습니다.');
      } else {
        alert('저장 실패: ' + (json.error ?? 'unknown'));
      }
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '20px', alignItems: 'start' }}>
        <AssetsInputPanel onGenerate={handleGenerate} />
        <AssetsResultPanel onSave={handleSave} />
      </div>
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
