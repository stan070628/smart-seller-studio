'use client';

/**
 * SlotCaptionButton.tsx
 * custom_3col / custom_gallery 프레임에서 이미지가 1개 이상 있을 때
 * "AI 캡션 생성" 버튼을 표시하고, 슬롯 이미지를 base64로 변환하여
 * /api/ai/generate-slot-captions API를 호출한 뒤 metadata를 병합합니다.
 */

import React, { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { FrameType } from '@/types/frames';
import useEditorStore from '@/store/useEditorStore';

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

type SupportedFrameType = 'custom_3col' | 'custom_gallery';

interface SlotCaptionButtonProps {
  frameType: SupportedFrameType;
  /** 프레임 인스턴스 고유 ID */
  frameId: string;
}

/** frameType별 유효 슬롯 키 — API 허용 키와 동일하게 유지 */
const VALID_SLOT_KEYS: Record<SupportedFrameType, readonly string[]> = {
  custom_3col:     ['col1', 'col2', 'col3'],
  custom_gallery:  ['slot1', 'slot2', 'slot3', 'slot4'],
};

// ─────────────────────────────────────────
// 이미지 URL → base64 변환 헬퍼
// ─────────────────────────────────────────

interface ImageBase64Result {
  imageBase64: string; // 순수 base64 (data URL prefix 없음)
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/** URL 확장자로 mimeType 추론 */
function inferMimeType(url: string): ImageBase64Result['mimeType'] {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  const extMap: Record<string, ImageBase64Result['mimeType']> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return extMap[ext ?? ''] ?? 'image/jpeg';
}

/** Uint8Array → base64 문자열 변환 (btoa 청크 방식: 스택 오버플로 방지) */
function uint8ToBase64(uint8: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < uint8.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * blob: URL인 경우 FileReader를 사용하여 data URL로 변환한 뒤 base64 부분만 추출.
 * https: URL인 경우 fetch → arrayBuffer → base64 변환.
 */
async function imageUrlToBase64(url: string): Promise<ImageBase64Result> {
  if (url.startsWith('blob:')) {
    // blob URL: fetch → Blob → FileReader
    const response = await fetch(url);
    const blob = await response.blob();

    // mimeType: Blob.type 우선, 없으면 기본값
    const rawMime = blob.type || 'image/jpeg';
    const mimeType: ImageBase64Result['mimeType'] =
      rawMime === 'image/jpeg' || rawMime === 'image/png' || rawMime === 'image/webp'
        ? rawMime
        : 'image/jpeg';

    return new Promise<ImageBase64Result>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // "data:image/jpeg;base64,XXXX" → "XXXX"
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx === -1) {
          reject(new Error('FileReader: data URL 형식이 올바르지 않습니다.'));
          return;
        }
        resolve({ imageBase64: dataUrl.slice(commaIdx + 1), mimeType });
      };
      reader.onerror = () => reject(new Error('FileReader 오류가 발생했습니다.'));
      reader.readAsDataURL(blob);
    });
  } else {
    // https / data URL: fetch → arrayBuffer → base64
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const imageBase64 = uint8ToBase64(uint8);

    // mimeType: Content-Type 헤더 우선, 없으면 URL 확장자 추론
    const contentType = response.headers.get('content-type');
    let mimeType: ImageBase64Result['mimeType'] = 'image/jpeg';
    if (contentType) {
      const stripped = contentType.split(';')[0].trim();
      if (stripped === 'image/jpeg' || stripped === 'image/png' || stripped === 'image/webp') {
        mimeType = stripped;
      }
    } else {
      mimeType = inferMimeType(url);
    }

    return { imageBase64, mimeType };
  }
}

// ─────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────

