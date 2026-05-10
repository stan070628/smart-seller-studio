// src/lib/detail-page/palette-config.ts
import type { DetailPageTheme, PaletteName } from '@/types/detail-page';

export interface PaletteColors {
  bg: string;
  bgAlt: string;
  text: string;
  textSub: string;
  accent: string;
  border: string;
  cardBg: string;
  // accent 배경 위 텍스트 색상 (WCAG AA 기준)
  accentTextColor: string;
}

export const PALETTES: Record<PaletteName, PaletteColors> = {
  warm_cream: {
    bg: '#F5F0E8',
    bgAlt: '#FFFFFF',
    text: '#1A1A1A',
    textSub: '#5C5243',
    accent: '#7A5C10',  // #8B6914 → 4.484:1 WCAG AA 미달, #7A5C10 → ~5.1:1 통과
    border: '#D4C5A9',
    cardBg: '#FFFDF8',
    accentTextColor: '#FFFFFF', // accent #7A5C10 (어두운 갈색) → 흰색 텍스트
  },
  cool_white: {
    bg: '#FFFFFF',
    bgAlt: '#F8F9FA',
    text: '#111111',
    textSub: '#555555',
    accent: '#2563EB',
    border: '#E5E7EB',
    cardBg: '#FFFFFF',
    accentTextColor: '#FFFFFF', // accent #2563EB (어두운 파랑) → 흰색 텍스트
  },
  deep_dark: {
    bg: '#1A1A1A',
    bgAlt: '#242424',
    text: '#FFFFFF',
    textSub: '#B0B0B0',
    accent: '#FFC107',
    border: '#333333',
    cardBg: '#2A2A2A',
    accentTextColor: '#111111', // accent #FFC107 (밝은 노랑) → 어두운 텍스트
  },
  nature_green: {
    bg: '#F0F7F0',
    bgAlt: '#FFFFFF',
    text: '#1A2E1A',
    textSub: '#3D5C3D',
    accent: '#2D6A2D',
    border: '#C8E0C8',
    cardBg: '#F8FBF8',
    accentTextColor: '#FFFFFF', // accent #2D6A2D (어두운 녹색) → 흰색 텍스트
  },
  tech_navy: {
    bg: '#0F172A',
    bgAlt: '#1E293B',
    text: '#F8FAFC',
    textSub: '#94A3B8',
    accent: '#38BDF8',
    border: '#334155',
    cardBg: '#1E293B',
    accentTextColor: '#111111', // accent #38BDF8 (밝은 하늘색) → 어두운 텍스트
  },
};

export const PALETTE_LABELS: Record<PaletteName, string> = {
  warm_cream: '따뜻한 크림',
  cool_white: '깔끔한 화이트',
  deep_dark: '고급 다크',
  nature_green: '자연 그린',
  tech_navy: '테크 네이비',
};

export const DEFAULT_THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#F5F0E8',
  accentColor: '#7A5C10',
  fontStyle: 'mixed',
  imageLayout: 'fullbleed',
};
