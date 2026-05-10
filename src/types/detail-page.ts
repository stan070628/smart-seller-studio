// src/types/detail-page.ts

export type SectionType =
  | 'hero'
  | 'selling_points'
  | 'features'
  | 'stats'
  | 'spec_table'
  | 'usage_steps'
  | 'warning'
  | 'cta';

export type PaletteName =
  | 'warm_cream'
  | 'cool_white'
  | 'deep_dark'
  | 'nature_green'
  | 'tech_navy';

export type ImageLayout = 'fullbleed' | 'composed' | 'split';
export type FontStyle = 'serif' | 'sans' | 'mixed';
export type ImageProcessingMode = 'original' | 'bg_removed' | 'bg_composed';

export interface AttachedImage {
  url: string;           // Supabase Storage 절대 URL
  order: number;
  processingMode: ImageProcessingMode;
}

export interface HeroContent {
  headline: string;
  subheadline: string;
}

export interface SellingPointsContent {
  points: Array<{ icon: string; title: string; description: string }>;
}

export interface FeaturesContent {
  items: Array<{ title: string; description: string }>;
}

export interface StatsContent {
  stats: Array<{ value: string; label: string }>;
}

export interface SpecTableContent {
  specs: Array<{ label: string; value: string }>;
}

export interface UsageStepsContent {
  steps: string[];
}

export interface WarningContent {
  warnings: string[];
}

export interface CtaContent {
  text: string;
}

export type SectionContent =
  | HeroContent
  | SellingPointsContent
  | FeaturesContent
  | StatsContent
  | SpecTableContent
  | UsageStepsContent
  | WarningContent
  | CtaContent;

export interface DetailSection {
  id: string;
  type: SectionType;
  order: number;
  content: SectionContent;
  attachedImages: AttachedImage[];
  aiInstruction?: string;
}

export interface DetailPageTheme {
  palette: PaletteName;
  primaryColor: string;
  accentColor: string;
  fontStyle: FontStyle;
  imageLayout: ImageLayout;
}

export interface DetailPageData {
  sections: DetailSection[];
  theme: DetailPageTheme;
  generatedHtml: string;
}

// 타입 가드 헬퍼
export function isHeroContent(c: SectionContent): c is HeroContent {
  return 'headline' in c;
}
export function isSellingPointsContent(c: SectionContent): c is SellingPointsContent {
  return 'points' in c;
}
export function isFeaturesContent(c: SectionContent): c is FeaturesContent {
  return 'items' in c;
}
export function isStatsContent(c: SectionContent): c is StatsContent {
  return 'stats' in c;
}
export function isSpecTableContent(c: SectionContent): c is SpecTableContent {
  return 'specs' in c;
}
export function isUsageStepsContent(c: SectionContent): c is UsageStepsContent {
  return 'steps' in c;
}
export function isWarningContent(c: SectionContent): c is WarningContent {
  return 'warnings' in c;
}
export function isCtaContent(c: SectionContent): c is CtaContent {
  return 'text' in c;
}
