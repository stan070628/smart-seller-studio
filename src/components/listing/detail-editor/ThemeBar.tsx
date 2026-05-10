'use client';
import React from 'react';
import { Palette } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import type { DetailPageTheme, PaletteName, FontStyle, ImageLayout } from '@/types/detail-page';
import { PALETTE_LABELS, PALETTES } from '@/lib/detail-page/palette-config';

interface ThemeBarProps {
  theme: DetailPageTheme;
  onThemeChange: (theme: DetailPageTheme) => void;
}

// 팔레트 이름 순서 고정
const PALETTE_NAMES: PaletteName[] = [
  'warm_cream',
  'cool_white',
  'deep_dark',
  'nature_green',
  'tech_navy',
];

// 이미지 레이아웃 레이블
const LAYOUT_LABELS: Record<ImageLayout, string> = {
  fullbleed: '풀블리드',
  composed: '컴포즈드',
  split: '분할',
};

// 폰트 스타일 레이블
const FONT_LABELS: Record<FontStyle, string> = {
  sans: '고딕',
  serif: '명조',
  mixed: '혼합',
};

const LAYOUTS: ImageLayout[] = ['fullbleed', 'composed', 'split'];
const FONTS: FontStyle[] = ['sans', 'serif', 'mixed'];

export default function ThemeBar({ theme, onThemeChange }: ThemeBarProps) {
  // 팔레트 선택 — primaryColor·accentColor도 함께 업데이트
  const handlePaletteSelect = (name: PaletteName) => {
    onThemeChange({
      ...theme,
      palette: name,
      primaryColor: PALETTES[name].bg,
      accentColor: PALETTES[name].accent,
    });
  };

  // 레이아웃 선택
  const handleLayoutSelect = (layout: ImageLayout) => {
    onThemeChange({ ...theme, imageLayout: layout });
  };

  // 폰트 선택
  const handleFontSelect = (font: FontStyle) => {
    onThemeChange({ ...theme, fontStyle: font });
  };

  // 공통 그룹 버튼 스타일
  const groupButtonStyle = (isSelected: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    fontSize: 12,
    border: `1px solid ${isSelected ? C.accent : '#dddddd'}`,
    borderRadius: 5,
    background: isSelected ? `${C.accent}12` : '#ffffff',
    color: isSelected ? C.accent : C.text,
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: isSelected ? 600 : 400,
    transition: 'border-color 0.15s, background 0.15s, color 0.15s',
  });

  return (
    <div
      style={{
        background: '#ffffff',
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '12px 14px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* ── 팔레트 행 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* 섹션 레이블 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: C.textSub,
            fontSize: 12,
            fontWeight: 600,
            minWidth: 52,
          }}
        >
          <Palette size={13} />
          <span>팔레트</span>
        </div>

        {/* 팔레트 버튼 목록 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PALETTE_NAMES.map((name) => {
            const palette = PALETTES[name];
            const isSelected = theme.palette === name;
            return (
              <button
                key={name}
                onClick={() => handlePaletteSelect(name)}
                title={PALETTE_LABELS[name]}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  border: `1.5px solid ${isSelected ? C.accent : '#dddddd'}`,
                  borderRadius: 6,
                  background: isSelected ? `${C.accent}10` : '#ffffff',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {/* bg 색상 원 + accent 색상 원 */}
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: palette.bg,
                      border: '1px solid #cccccc',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: palette.accent,
                      border: '1px solid #cccccc',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: isSelected ? C.accent : C.text,
                    fontWeight: isSelected ? 600 : 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {PALETTE_LABELS[name]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 레이아웃 행 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            color: C.textSub,
            fontSize: 12,
            fontWeight: 600,
            minWidth: 52,
          }}
        >
          레이아웃
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {LAYOUTS.map((layout) => (
            <button
              key={layout}
              onClick={() => handleLayoutSelect(layout)}
              style={groupButtonStyle(theme.imageLayout === layout)}
            >
              {LAYOUT_LABELS[layout]}
            </button>
          ))}
        </div>
      </div>

      {/* ── 폰트 행 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            color: C.textSub,
            fontSize: 12,
            fontWeight: 600,
            minWidth: 52,
          }}
        >
          폰트
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {FONTS.map((font) => (
            <button
              key={font}
              onClick={() => handleFontSelect(font)}
              style={groupButtonStyle(theme.fontStyle === font)}
            >
              {FONT_LABELS[font]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
