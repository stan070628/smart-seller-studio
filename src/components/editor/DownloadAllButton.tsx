'use client';

/**
 * DownloadAllButton.tsx
 * 헤더에 배치될 "전체 다운로드" 버튼
 *
 * - skip !== true인 프레임 DOM을 순회하며 toJpeg() 호출
 * - JSZip으로 묶어 ZIP 파일 다운로드
 * - "3 / 13 처리 중..." 진행 상태 표시
 */

'use client';

import React, { useState } from 'react';
import { Download, Loader2, PackageCheck } from 'lucide-react';
import useEditorStore from '@/store/useEditorStore';
import type { FrameGridHandle } from './FrameGrid';
import { getDims } from '@/lib/constants/template-dimensions';

/** 편집 UI가 DOM에서 사라질 때까지 두 프레임 대기 */
const waitForRender = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DownloadAllButtonProps {
  /** FrameGrid 컴포넌트의 ref — 각 템플릿 DOM 노드에 접근 */
  frameGridRef: React.RefObject<FrameGridHandle | null>;
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

const DownloadAllButton: React.FC<DownloadAllButtonProps> = ({ frameGridRef }) => {
  const frames = useEditorStore((s) => s.frames);
  const activeCount = frames.filter((f) => f.skip !== true).length;
  const setSelectedFrameType = useEditorStore((s) => s.setSelectedFrameType);

  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const isDownloading = progress !== null;

  const handleDownloadAll = async () => {
    if (isDownloading || !frameGridRef.current) return;

    const { activeFrames, getTemplateNode } = frameGridRef.current;
    if (activeFrames.length === 0) {
      window.alert('다운로드할 프레임이 없습니다. 먼저 AI 카피를 생성해주세요.');
      return;
    }

    setProgress({ current: 0, total: activeFrames.length });

    // 편집 UI 제거 후 캡처
    setSelectedFrameType(null);
    await waitForRender();

    try {
      // 동적 import (클라이언트 전용 라이브러리)
      const [{ toJpeg }, { default: JSZip }] = await Promise.all([
        import('html-to-image'),
        import('jszip'),
      ]);

      const zip = new JSZip();
      const folder = zip.folder('frames') ?? zip;

      for (let i = 0; i < activeFrames.length; i++) {
        const frame = activeFrames[i];
        const node = getTemplateNode(i);

        setProgress({ current: i + 1, total: activeFrames.length });

        if (!node) {
          console.warn(`[DownloadAllButton] 프레임 ${i} DOM 노드를 찾을 수 없습니다.`);
          continue;
        }

        try {
          // frameType별 치수 적용 (thumbnail은 780×780, 나머지는 780×1100)
          const { w, h } = getDims(frame.frameType);
          const dataUrl = await toJpeg(node, {
            quality: 0.95,
            width: w,
            height: h,
            pixelRatio: 1,
            fontEmbedCSS: '',
          });

          // data URL → base64 추출
          const base64 = dataUrl.split(',')[1];
          const indexLabel = String(i + 1).padStart(2, '0');
          folder.file(`${indexLabel}-${frame.frameType}.jpg`, base64, { base64: true });
        } catch (err) {
          console.error(`[DownloadAllButton] 프레임 ${frame.frameType} 캡처 실패:`, err);
        }
      }

      // ZIP 생성 및 다운로드
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `smart-seller-frames-${Date.now()}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[DownloadAllButton] ZIP 다운로드 오류:', err);
      window.alert('다운로드 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <button
      onClick={handleDownloadAll}
      disabled={isDownloading || activeCount === 0}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        padding: '8px 16px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: '600',
        cursor: isDownloading || activeCount === 0 ? 'not-allowed' : 'pointer',
        border: '1px solid',
        transition: 'all 0.15s',
        fontFamily: 'inherit',
        ...(isDownloading || activeCount === 0
          ? {
              backgroundColor: '#f3f3f3',
              borderColor: '#eeeeee',
              color: '#926f6b',
            }
          : {
              backgroundColor: '#be0014',
              borderColor: '#be0014',
              color: '#ffffff',
            }),
      }}
    >
      {isDownloading ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          {progress.current} / {progress.total} 처리 중...
        </>
      ) : activeCount > 0 ? (
        <>
          <Download size={14} />
          전체 다운로드 ({activeCount}장)
        </>
      ) : (
        <>
          <PackageCheck size={14} />
          전체 다운로드
        </>
      )}
    </button>
  );
};

export default DownloadAllButton;
