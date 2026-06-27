// src/types/detail-page.ts

export type SectionType =
  | 'hero'
  | 'selling_points'
  | 'features'
  | 'stats'
  | 'spec_table'
  | 'usage_steps'
  | 'warning'
  | 'cta'
  | 'brand_header'
  | 'point'
  | 'image_grid'
  | 'point_section'
  | 'stat_callout'
  | 'bar_chart'
  | 'why_icons'
  | 'certifications'
  | 'infographic_steps'
  | 'claude_layout';

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
  source?: 'upload' | 'gemini';
  generationHint?: string;
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

export interface BrandHeaderContent {
  type: 'brand_header';
  brandName: string;     // 좌측 브랜드명 (예: "킵틸 KeepTill")
  rightLabel: string;    // 우측 영문 카테고리 (예: "pencil pouch")
}

export interface PointContent {
  type: 'point';
  pointLabel: string | null;  // "Point 1" — null 또는 빈 문자열이면 라벨 줄 숨김
  headline: string;            // 예: "펼치면 바로 '보이는' 필통"
  subheadline: string;         // 예: "180도 완전 오픈형 구조"
  textPosition?: 'top' | 'center' | 'bottom'; // 이미지 위 텍스트 오버레이 수직 위치
}

export interface ImageGridContent {
  type: 'image_grid';
  title: string;                                          // "Product Info." (빈 값이면 생략)
  items: Array<{ label: string; swatchColor?: string }>;  // 이미지는 attachedImages와 index 매칭
  points?: string[];                                       // Claude OCR 추출 포인트 (있으면 오버레이 렌더링)
}

export interface PointSectionContent {
  type: 'point_section';
  items: Array<{
    number: number;
    title: string;
    description: string;
  }>;
}

export interface StatCalloutContent {
  type: 'stat_callout';
  items: Array<{
    value: string;
    label: string;
    description: string;
  }>;
}

export interface BarChartContent {
  type: 'bar_chart';
  items: Array<{
    label: string;
    percentage: number;
    displayValue: string;
  }>;
}

export interface WhyIconsContent {
  type: 'why_icons';
  items: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
}

export interface CertificationsContent {
  type: 'certifications';
  items: Array<{
    name: string;
    description: string;
  }>;
}

export interface InfographicStepsContent {
  type: 'infographic_steps';
  items: Array<{
    step: number;
    icon: string;
    title: string;
    description: string;
  }>;
}

export type LayoutBlock =
  | { type: 'badge'; text: string; color?: 'primary' | 'accent' | 'neutral' }
  | { type: 'heading'; text: string; size: 'xl' | 'lg' | 'md'; bold?: boolean; color?: 'primary' | 'text' | 'accent' }
  | { type: 'subtext'; text: string; align?: 'left' | 'center' }
  | { type: 'image'; attachedIndex: number; width?: string; align?: 'center' | 'left' | 'right'; rounded?: boolean }
  | { type: 'stat_row'; items: Array<{ label: string; value: string; unit?: string }> }
  | { type: 'bullet_list'; items: string[]; icon?: 'dot' | 'check' | 'arrow' }
  | { type: 'columns'; cols: LayoutBlock[][]; gap?: number }
  | { type: 'divider' }
  | { type: 'spacer'; height: number }

export interface ClaudeLayoutContent {
  type: 'claude_layout';
  title: string;
  points?: string[];
  blocks: LayoutBlock[];
  bgStyle?: 'white' | 'light' | 'dark' | 'primary';
  padding?: 'normal' | 'compact' | 'wide';
}

export type SectionContent =
  | HeroContent
  | SellingPointsContent
  | FeaturesContent
  | StatsContent
  | SpecTableContent
  | UsageStepsContent
  | WarningContent
  | CtaContent
  | BrandHeaderContent
  | PointContent
  | ImageGridContent
  | PointSectionContent
  | StatCalloutContent
  | BarChartContent
  | WhyIconsContent
  | CertificationsContent
  | InfographicStepsContent
  | ClaudeLayoutContent;

export interface DetailSection {
  id: string;
  type: SectionType;
  order?: number;
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
  /** 렌더링 레이아웃 모드 — 미지정 시 'desktop' (기존 흐름 무영향) */
  layoutMode?: 'desktop' | 'mobile';
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
export function isBrandHeaderContent(c: SectionContent): c is BrandHeaderContent {
  return c.type === 'brand_header';
}
export function isPointContent(c: SectionContent): c is PointContent {
  return c.type === 'point';
}
export function isImageGridContent(c: SectionContent): c is ImageGridContent {
  return c.type === 'image_grid';
}
export function isPointSectionContent(c: SectionContent): c is PointSectionContent {
  return c.type === 'point_section';
}
export function isStatCalloutContent(c: SectionContent): c is StatCalloutContent {
  return c.type === 'stat_callout';
}
export function isBarChartContent(c: SectionContent): c is BarChartContent {
  return c.type === 'bar_chart';
}
export function isWhyIconsContent(c: SectionContent): c is WhyIconsContent {
  return c.type === 'why_icons';
}
export function isCertificationsContent(c: SectionContent): c is CertificationsContent {
  return c.type === 'certifications';
}
export function isInfographicStepsContent(c: SectionContent): c is InfographicStepsContent {
  return c.type === 'infographic_steps';
}
export function isClaudeLayoutContent(c: SectionContent): c is ClaudeLayoutContent {
  return c.type === 'claude_layout';
}

export interface RichSections {
  selectedSections: ('point' | 'stat' | 'bar_chart' | 'why' | 'cert' | 'steps')[];
  pointSections?: Array<{ number: number; title: string; description: string }>;
  statCallouts?: Array<{ value: string; label: string; description: string }>;
  barChartItems?: Array<{ label: string; percentage: number; displayValue: string }>;
  whyIcons?: Array<{ icon: string; title: string; description: string }>;
  certifications?: Array<{ name: string; description: string }>;
  infographicSteps?: Array<{ step: number; icon: string; title: string; description: string }>;
}

/** 무드 프리셋 — 정적 카탈로그 항목. AI 추천과 갤러리가 모두 이 id를 가리킨다. */
export interface MoodPreset {
  id: string;            // 'nordic_minimal' 등
  label: string;         // '북유럽 미니멀'
  emoji: string;         // 🌿 (썸네일 대용)
  keywords: string[];    // ['밝은 우드','린넨','자연광']
  palette: PaletteName;  // 선택 시 페이지 테마로 세팅
  sceneHint: string;     // 영문 — 씬 프롬프트 art direction
}

/** 크리에이티브 브리프 — 무드 선택 결과. 비어 있으면 기존 동작과 동일. */
export interface CreativeBrief {
  moodId: string | null;
  sceneHint: string;
  paletteOverride?: PaletteName;
}

export interface SceneStoryboardItem {
  id: string;                 // crypto.randomUUID()
  title: string;
  description: string;
  prompt: string;             // Gemini용 영어 원문
  promptKo?: string;          // 사용자 표시용 한국어 요약
  textPosition?: 'top' | 'center' | 'bottom'; // 씬 이미지 위 텍스트 오버레이 수직 위치
  sourceImageIndex: number;   // uploadedUrls[sourceImageIndex]
  mode: 'ai' | 'cleanup';
  resultUrl?: string;         // 생성 완료된 씬 이미지 URL (스토리보드 카드 미리보기용)
  sectionId: string | null;   // 연결된 DetailSection.id, null이면 매핑 없음
}
