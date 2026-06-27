'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';
import type { DetailSection, ClaudeLayoutContent, AttachedImage } from '@/types/detail-page';

interface Props {
  section: DetailSection;
  onUpdate: (updates: Partial<ClaudeLayoutContent> & { attachedImages?: AttachedImage[] }) => void;
  onUploadFile: (file: File) => Promise<string>;
}

const BRAND_PURPLE = '#7c3aed';

export default function ClaudeLayoutEditor({ section, onUpdate, onUploadFile }: Props) {
  const content = section.content as ClaudeLayoutContent;

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

  // 직접 업로드 처리
  async function handleSlotUpload(idx: number, file: File) {
    const url = await onUploadFile(file);
    const images = section.attachedImages.map((img, i) =>
      i === idx ? { ...img, url, source: 'upload' as const } : img
    );
    onUpdate({ attachedImages: images });
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

            {/* Gemini 생성 힌트 입력 */}
            {img.source === 'gemini' ? (
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
            ) : (
              /* 직접 업로드 UI */
              <div>
                {img.url && (
                  <img
                    src={img.url}
                    alt=""
                    style={{
                      width: 60,
                      height: 60,
                      objectFit: 'cover',
                      borderRadius: 6,
                      marginBottom: 6,
                      display: 'block',
                    }}
                  />
                )}
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
