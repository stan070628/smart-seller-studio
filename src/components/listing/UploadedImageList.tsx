'use client';

/**
 * UploadedImageList.tsx
 * 업로드된 이미지 썸네일 그리드
 *
 * - 3~4열 그리드
 * - 첫 번째 이미지 "대표" 뱃지
 * - 각 항목 X 버튼으로 제거
 * - uploading 상태: 반투명 오버레이 + 스피너
 * - error 상태: 빨간 테두리 + 에러 아이콘
 */

import React from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';

// ─── 색상 상수 (BothRegisterForm 동일) ────────────────────────────────────────
const C = {
  border: '#e5e5e5',
  textSub: '#71717a',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
};

export interface UploadedImageItem {
  url: string;
  fileName?: string;
  assetId?: string;
  status: 'ready' | 'uploading' | 'error';
}

export interface UploadedImageListProps {
  items: UploadedImageItem[];
  onRemove: (index: number) => void;
}

export default function UploadedImageList({ items, onRemove }: UploadedImageListProps) {
  if (items.length === 0) return null;

  return (
    <div
      style={{
        marginTop: '10px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
        gap: '8px',
      }}
    >
      {items.map((item, index) => (
        <ImageTile key={`${item.url}-${index}`} item={item} index={index} onRemove={onRemove} />
      ))}

      {/* 스피너 키프레임 */}
      <style>{`
        @keyframes uploadedListSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ─── 개별 썸네일 타일 ─────────────────────────────────────────────────────────
function ImageTile({
  item,
  index,
  onRemove,
}: {
  item: UploadedImageItem;
  index: number;
  onRemove: (i: number) => void;
}) {
  const [imgFailed, setImgFailed] = React.useState(false);

  const isError = item.status === 'error' || imgFailed;
  const isUploading = item.status === 'uploading';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        paddingBottom: '100%', // 정사각형 유지
        borderRadius: '8px',
        overflow: 'hidden',
        border: isError
          ? '2px solid #b91c1c'
          : index === 0
            ? `2px solid ${C.accent}`
            : `1px solid ${C.border}`,
        backgroundColor: C.tableHeader,
        flexShrink: 0,
      }}
    >
      {/* 이미지 또는 에러 상태 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isError ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              padding: '4px',
            }}
          >
            <AlertCircle size={18} style={{ color: '#b91c1c' }} />
            <span style={{ fontSize: '9px', color: '#b91c1c', textAlign: 'center' }}>
              오류
            </span>
          </div>
        ) : (
          <img
            src={item.url}
            alt={item.fileName ?? `이미지 ${index + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
            onError={() => setImgFailed(true)}
          />
        )}
      </div>

      {/* 업로드 중 오버레이 */}
      {isUploading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(255,255,255,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Loader2
            size={18}
            style={{ color: C.accent, animation: 'uploadedListSpin 1s linear infinite' }}
          />
        </div>
      )}

      {/* 대표 뱃지 (첫 번째 이미지, 에러 아닐 때) */}
      {index === 0 && !isError && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            fontSize: '9px',
            fontWeight: 700,
            textAlign: 'center',
            backgroundColor: 'rgba(190,0,20,0.82)',
            color: '#fff',
            padding: '2px 0',
            letterSpacing: '0.03em',
          }}
        >
          대표
        </div>
      )}

      {/* X 버튼 (업로드 중에도 제거 가능) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(index);
        }}
        title="이미지 제거"
        style={{
          position: 'absolute',
          top: '3px',
          right: '3px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          backgroundColor: 'rgba(0,0,0,0.55)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          zIndex: 2,
        }}
      >
        <X size={10} style={{ color: '#fff' }} />
      </button>

      {/* 파일명 툴팁 역할 title (접근성) */}
      {item.fileName && (
        <div
          title={item.fileName}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}
