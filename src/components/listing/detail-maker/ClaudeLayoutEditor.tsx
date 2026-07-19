'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';
import type { DetailSection, ClaudeLayoutContent, AttachedImage } from '@/types/detail-page';
import { ensureImageBlock } from '@/lib/detail-page/layout-image-blocks';

interface Props {
  section: DetailSection;
  onUpdate: (updates: Partial<ClaudeLayoutContent> & { attachedImages?: AttachedImage[] }) => void;
  onUploadFile: (file: File) => Promise<string>;
  /** 참고 이미지 URL 목록 (왼쪽 패널에서 업로드된 원본 이미지들) */
  referenceUrls?: string[];
  /** Gemini 이미지 슬롯을 힌트 기반으로 재생성 (제공되면 재생성 버튼 노출) */
  onRegenerateSlot?: (slotIdx: number, hint: string) => Promise<void>;
}

const BRAND_PURPLE = '#7c3aed';

export default function ClaudeLayoutEditor({ section, onUpdate, onUploadFile, referenceUrls = [], onRegenerateSlot }: Props) {
  const content = section.content as ClaudeLayoutContent;
  // 슬롯별 참고 이미지 피커 표시 인덱스 (null = 닫힘)
  const [pickerSlotIdx, setPickerSlotIdx] = React.useState<number | null>(null);
  // 재생성 중인 Gemini 슬롯 인덱스 (null = 없음)
  const [regenIdx, setRegenIdx] = React.useState<number | null>(null);

  // 섹션 제목 변경
  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onUpdate({ title: e.target.value });
  }

  // 핵심 포인트 텍스트 변경
  function handlePointChange(idx: number, value: string) {
    const points = [...(content.points ?? [])];
    points[idx] = value;
    onUpdate({ points });
  }

  // 포인트 항목 추가
  function addPoint() {
    onUpdate({ points: [...(content.points ?? []), ''] });
  }

  // 포인트 항목 제거
  function removePoint(idx: number) {
    const points = (content.points ?? []).filter((_, i) => i !== idx);
    onUpdate({ points });
  }

  // 이미지 슬롯 소스(upload/gemini) 전환
  function handleSlotSourceChange(idx: number, source: 'upload' | 'gemini') {
    const images = section.attachedImages.map((img, i) =>
      i === idx ? { ...img, source, url: source === 'gemini' ? '' : img.url } : img
    );
    onUpdate({ attachedImages: images });
  }

  // Gemini 생성 힌트 변경
  function handleSlotHintChange(idx: number, hint: string) {
    const images = section.attachedImages.map((img, i) =>
      i === idx ? { ...img, generationHint: hint } : img
    );
    onUpdate({ attachedImages: images });
  }

  // 직접 업로드 처리 — URL 설정과 함께 image 블록 자동 주입
  async function handleSlotUpload(idx: number, file: File) {
    const url = await onUploadFile(file);
    const images = section.attachedImages.map((img, i) =>
      i === idx ? { ...img, url, source: 'upload' as const } : img
    );
    const blocks = ensureImageBlock(content.blocks ?? [], idx);
    onUpdate({ attachedImages: images, blocks });
  }

  // 이미지 슬롯 추가
  function addImageSlot() {
    const newSlot: AttachedImage = {
      url: '',
      order: section.attachedImages.length,
      processingMode: 'original',
      source: 'gemini',
      generationHint: '',
    };
    onUpdate({ attachedImages: [...section.attachedImages, newSlot] });
  }

  // 이미지 슬롯 제거 (order 재정렬)
  function removeImageSlot(idx: number) {
    const images = section.attachedImages
      .filter((_, i) => i !== idx)
      .map((img, i) => ({ ...img, order: i }));
    onUpdate({ attachedImages: images });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* 섹션 제목 */}
      <div>
        <label style={{ fontSize: 11, color: C.textSub, display: 'block', marginBottom: 4 }}>
          섹션 제목
        </label>
        <input
          value={content.title}
          onChange={handleTitleChange}
          placeholder="예: 국내 최초 건조효모 유래 NMN"
          style={{
            width: '100%',
            padding: '8px 10px',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            fontSize: 13,
            color: C.text,
            background: C.card,
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* 핵심 포인트 */}
      <div>
        <label style={{ fontSize: 11, color: C.textSub, display: 'block', marginBottom: 6 }}>
          핵심 포인트
        </label>
        {(content.points ?? []).map((pt, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              value={pt}
              onChange={e => handlePointChange(idx, e.target.value)}
              placeholder={`포인트 ${idx + 1}`}
              style={{
                flex: 1,
                padding: '7px 10px',
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                fontSize: 13,
                color: C.text,
                background: C.card,
              }}
            />
            <button
              onClick={() => removePoint(idx)}
              style={{
                padding: '6px 8px',
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                background: C.card,
                cursor: 'pointer',
                color: C.textSub,
                fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={addPoint}
          style={{
            fontSize: 12,
            color: BRAND_PURPLE,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          + 포인트 추가
        </button>
      </div>

      {/* 이미지 슬롯 (최대 4개) */}
      <div>
        <label style={{ fontSize: 11, color: C.textSub, display: 'block', marginBottom: 6 }}>
          이미지 슬롯 (최대 4개)
        </label>
        {section.attachedImages.map((img, idx) => (
          <div
            key={idx}
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
              background: C.bg,
            }}
          >
            {/* 슬롯 헤더 */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                슬롯 {idx + 1}
              </span>
              <button
                onClick={() => removeImageSlot(idx)}
                style={{
                  fontSize: 11,
                  color: C.textSub,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                제거
              </button>
            </div>

            {/* 소스 선택 토글 */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['upload', 'gemini'] as const).map(src => (
                <button
                  key={src}
                  onClick={() => handleSlotSourceChange(idx, src)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: img.source === src ? BRAND_PURPLE : C.card,
                    color: img.source === src ? '#fff' : C.textSub,
                    border: `1px solid ${img.source === src ? BRAND_PURPLE : C.border}`,
                    transition: 'background 0.15s',
                  }}
                >
                  {src === 'upload' ? '직접 업로드' : 'Gemini 생성'}
                </button>
              ))}
            </div>

            {/* Gemini 생성 힌트 입력 + 재생성 */}
            {img.source === 'gemini' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {img.url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={img.url}
                    alt=""
                    style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }}
                  />
                )}
                <input
                  value={img.generationHint ?? ''}
                  onChange={e => handleSlotHintChange(idx, e.target.value)}
                  placeholder="예: 알약 흰 배경 정면 사진"
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    color: C.text,
                    background: C.card,
                    boxSizing: 'border-box',
                  }}
                />
                {onRegenerateSlot && (
                  <button
                    onClick={async () => {
                      if (regenIdx !== null) return;
                      setRegenIdx(idx);
                      try {
                        await onRegenerateSlot(idx, img.generationHint ?? '');
                      } finally {
                        setRegenIdx(null);
                      }
                    }}
                    disabled={regenIdx !== null}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: regenIdx !== null ? 'default' : 'pointer',
                      background: regenIdx === idx ? C.card : BRAND_PURPLE,
                      color: regenIdx === idx ? C.textSub : '#fff',
                      border: 'none',
                      opacity: regenIdx !== null && regenIdx !== idx ? 0.5 : 1,
                    }}
                  >
                    {regenIdx === idx ? '이미지 생성 중…' : img.url ? '🔄 이미지 재생성' : '✨ 이미지 생성'}
                  </button>
                )}
              </div>
            ) : (
              /* 직접 업로드 UI */
              <div>
                {img.url && (
                  <div style={{ position: 'relative', display: 'inline-block', marginBottom: 6 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt=""
                      style={{
                        width: 60,
                        height: 60,
                        objectFit: 'cover',
                        borderRadius: 6,
                        display: 'block',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const images = section.attachedImages.map((im, i) =>
                          i === idx ? { ...im, url: '' } : im
                        );
                        onUpdate({ attachedImages: images });
                      }}
                      style={{
                        position: 'absolute', top: -4, right: -4,
                        width: 16, height: 16, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.6)', border: 'none',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 0,
                      }}
                    >
                      <span style={{ fontSize: 9, color: '#fff', lineHeight: 1 }}>✕</span>
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <label
                    style={{
                      display: 'inline-block',
                      padding: '6px 12px',
                      background: C.tableHeader,
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                      color: C.text,
                    }}
                  >
                    파일 선택
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        if (e.target.files?.[0]) void handleSlotUpload(idx, e.target.files[0]);
                      }}
                    />
                  </label>
                  {/* 참고 이미지에서 불러오기 버튼 */}
                  {referenceUrls.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPickerSlotIdx(pickerSlotIdx === idx ? null : idx)}
                      style={{
                        padding: '6px 10px',
                        background: pickerSlotIdx === idx ? '#ede9fe' : C.tableHeader,
                        border: `1px solid ${pickerSlotIdx === idx ? BRAND_PURPLE : C.border}`,
                        borderRadius: 6,
                        fontSize: 12,
                        cursor: 'pointer',
                        color: pickerSlotIdx === idx ? BRAND_PURPLE : C.text,
                        fontWeight: pickerSlotIdx === idx ? 600 : 400,
                      }}
                    >
                      🖼 참고 이미지에서
                    </button>
                  )}
                </div>

                {/* 참고 이미지 피커 */}
                {pickerSlotIdx === idx && referenceUrls.length > 0 && (
                  <div style={{
                    marginTop: 8,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 6,
                    padding: 8,
                    background: '#f5f3ff',
                    border: `1px solid ${BRAND_PURPLE}33`,
                    borderRadius: 8,
                  }}>
                    {referenceUrls.map((refUrl) => (
                      <button
                        key={refUrl}
                        type="button"
                        onClick={() => {
                          const images = section.attachedImages.map((im, i) =>
                            i === idx ? { ...im, url: refUrl, source: 'upload' as const } : im
                          );
                          const blocks = ensureImageBlock(content.blocks ?? [], idx);
                          onUpdate({ attachedImages: images, blocks });
                          setPickerSlotIdx(null);
                        }}
                        style={{
                          padding: 0,
                          border: `2px solid ${C.border}`,
                          borderRadius: 6,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          aspectRatio: '1',
                          background: C.tableHeader,
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = BRAND_PURPLE; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={refUrl}
                          alt="참고 이미지"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* 슬롯 추가 버튼 (4개 미만일 때만) */}
        {section.attachedImages.length < 4 && (
          <button
            onClick={addImageSlot}
            style={{
              fontSize: 12,
              color: BRAND_PURPLE,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            + 이미지 슬롯 추가
          </button>
        )}
      </div>

      {/* 배경 스타일 선택 */}
      <div>
        <label style={{ fontSize: 11, color: C.textSub, display: 'block', marginBottom: 6 }}>
          배경 스타일
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['white', 'light', 'dark', 'primary'] as const).map(style => (
            <button
              key={style}
              onClick={() => onUpdate({ bgStyle: style })}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                fontSize: 11,
                cursor: 'pointer',
                background: content.bgStyle === style ? BRAND_PURPLE : C.card,
                color: content.bgStyle === style ? '#fff' : C.textSub,
                border: `1px solid ${content.bgStyle === style ? BRAND_PURPLE : C.border}`,
                transition: 'background 0.15s',
              }}
            >
              {{ white: '흰색', light: '연한', dark: '어두운', primary: '브랜드' }[style]}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
