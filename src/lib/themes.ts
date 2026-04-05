/**
 * themes.ts
 * 뷰티 / 기능 강조 / 정품 강조 3가지 테마 정의
 */

export type ThemeKey = 'beauty' | 'functional' | 'premium';

export interface Theme {
  key: ThemeKey;
  label: string;
  emoji: string;

  // 배경
  bgPage: string;        // 템플릿 기본 배경
  bgCard: string;        // 카드 배경
  bgSubtle: string;      // 섹션 배경 (연한 색)
  bgDark: string;        // 어두운 섹션 배경
  bgAccentLight: string; // 아이콘 배경, accent 연한 버전

  // 텍스트 (밝은 배경)
  headingDark: string;
  bodyDark: string;
  mutedDark: string;

  // 텍스트 (어두운 배경)
  headingLight: string;
  mutedLight: string;

  // Accent
  accent: string;
  accentText: string;

  // 체크/엑스
  checkBg: string;
  checkColor: string;
  crossBg: string;
  crossColor: string;

  // 테두리
  border: string;

  // CTA
  ctaGradient: string;
  ctaBtnBg: string;
  ctaBtnText: string;
  ctaSubTextColor: string;

  // Before/After
  afterBg: string;
  afterLabelBg: string;
  afterText: string;
  afterMuted: string;

  // 비교표 (USP)
  uspDarkBg: string;
  uspDarkerBg: string;
  uspRowEven: string;
  uspRowOdd: string;

  // 폰트
  fontFamily: string;
}

export const THEMES: Record<ThemeKey, Theme> = {
  beauty: {
    key: 'beauty',
    label: '뷰티제품',
    emoji: '✨',
    bgPage: '#f9f9f9',
    bgCard: '#ffffff',
    bgSubtle: '#f3f3f3',
    bgDark: '#1a1c1c',
    bgAccentLight: '#e7bdb8',
    headingDark: '#1a1c1c',
    bodyDark: '#1a1c1c',
    mutedDark: '#926f6b',
    headingLight: '#ffffff',
    mutedLight: '#e7bdb8',
    accent: '#be0014',
    accentText: '#be0014',
    checkBg: '#FFE4DF',
    checkColor: '#be0014',
    crossBg: '#FFE0E0',
    crossColor: '#be0014',
    border: '#eeeeee',
    ctaGradient: 'linear-gradient(135deg, #be0014 0%, #d4001a 50%, #e0102a 100%)',
    ctaBtnBg: '#FFFFFF',
    ctaBtnText: '#be0014',
    ctaSubTextColor: 'rgba(255,255,255,0.7)',
    afterBg: '#be0014',
    afterLabelBg: '#d4001a',
    afterText: '#ffffff',
    afterMuted: '#e7bdb8',
    uspDarkBg: '#1a1c1c',
    uspDarkerBg: '#2a2c2c',
    uspRowEven: '#242626',
    uspRowOdd: '#1e2020',
    fontFamily: "'Noto Serif KR', 'Nanum Myeongjo', serif",
  },
  functional: {
    key: 'functional',
    label: '기능 강조',
    emoji: '⚡',
    bgPage: '#f9f9f9',
    bgCard: '#ffffff',
    bgSubtle: '#f3f3f3',
    bgDark: '#1a1c1c',
    bgAccentLight: '#d3e4ff',
    headingDark: '#1a1c1c',
    bodyDark: '#1a1c1c',
    mutedDark: '#926f6b',
    headingLight: '#ffffff',
    mutedLight: '#94A3B8',
    accent: '#0060a8',
    accentText: '#0060a8',
    checkBg: '#D1FAE5',
    checkColor: '#059669',
    crossBg: '#FEE2E2',
    crossColor: '#DC2626',
    border: '#eeeeee',
    ctaGradient: 'linear-gradient(135deg, #003d6e 0%, #0060a8 50%, #0077cc 100%)',
    ctaBtnBg: '#FFFFFF',
    ctaBtnText: '#0060a8',
    ctaSubTextColor: 'rgba(255,255,255,0.6)',
    afterBg: '#0060a8',
    afterLabelBg: '#0077cc',
    afterText: '#EFF6FF',
    afterMuted: '#d3e4ff',
    uspDarkBg: '#1a1c1c',
    uspDarkerBg: '#2a2c2c',
    uspRowEven: '#242626',
    uspRowOdd: '#1e2020',
    fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
  },
  premium: {
    key: 'premium',
    label: '정품 강조',
    emoji: '👑',
    bgPage: '#f9f9f9',
    bgCard: '#ffffff',
    bgSubtle: '#f3f3f3',
    bgDark: '#1a1c1c',
    bgAccentLight: '#FEF3C7',
    headingDark: '#1a1c1c',
    bodyDark: '#1a1c1c',
    mutedDark: '#926f6b',
    headingLight: '#ffffff',
    mutedLight: '#C4B89A',
    accent: '#be0014',
    accentText: '#be0014',
    checkBg: '#D8F3DC',
    checkColor: '#2D6A4F',
    crossBg: '#F5E6DC',
    crossColor: '#6B4C3B',
    border: '#eeeeee',
    ctaGradient: 'linear-gradient(135deg, #1a1c1c 0%, #2a2c2c 50%, #3a3c3c 100%)',
    ctaBtnBg: '#be0014',
    ctaBtnText: '#ffffff',
    ctaSubTextColor: 'rgba(255,255,255,0.55)',
    afterBg: '#be0014',
    afterLabelBg: '#d4001a',
    afterText: '#ffffff',
    afterMuted: '#e7bdb8',
    uspDarkBg: '#1a1c1c',
    uspDarkerBg: '#2a2c2c',
    uspRowEven: '#242626',
    uspRowOdd: '#1e2020',
    fontFamily: "'Gowun Batang', 'Nanum Myeongjo', serif",
  },
};

export const DEFAULT_THEME = THEMES.functional;
