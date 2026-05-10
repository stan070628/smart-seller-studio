// src/lib/detail-page/palette-config.ts
import type { PaletteName } from '@/types/detail-page';

export interface PaletteColors {
  bg: string;
  bgAlt: string;
  text: string;
  textSub: string;
  accent: string;
  border: string;
  cardBg: string;
}

export const PALETTES: Record<PaletteName, PaletteColors> = {
  warm_cream: {
    bg: '#F5F0E8',
    bgAlt: '#FFFFFF',
    text: '#1A1A1A',
    textSub: '#5C5243',
    accent: '#8B6914',
    border: '#D4C5A9',
    cardBg: '#FFFDF8',
  },
  cool_white: {
    bg: '#FFFFFF',
    bgAlt: '#F8F9FA',
    text: '#111111',
    textSub: '#555555',
    accent: '#2563EB',
    border: '#E5E7EB',
    cardBg: '#FFFFFF',
  },
  deep_dark: {
    bg: '#1A1A1A',
    bgAlt: '#242424',
    text: '#FFFFFF',
    textSub: '#B0B0B0',
    accent: '#FFC107',
    border: '#333333',
    cardBg: '#2A2A2A',
  },
  nature_green: {
    bg: '#F0F7F0',
    bgAlt: '#FFFFFF',
    text: '#1A2E1A',
    textSub: '#3D5C3D',
    accent: '#2D6A2D',
    border: '#C8E0C8',
    cardBg: '#F8FBF8',
  },
  tech_navy: {
    bg: '#0F172A',
    bgAlt: '#1E293B',
    text: '#F8FAFC',
    textSub: '#94A3B8',
    accent: '#38BDF8',
    border: '#334155',
    cardBg: '#1E293B',
  },
};

export const PALETTE_LABELS: Record<PaletteName, string> = {
  warm_cream: '따뜻한 크림',
  cool_white: '깔끔한 화이트',
  deep_dark: '고급 다크',
  nature_green: '자연 그린',
  tech_navy: '테크 네이비',
};

export const DEFAULT_THEME = {
  palette: 'warm_cream' as PaletteName,
  primaryColor: '#F5F0E8',
  accentColor: '#8B6914',
  fontStyle: 'mixed' as const,
  imageLayout: 'fullbleed' as const,
};