const SlotCaptionButton: React.FC<SlotCaptionButtonProps> = ({ frameType, frameId }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const frameImages = useEditorStore((s) => s.frameImages);
  const frames = useEditorStore((s) => s.frames);
  const updateFrame = useEditorStore((s) => s.updateFrame);

  // 현재 프레임의 슬롯 이미지 맵 (frameId 기준)
  const slotImageMap = frameImages[frameId] ?? {};

  // frameType에 허용된 키만, 그중 이미지가 있는 슬롯만 추출
  const validKeys = VALID_SLOT_KEYS[frameType as SupportedFrameType];
  const filledSlots = Object.entries(slotImageMap).filter(
    ([key, url]) => !!url && validKeys.includes(key),
  );

  // 이미지가 1개도 없으면 버튼 숨김
  if (filledSlots.length === 0) return null;

  // 토스트 표시 헬퍼 (2초 후 자동 제거)
  const showToast = (text: string, isError: boolean) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleGenerateCaptions = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setToastMessage(null);

    try {
      // 1. 이미지가 있는 슬롯들의 base64 변환 (병렬 처리)
      const slotBase64Entries = await Promise.all(
        filledSlots.map(async ([slotKey, url]) => {
          const result = await imageUrlToBase64(url);
          return [slotKey, result] as const;
        }),
      );

      // 2. API 요청 payload 구성
      const slots: Record<string, { imageBase64: string; mimeType: string }> = {};
      for (const [slotKey, result] of slotBase64Entries) {
        slots[slotKey] = {
          imageBase64: result.imageBase64,
          mimeType: result.mimeType,
        };
      }

      // 3. API 호출
      const response = await fetch('/api/ai/generate-slot-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameType, slots }),
      });

      type ApiResponse =
        | { success: true; data: { metadata: Record<string, unknown> } }
        | { success: false; error: string; code: string };

      const json = (await response.json()) as ApiResponse;

      if (!json.success) {
        throw new Error(json.error);
      }

      // 4. 기존 metadata와 병합하여 저장
      const currentFrame = frames.find((f) => f.frameType === frameType);
      const prevMetadata = currentFrame?.metadata ?? {};
      updateFrame(frameType as FrameType, {
        metadata: { ...prevMetadata, ...json.data.metadata },
      });

      showToast('캡션이 생성되었습니다', false);
    } catch (err) {
      console.error('[SlotCaptionButton] AI 캡션 생성 오류:', err);
      const message = err instanceof Error ? err.message : '캡션 생성에 실패했습니다.';
      showToast(message, true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '0 16px 16px' }}>
      {/* CSS 스핀 애니메이션 */}
      <style>{`
        @keyframes slot-caption-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* AI 캡션 생성 버튼 */}
      <button
        onClick={handleGenerateCaptions}
        disabled={isLoading}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '7px',
          width: '100%',
          padding: '9px 12px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: isLoading ? '#f3f3f3' : '#be0014',
          color: isLoading ? '#926f6b' : '#ffffff',
          fontSize: '13px',
          fontWeight: 600,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.15s, opacity 0.15s',
          opacity: isLoading ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isLoading) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#9a0010';
          }
        }}
        onMouseLeave={(e) => {
          if (!isLoading) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#be0014';
          }
        }}
      >
        {isLoading ? (
          <>
            <Loader2
              size={14}
              style={{ animation: 'slot-caption-spin 1s linear infinite' }}
            />
            캡션 생성 중...
          </>
        ) : (
          <>
            <Sparkles size={14} />
            AI 캡션 생성
          </>
        )}
      </button>

      {/* 토스트 메시지 */}
      {toastMessage && (
        <div
          style={{
            marginTop: '8px',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 500,
            lineHeight: 1.4,
            backgroundColor: toastMessage.isError
              ? 'rgba(190, 0, 20, 0.08)'
              : 'rgba(74, 222, 128, 0.12)',
            border: `1px solid ${toastMessage.isError ? 'rgba(190, 0, 20, 0.3)' : 'rgba(74, 222, 128, 0.4)'}`,
            color: toastMessage.isError ? '#be0014' : '#166534',
          }}
        >
          {toastMessage.isError ? '' : '✓ '}{toastMessage.text}
        </div>
      )}
    </div>
  );
};

export default SlotCaptionButton;
