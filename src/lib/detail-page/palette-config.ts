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
  accentTextColor: string;
  categories: string[];
  labelColor: string;
}

export const PALETTES: Record<PaletteName, PaletteColors> = {
  warm_cream: {
    bg: '#F5F0E8',
    bgAlt: '#FFFFFF',
    text: '#1A1A1A',
    textSub: '#5C5243',
    accent: '#7A5C10',
    border: '#D4C5A9',
    cardBg: '#FFFDF8',
    accentTextColor: '#FFFFFF',
    categories: ['홈리빙', '식품', '반려동물', '인테리어'],
    labelColor: '#7A5C10',
  },
  cool_white: {
    bg: '#FFFFFF',
    bgAlt: '#F8F9FA',
    text: '#111111',
    textSub: '#555555',
    accent: '#2563EB',
    border: '#E5E7EB',
    cardBg: '#FFFFFF',
    accentTextColor: '#FFFFFF',
    categories: ['디지털', '가전', 'B2B', '사무용품'],
    labelColor: '#2563EB',
  },
  deep_dark: {
    bg: '#1A1A1A',
    bgAlt: '#242424',
    text: '#FFFFFF',
    textSub: '#B0B0B0',
    accent: '#FFC107',
    border: '#333333',
    cardBg: '#2A2A2A',
    accentTextColor: '#111111',
    categories: ['패션', '뷰티', '주류', '명품'],
    labelColor: '#FFC107',
  },
  nature_green: {
    bg: '#F0F7F0',
    bgAlt: '#FFFFFF',
    text: '#1A2E1A',
    textSub: '#3D5C3D',
    accent: '#2D6A2D',
    border: '#C8E0C8',
    cardBg: '#F8FBF8',
    accentTextColor: '#FFFFFF',
    categories: ['유기농식품', '건강식품', '반려동물', '아웃도어'],
    labelColor: '#2D6A2D',
  },
  tech_navy: {
    bg: '#0F172A',
    bgAlt: '#1E293B',
    text: '#F8FAFC',
    textSub: '#94A3B8',
    accent: '#38BDF8',
    border: '#334155',
    cardBg: '#1E293B',
    accentTextColor: '#111111',
    categories: ['IT', '디지털', '스포츠', '자동차용품'],
    labelColor: '#38BDF8',
  },
  rose_soft: {
    bg: '#fce4ec',
    bgAlt: '#ffffff',
    text: '#880e4f',
    textSub: '#ad1457',
    accent: '#880e4f',
    border: '#f48fb1',
    cardBg: '#fff5f8',
    accentTextColor: '#ffffff',
    categories: ['뷰티', '스킨케어', '여성패션'],
    labelColor: '#880e4f',
  },
  cream_cozy: {
    bg: '#fdf6e3',
    bgAlt: '#ffffff',
    text: '#4a3728',
    textSub: '#6d4c41',
    accent: '#8b5a2b',
    border: '#e8d5b7',
    cardBg: '#fffdf5',
    accentTextColor: '#ffffff',
    categories: ['홈카페', '식품', '유아', '반려동물'],
    labelColor: '#8b5a2b',
  },
  sunset_warm: {
    bg: '#fff3e0',
    bgAlt: '#ffffff',
    text: '#3e2723',
    textSub: '#5d4037',
    accent: '#bf360c',
    border: '#ffcc80',
    cardBg: '#fffaf5',
    accentTextColor: '#ffffff',
    categories: ['식품', '주방', '라이프스타일', '홈리빙'],
    labelColor: '#bf360c',
  },
  fresh_mint: {
    bg: '#e8f8f5',
    bgAlt: '#ffffff',
    text: '#1b5e20',
    textSub: '#2e7d32',
    accent: '#1b5e20',
    border: '#a5d6a7',
    cardBg: '#f0faf5',
    accentTextColor: '#ffffff',
    categories: ['헬스케어', '건기식', '유아', '의약외품'],
    labelColor: '#1b5e20',
  },
};

export const PALETTE_LABELS: Record<PaletteName, string> = {
  warm_cream: '따뜻한 크림',
  cool_white: '깔끔한 화이트',
  deep_dark: '고급 다크',
  nature_green: '자연 그린',
  tech_navy: '테크 네이비',
  rose_soft: '로즈 소프트',
  cream_cozy: '크림 코지',
  sunset_warm: '선셋 웜',
  fresh_mint: '프레시 민트',
};

export const DEFAULT_THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#F5F0E8',
  accentColor: '#7A5C10',
  fontStyle: 'mixed',
  imageLayout: 'fullbleed',
};
