'use client';

/**
 * ExportSection.tsx
 * 인스펙터 패널 — 내보내기 섹션
 *
 * - "JPG 저장" 버튼 (780×1100, pixelRatio 1)
 * - "고해상도 PNG 저장" 버튼 (1560×2200, pixelRatio 2)
 * - html-to-image toJpeg / toPng 사용
 * - TemplateRefContext의 getRef(frameType)로 DOM 노드 접근
 * - fontEmbedCSS: '' 옵션 필수 (Google Fonts CORS 방지)
 * - 저장 중 로딩 상태 (isSaving)
 * - 파일명: frame-{번호}-{frameType}.jpg / frame-{번호}-{frameType}@2x.png
 */

import { useState } from 'react';
import { Download, Image, Loader2 } from 'lucide-react';
import type { FrameType } from '@/types/frames';
import { useTemplateRefs } from '../TemplateRefContext';

// 템플릿 규격 상수
const TEMPLATE_W = 780;
const TEMPLATE_H = 1100;

interface ExportSectionProps {
  frameType: FrameType;
  /** 프레임 목록에서의 실제 인덱스 (1-based) */
  frameIndex: number;
}

const ExportSection: React.FC<ExportSectionProps> = ({ frameType, frameIndex }) => {
  const [isSaving, setIsSaving] = useState(false);
  const { getRef } = useTemplateRefs();

  // 파일명용 인덱스 레이블 (01, 02, ...)
  const indexLabel = String(frameIndex).padStart(2, '0');

  // JPG 저장 (일반 해상도 780×1100)
  const handleSaveJpg = async () => {
    if (isSaving) return;
    const node = getRef(frameType);
    if (!node) {
      window.alert('프레임 DOM을 찾을 수 없습니다. 다시 시도해주세요.');
      return;
    }
    setIsSaving(true);
    try {
      const { toJpeg } = await import('html-to-image');
      const dataUrl = await toJpeg(node, {
        quality: 0.95,
        width: TEMPLATE_W,
        height: TEMPLATE_H,
        pixelRatio: 1,
        fontEmbedCSS: '', // Google Fonts CORS 방지
      });
      const link = document.createElement('a');
      link.download = `frame-${indexLabel}-${frameType}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('[ExportSection] JPG 저장 오류:', err);
      window.alert('JPG 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  };

  // 고해상도 PNG 저장 (2× pixelRatio → 1560×2200)
  const handleSavePng = async () => {
    if (isSaving) return;
    const node = getRef(frameType);
    if (!node) {
      window.alert('프레임 DOM을 찾을 수 없습니다. 다시 시도해주세요.');
      return;
    }
    setIsSaving(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(node, {
        quality: 1,
        width: TEMPLATE_W,
        height: TEMPLATE_H,
        pixelRatio: 2,
        fontEmbedCSS: '', // Google Fonts CORS 방지
      });
      const link = document.createElement('a');
      link.download = `frame-${indexLabel}-${frameType}@2x.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('[ExportSection] 고해상도 PNG 저장 오류:', err);
      window.alert('저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* 섹션 라벨 */}
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          color: '#926f6b',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        내보내기
      </span>

      {/* JPG 저장 버튼 */}
      <button
        onClick={handleSaveJpg}
        disabled={isSaving}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '7px',
          width: '100%',
          padding: '10px 16px',
          borderRadius: '8px',
          border: '1px solid #6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.08)',
          color: isSaving ? '#926f6b' : '#6366f1',
          fontSize: '13px',
          fontWeight: 600,
          cursor: isSaving ? 'not-allowed' : 'pointer',
          opacity: isSaving ? 0.7 : 1,
          transition: 'all 0.15s',
        }}
      >
        {isSaving ? (
          <>
            <Loader2
              size={14}
              style={{ animation: 'spin 1s linear infinite' }}
            />
            저장 중...
          </>
        ) : (
          <>
            <Download size={14} />
            JPG 저장
          </>
        )}
      </button>

      {/* 고해상도 PNG 저장 버튼 */}
      <button
        onClick={handleSavePng}
        disabled={isSaving}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '7px',
          width: '100%',
          padding: '10px 16px',
          borderRadius: '8px',
          border: '1px solid #eeeeee',
          backgroundColor: 'transparent',
          color: isSaving ? '#926f6b' : '#1a1c1c',
          fontSize: '13px',
          fontWeight: 600,
          cursor: isSaving ? 'not-allowed' : 'pointer',
          opacity: isSaving ? 0.7 : 1,
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!isSaving) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#926f6b';
            (e.currentTarget as HTMLButtonElement).style.color = '#1a1c1c';
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#eeeeee';
          (e.currentTarget as HTMLButtonElement).style.color = isSaving ? '#926f6b' : '#1a1c1c';
        }}
      >
        {isSaving ? (
          <>
            <Loader2
              size={14}
              style={{ animation: 'spin 1s linear infinite' }}
            />
            저장 중...
          </>
        ) : (
          <>
            <Image size={14} />
            고해상도 PNG 저장
            <span
              style={{
                fontSize: '10px',
                color: '#926f6b',
                fontWeight: 400,
              }}
            >
              (2×)
            </span>
          </>
        )}
      </button>

      {/* 해상도 안내 */}
      <p
        style={{
          margin: 0,
          fontSize: '11px',
          color: '#926f6b',
          textAlign: 'center',
          lineHeight: '1.5',
        }}
      >
        JPG 780×1100 · PNG 1560×2200
      </p>

      {/* CSS 애니메이션 (spin) */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default ExportSection;
