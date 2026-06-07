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
  | 'tech_navy'
  | 'rose_soft'
  | 'cream_cozy'
  | 'sunset_warm'
  | 'fresh_mint';

export type ImageLayout = 'fullbleed' | 'composed' | 'split';
export type FontStyle = 'serif' | 'sans' | 'mixed';
export type ImageProcessingMode = 'original' | 'bg_removed' | 'bg_composed';

export interface AttachedImage {
  url: string;           // Supabase Storage 절대 URL
  order: number;
  processingMode: ImageProcessingMode;
}

export interface HeroContent {
  type: 'hero';
  headline: string;
  subheadline: string;
}

export interface SellingPointsContent {
  type: 'selling_points';
  points: Array<{ icon: string; title: string; description: string }>;
}

export interface FeaturesContent {
  type: 'features';
  items: Array<{ title: string; description: string }>;
}

export interface StatsContent {
  type: 'stats';
  stats: Array<{ value: string; label: string }>;
}

export interface SpecTableContent {
  type: 'spec_table';
  specs: Array<{ label: string; value: string }>;
}

export interface UsageStepsContent {
  type: 'usage_steps';
  steps: string[];
}

export interface WarningContent {
  type: 'warning';
  warnings: string[];
}

export interface CtaContent {
  type: 'cta';
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
  eyebrow?: string;
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
  return c.type === 'hero';
}
export function isSellingPointsContent(c: SectionContent): c is SellingPointsContent {
  return c.type === 'selling_points';
}
export function isFeaturesContent(c: SectionContent): c is FeaturesContent {
  return c.type === 'features';
}
export function isStatsContent(c: SectionContent): c is StatsContent {
  return c.type === 'stats';
}
export function isSpecTableContent(c: SectionContent): c is SpecTableContent {
  return c.type === 'spec_table';
}
export function isUsageStepsContent(c: SectionContent): c is UsageStepsContent {
  return c.type === 'usage_steps';
}
export function isWarningContent(c: SectionContent): c is WarningContent {
  return c.type === 'warning';
}
export function isCtaContent(c: SectionContent): c is CtaContent {
  return c.type === 'cta';
}
