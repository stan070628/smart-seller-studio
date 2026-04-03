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
    bgPage: '#FFF8F6',
    bgCard: '#FFFFFF',
    bgSubtle: '#FFF0EE',
    bgDark: '#2D1515',
    bgAccentLight: '#FFE4E1',
    headingDark: '#2D1515',
    bodyDark: '#5C3535',
    mutedDark: '#9E7070',
    headingLight: '#FFE8E8',
    mutedLight: '#D4A0A0',
    accent: '#C8614E',
    accentText: '#B04535',
    checkBg: '#FFE4DF',
    checkColor: '#C8614E',
    crossBg: '#FFE0E0',
    crossColor: '#C84040',
    border: '#F5DDD9',
    ctaGradient: 'linear-gradient(135deg, #C8614E 0%, #E07060 50%, #EE8070 100%)',
    ctaBtnBg: '#FFFFFF',
    ctaBtnText: '#C8614E',
    ctaSubTextColor: 'rgba(255,255,255,0.7)',
    afterBg: '#C8614E',
    afterLabelBg: '#D97060',
    afterText: '#FFE8E8',
    afterMuted: '#F5C4B8',
    uspDarkBg: '#2D1515',
    uspDarkerBg: '#3D2020',
    uspRowEven: '#3A1C1C',
    uspRowOdd: '#341818',
    fontFamily: "'Noto Serif KR', 'Nanum Myeongjo', serif",
  },
  functional: {
    key: 'functional',
    label: '기능 강조',
    emoji: '⚡',
    bgPage: '#F8FAFC',
    bgCard: '#FFFFFF',
    bgSubtle: '#F0F4FF',
    bgDark: '#0A0E1A',
    bgAccentLight: '#DBEAFE',
    headingDark: '#0A0E1A',
    bodyDark: '#1E293B',
    mutedDark: '#64748B',
    headingLight: '#E2E8F0',
    mutedLight: '#94A3B8',
    accent: '#2563EB',
    accentText: '#1D4ED8',
    checkBg: '#D1FAE5',
    checkColor: '#059669',
    crossBg: '#FEE2E2',
    crossColor: '#DC2626',
    border: '#E2E8F0',
    ctaGradient: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 50%, #3B82F6 100%)',
    ctaBtnBg: '#FFFFFF',
    ctaBtnText: '#1E3A8A',
    ctaSubTextColor: 'rgba(255,255,255,0.6)',
    afterBg: '#2563EB',
    afterLabelBg: '#3B82F6',
    afterText: '#EFF6FF',
    afterMuted: '#BFDBFE',
    uspDarkBg: '#0A0E1A',
    uspDarkerBg: '#0F1629',
    uspRowEven: '#141C30',
    uspRowOdd: '#111626',
    fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
  },
  premium: {
    key: 'premium',
    label: '정품 강조',
    emoji: '👑',
    bgPage: '#FAFAF5',
    bgCard: '#FFFFFF',
    bgSubtle: '#F5F0E8',
    bgDark: '#0F1923',
    bgAccentLight: '#FEF3C7',
    headingDark: '#0F1923',
    bodyDark: '#2C2C2C',
    mutedDark: '#6B6B5A',
    headingLight: '#F5F0E8',
    mutedLight: '#C4B89A',
    accent: '#C9A84C',
    accentText: '#A07828',
    checkBg: '#D8F3DC',
    checkColor: '#2D6A4F',
    crossBg: '#F5E6DC',
    crossColor: '#6B4C3B',
    border: '#E8E0CC',
    ctaGradient: 'linear-gradient(135deg, #0F1923 0%, #1A2F45 50%, #243B55 100%)',
    ctaBtnBg: '#C9A84C',
    ctaBtnText: '#0F1923',
    ctaSubTextColor: 'rgba(255,255,255,0.55)',
    afterBg: '#C9A84C',
    afterLabelBg: '#DDB965',
    afterText: '#0F1923',
    afterMuted: '#4A3C1A',
    uspDarkBg: '#0F1923',
    uspDarkerBg: '#162030',
    uspRowEven: '#1A2535',
    uspRowOdd: '#162030',
    fontFamily: "'Gowun Batang', 'Nanum Myeongjo', serif",
  },
};

export const DEFAULT_THEME = THEMES.functional;
