# 상세페이지 디자인 업그레이드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상세페이지 생성/편집 UI를 섹션별 카드 리스트 + 드래그 정렬 + 섹션별 AI 지시어 + 제품 분석 기반 자동 테마 적용으로 전면 업그레이드한다.

**Architecture:** `DetailPageEditor` 공통 컴포넌트를 새로 만들어 Step3ReviewRegister와 AssetsResultPanel 양쪽에서 재사용한다. 백엔드는 `/api/detail-page/` 경로 아래 신규 라우트 4개를 추가하며, 기존 `/api/ai/generate-detail-html`과 `/api/ai/edit-detail-html`은 그대로 유지한다. 섹션 데이터는 Zustand store에 `detailPageSections`와 `detailPageTheme`으로 추가하고, 렌더링은 서버사이드 `/api/detail-page/render`가 담당한다.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zustand, @dnd-kit/core + @dnd-kit/sortable, Sharp.js (이미 설치됨), Claude Sonnet 4.6, Gemini Vision (이미지 분석), Supabase Storage

---

## 파일 구조

### 신규 생성

```
src/types/detail-page.ts                            — DetailSection/Theme/Data 타입 정의
src/lib/detail-page/section-parser.ts               — 기존 HTML → DetailSection[] 파싱
src/lib/detail-page/section-renderer.ts             — DetailSection[] + theme → HTML
src/lib/detail-page/palette-config.ts               — 팔레트별 색상 토큰
src/components/listing/detail-editor/
  DetailPageEditor.tsx                              — 메인 공통 에디터 컴포넌트
  SectionCard.tsx                                   — 섹션 카드 (드래그 핸들 포함)
  SectionInstructionPanel.tsx                       — 섹션별 AI 지시어 패널
  ThemeBar.tsx                                      — 팔레트/레이아웃/폰트 선택 바
  AddSectionMenu.tsx                                — 섹션 타입 추가 드롭다운
src/app/api/detail-page/
  analyze-product/route.ts                          — 이미지/URL → 테마 추천
  edit-section/route.ts                             — 섹션 1개 AI 재생성
  process-image/route.ts                            — 배경제거 + 합성 + Storage 저장
  render/route.ts                                   — sections[] + theme → HTML
```

### 수정

```
package.json                                        — @dnd-kit 패키지 추가
src/store/useListingStore.ts                        — detailPageSections, detailPageTheme 상태 추가
src/components/listing/workflow/Step3ReviewRegister.tsx  — DetailPageEditor로 교체
src/components/listing/assets/AssetsResultPanel.tsx     — DetailPageEditor로 교체
```

---

## Task 1: 타입 정의 + 팔레트 설정

**Files:**
- Create: `src/types/detail-page.ts`
- Create: `src/lib/detail-page/palette-config.ts`

- [ ] **Step 1: `src/types/detail-page.ts` 생성**

```typescript
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
```

- [ ] **Step 2: `src/lib/detail-page/palette-config.ts` 생성**

```typescript
// src/lib/detail-page/palette-config.ts
import type { PaletteName } from '@/types/detail-page';

export interface PaletteColors {
  bg: string;
  bgAlt: string;          // 교대 섹션 배경
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
```

- [ ] **Step 3: 타입 체크 통과 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -E "detail-page|palette" | head -20
```

Expected: 오류 없음 (또는 기존 오류만 출력)

- [ ] **Step 4: 커밋**

```bash
git add src/types/detail-page.ts src/lib/detail-page/palette-config.ts
git commit -m "feat(detail-page): DetailSection/Theme 타입 + 팔레트 설정 추가"
```

---

## Task 2: dnd-kit 설치 + Section 렌더러

**Files:**
- Modify: `package.json`
- Create: `src/lib/detail-page/section-renderer.ts`

- [ ] **Step 1: dnd-kit 설치**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: package.json에 `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` 추가됨

- [ ] **Step 2: `src/lib/detail-page/section-renderer.ts` 생성**

```typescript
// src/lib/detail-page/section-renderer.ts
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import { PALETTES } from '@/lib/detail-page/palette-config';
import {
  isHeroContent, isSellingPointsContent, isFeaturesContent,
  isStatsContent, isSpecTableContent, isUsageStepsContent,
  isWarningContent, isCtaContent,
} from '@/types/detail-page';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHero(section: DetailSection, p: ReturnType<typeof PALETTES['warm_cream']['bg']['valueOf']> extends string ? never : typeof PALETTES[keyof typeof PALETTES], theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette];
  if (!isHeroContent(section.content)) return '';
  const { headline, subheadline } = section.content;
  const imgUrl = section.attachedImages[0]?.url;
  const imgTag = imgUrl
    ? `<img src="${esc(imgUrl)}" alt="${esc(headline)}" style="width:100%;height:auto;display:block;" />`
    : '';
  return `<section style="width:100%;background:${palette.bg};">
  ${imgTag}
  <div style="padding:40px 28px 36px;text-align:center;">
    <h1 style="margin:0 0 14px;font-size:30px;font-weight:800;color:${palette.text};line-height:1.3;letter-spacing:-0.5px;">${esc(headline)}</h1>
    <p style="margin:0;font-size:18px;color:${palette.textSub};line-height:1.7;">${esc(subheadline)}</p>
  </div>
</section>`;
}

function renderSellingPoints(section: DetailSection, theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette];
  if (!isSellingPointsContent(section.content)) return '';
  const cards = section.content.points.map(sp => `
    <div style="flex:1;min-width:140px;background:${palette.cardBg};border-radius:16px;padding:24px 16px;text-align:center;border:1px solid ${palette.border};">
      <div style="font-size:32px;margin-bottom:12px;">${esc(sp.icon)}</div>
      <div style="font-size:16px;font-weight:700;color:${palette.text};margin-bottom:8px;">${esc(sp.title)}</div>
      <div style="font-size:14px;color:${palette.textSub};line-height:1.6;">${esc(sp.description)}</div>
    </div>`).join('');
  return `<section style="width:100%;background:${palette.bgAlt};padding:40px 24px;">
  <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;">${cards}</div>
</section>`;
}

function renderFeatures(section: DetailSection, theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette];
  if (!isFeaturesContent(section.content)) return '';
  const items = section.content.items.map((f, i) => {
    const imgUrl = section.attachedImages[i]?.url;
    const imgTag = imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(f.title)}" style="width:100%;height:auto;display:block;border-radius:12px;" />` : '';
    const isEven = i % 2 === 1;
    const flexDir = isEven && theme.imageLayout === 'split' ? 'row-reverse' : 'row';
    return `<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:center;flex-direction:${flexDir};margin-bottom:32px;">
      ${imgUrl ? `<div style="flex:1;min-width:200px;">${imgTag}</div>` : ''}
      <div style="flex:1;min-width:200px;">
        <h3 style="margin:0 0 10px;font-size:20px;font-weight:700;color:${palette.text};">${esc(f.title)}</h3>
        <p style="margin:0;font-size:15px;color:${palette.textSub};line-height:1.7;">${esc(f.description)}</p>
      </div>
    </div>`;
  }).join('');
  return `<section style="width:100%;background:${palette.bg};padding:40px 24px;">${items}</section>`;
}

function renderStats(section: DetailSection, theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette];
  if (!isStatsContent(section.content)) return '';
  const items = section.content.stats.map(s => `
    <div style="text-align:center;flex:1;min-width:120px;">
      <div style="font-size:52px;font-weight:800;color:${palette.accent};line-height:1;">${esc(s.value)}</div>
      <div style="font-size:14px;color:${palette.textSub};margin-top:8px;">${esc(s.label)}</div>
    </div>`).join('');
  return `<section style="width:100%;background:${palette.bgAlt};padding:48px 24px;">
  <div style="display:flex;flex-wrap:wrap;gap:24px;justify-content:center;">${items}</div>
</section>`;
}

function renderSpecTable(section: DetailSection, theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette];
  if (!isSpecTableContent(section.content)) return '';
  const rows = section.content.specs.map((s, i) => `
    <tr style="background:${i % 2 === 0 ? palette.bg : palette.bgAlt};">
      <td style="padding:12px 16px;font-size:14px;font-weight:600;color:${palette.textSub};width:40%;border-bottom:1px solid ${palette.border};">${esc(s.label)}</td>
      <td style="padding:12px 16px;font-size:14px;color:${palette.text};border-bottom:1px solid ${palette.border};">${esc(s.value)}</td>
    </tr>`).join('');
  return `<section style="width:100%;background:${palette.bg};padding:32px 24px;">
  <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:${palette.text};">제품 사양</h3>
  <table style="width:100%;border-collapse:collapse;border:1px solid ${palette.border};border-radius:8px;overflow:hidden;">${rows}</table>
</section>`;
}

function renderUsageSteps(section: DetailSection, theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette];
  if (!isUsageStepsContent(section.content)) return '';
  const steps = section.content.steps.map((step, i) => `
    <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:20px;">
      <div style="width:32px;height:32px;min-width:32px;border-radius:50%;background:${palette.accent};color:${palette.bg};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;">${i + 1}</div>
      <p style="margin:0;font-size:15px;color:${palette.text};line-height:1.7;padding-top:4px;">${esc(step)}</p>
    </div>`).join('');
  return `<section style="width:100%;background:${palette.bgAlt};padding:40px 24px;">
  <h3 style="margin:0 0 24px;font-size:18px;font-weight:700;color:${palette.text};">사용 방법</h3>
  ${steps}
</section>`;
}

function renderWarning(section: DetailSection, theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette];
  if (!isWarningContent(section.content)) return '';
  const items = section.content.warnings.map(w => `<li style="margin-bottom:8px;font-size:14px;color:${palette.textSub};">${esc(w)}</li>`).join('');
  return `<section style="width:100%;background:${palette.bg};padding:32px 24px;">
  <h3 style="margin:0 0 16px;font-size:16px;font-weight:700;color:${palette.text};">주의사항</h3>
  <ul style="margin:0;padding-left:20px;">${items}</ul>
</section>`;
}

function renderCta(section: DetailSection, theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette];
  if (!isCtaContent(section.content)) return '';
  const imgUrl = section.attachedImages[0]?.url;
  return `<section style="width:100%;background:${palette.accent};padding:48px 24px;text-align:center;">
  ${imgUrl ? `<img src="${esc(imgUrl)}" alt="" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto 24px;" />` : ''}
  <p style="margin:0;font-size:22px;font-weight:800;color:${palette.bg};line-height:1.4;">${esc(section.content.text)}</p>
</section>`;
}

export function renderSection(section: DetailSection, theme: DetailPageTheme): string {
  const palette = PALETTES[theme.palette]; // eslint-disable-line @typescript-eslint/no-unused-vars
  switch (section.type) {
    case 'hero': return renderHero(section, palette as never, theme);
    case 'selling_points': return renderSellingPoints(section, theme);
    case 'features': return renderFeatures(section, theme);
    case 'stats': return renderStats(section, theme);
    case 'spec_table': return renderSpecTable(section, theme);
    case 'usage_steps': return renderUsageSteps(section, theme);
    case 'warning': return renderWarning(section, theme);
    case 'cta': return renderCta(section, theme);
    default: return '';
  }
}

export function renderAllSections(sections: DetailSection[], theme: DetailPageTheme): string {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const body = sorted.map(s => renderSection(s, theme)).join('\n');
  return `<div class="page-wrapper" style="max-width:780px;margin:0 auto;font-family:'Noto Sans KR',sans-serif;">\n${body}\n</div>`;
}
```

> **주의:** `renderHero` 함수 시그니처의 두 번째 파라미터 타입이 복잡하다. 단순하게 `palette: PaletteColors`로 쓰면 된다. `import type { PaletteColors } from './palette-config'` 추가하고 시그니처를 `renderHero(section: DetailSection, palette: PaletteColors, theme: DetailPageTheme)` 로 수정한다.

실제로 작성할 때는 다음과 같이 단순화한다:

```typescript
import type { PaletteColors } from '@/lib/detail-page/palette-config';

function renderHero(section: DetailSection, palette: PaletteColors, theme: DetailPageTheme): string {
  // ... 위 내용과 동일
}
// 나머지 함수들도 두 번째 파라미터를 palette: PaletteColors 로 통일
// renderSection 내부에서: const palette = PALETTES[theme.palette]; 후 각 함수에 전달
```

- [ ] **Step 3: 타입 체크**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep "section-renderer\|palette-config" | head -20
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json src/lib/detail-page/section-renderer.ts
git commit -m "feat(detail-page): dnd-kit 설치 + section-renderer 추가"
```

---

## Task 3: HTML → DetailSection[] 파서

**Files:**
- Create: `src/lib/detail-page/section-parser.ts`

기존 `DetailPageContent` (headline, subheadline, sellingPoints, features, specs, usageSteps, warnings, ctaText)를 `DetailSection[]`으로 변환하는 파서. 새로 생성된 상세페이지를 로드할 때 사용.

- [ ] **Step 1: `src/lib/detail-page/section-parser.ts` 생성**

```typescript
// src/lib/detail-page/section-parser.ts
import { v4 as uuidv4 } from 'uuid';
import type { DetailSection } from '@/types/detail-page';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';

/**
 * 기존 DetailPageContent (AI 생성 결과)를 DetailSection[] + 기본 theme으로 변환한다.
 * 이미지 URL은 별도로 attachedImages에 주입해야 한다.
 */
export function contentToSections(content: DetailPageContent): DetailSection[] {
  const sections: DetailSection[] = [];
  let order = 0;

  // hero
  sections.push({
    id: uuidv4(),
    type: 'hero',
    order: order++,
    content: { headline: content.headline, subheadline: content.subheadline },
    attachedImages: [],
  });

  // selling_points
  if (content.sellingPoints.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'selling_points',
      order: order++,
      content: { points: content.sellingPoints },
      attachedImages: [],
    });
  }

  // features
  if (content.features.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'features',
      order: order++,
      content: { items: content.features },
      attachedImages: [],
    });
  }

  // spec_table
  if (content.specs.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'spec_table',
      order: order++,
      content: { specs: content.specs },
      attachedImages: [],
    });
  }

  // usage_steps
  if (content.usageSteps.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'usage_steps',
      order: order++,
      content: { steps: content.usageSteps },
      attachedImages: [],
    });
  }

  // warning
  if (content.warnings.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'warning',
      order: order++,
      content: { warnings: content.warnings },
      attachedImages: [],
    });
  }

  // cta
  sections.push({
    id: uuidv4(),
    type: 'cta',
    order: order++,
    content: { text: content.ctaText },
    attachedImages: [],
  });

  return sections;
}

/**
 * 이미지 URL 배열을 sections에 순서대로 주입한다.
 * hero 섹션 → imageUrls[0], features 섹션 → imageUrls[1..N] 순서로 배정.
 */
export function attachImagesToSections(
  sections: DetailSection[],
  imageUrls: string[],
): DetailSection[] {
  let imgIdx = 0;
  return sections.map(section => {
    if (section.type === 'hero' && imageUrls[imgIdx]) {
      const s = { ...section, attachedImages: [{ url: imageUrls[imgIdx], order: 0, processingMode: 'original' as const }] };
      imgIdx++;
      return s;
    }
    if (section.type === 'features') {
      const featureImages = imageUrls.slice(imgIdx, imgIdx + (section.content as { items: unknown[] }).items.length);
      imgIdx += featureImages.length;
      return {
        ...section,
        attachedImages: featureImages.map((url, i) => ({ url, order: i, processingMode: 'original' as const })),
      };
    }
    return section;
  });
}

export { DEFAULT_THEME };
```

- [ ] **Step 2: `uuid` 패키지 설치 (없으면)**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npm list uuid 2>&1 | grep uuid || npm install uuid && npm install -D @types/uuid
```

- [ ] **Step 3: 타입 체크**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep "section-parser" | head -10
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/detail-page/section-parser.ts
git commit -m "feat(detail-page): DetailPageContent → DetailSection[] 변환 파서"
```

---

## Task 4: Zustand store — detailPageSections + detailPageTheme

**Files:**
- Modify: `src/store/useListingStore.ts`

- [ ] **Step 1: `useListingStore.ts`에서 state/actions 추가 위치 파악**

```bash
grep -n "detailPageFullHtml\|detailPageStatus\|setDetailPage\|interface.*State" /Users/seungminlee/projects/smart_seller_studio/src/store/useListingStore.ts | head -20
```

- [ ] **Step 2: State 타입에 필드 추가**

`useListingStore.ts`에서 `detailPageFullHtml: string | null;` 줄 아래에 추가:

```typescript
// 섹션 기반 에디터 상태
detailPageSections: import('@/types/detail-page').DetailSection[];
detailPageTheme: import('@/types/detail-page').DetailPageTheme;
```

- [ ] **Step 3: 초기값 추가**

`detailPageFullHtml: null,` 줄 아래에 추가:

```typescript
detailPageSections: [],
detailPageTheme: {
  palette: 'warm_cream',
  primaryColor: '#F5F0E8',
  accentColor: '#8B6914',
  fontStyle: 'mixed',
  imageLayout: 'fullbleed',
},
```

- [ ] **Step 4: Actions 추가**

store의 actions 영역에 추가 (기존 `editDetailPage` 액션 근처):

```typescript
setDetailPageSections: (sections: import('@/types/detail-page').DetailSection[]) =>
  set({ detailPageSections: sections }),

setDetailPageTheme: (theme: import('@/types/detail-page').DetailPageTheme) =>
  set({ detailPageTheme: theme }),

updateDetailPageSection: (id: string, updates: Partial<import('@/types/detail-page').DetailSection>) =>
  set((state) => ({
    detailPageSections: state.detailPageSections.map(s => s.id === id ? { ...s, ...updates } : s),
  })),

removeDetailPageSection: (id: string) =>
  set((state) => ({
    detailPageSections: state.detailPageSections.filter(s => s.id !== id),
  })),

reorderDetailPageSections: (orderedIds: string[]) =>
  set((state) => ({
    detailPageSections: state.detailPageSections.map(s => ({
      ...s,
      order: orderedIds.indexOf(s.id),
    })),
  })),
```

- [ ] **Step 5: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "useListingStore" | head -10
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/store/useListingStore.ts
git commit -m "feat(detail-page): store에 detailPageSections/Theme 상태 추가"
```

---

## Task 5: /api/detail-page/render 엔드포인트

**Files:**
- Create: `src/app/api/detail-page/render/route.ts`

- [ ] **Step 1: `route.ts` 생성**

```typescript
// src/app/api/detail-page/render/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { renderAllSections } from '@/lib/detail-page/section-renderer';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

const SectionSchema = z.object({
  id: z.string(),
  type: z.enum(['hero','selling_points','features','stats','spec_table','usage_steps','warning','cta']),
  order: z.number(),
  content: z.record(z.unknown()),
  attachedImages: z.array(z.object({
    url: z.string().url(),
    order: z.number(),
    processingMode: z.enum(['original','bg_removed','bg_composed']),
  })),
  aiInstruction: z.string().optional(),
});

const ThemeSchema = z.object({
  palette: z.enum(['warm_cream','cool_white','deep_dark','nature_green','tech_navy']),
  primaryColor: z.string(),
  accentColor: z.string(),
  fontStyle: z.enum(['serif','sans','mixed']),
  imageLayout: z.enum(['fullbleed','composed','split']),
});

const RequestSchema = z.object({
  sections: z.array(SectionSchema).min(1),
  theme: ThemeSchema,
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: '요청 파싱 실패' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '입력값 오류' }, { status: 400 });
  }

  const { sections, theme } = parsed.data;
  const html = renderAllSections(sections as DetailSection[], theme as DetailPageTheme);
  const fullHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;800&family=Noto+Serif+KR:wght@400;700&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;">${html}</body></html>`;
  const withPrivacy = appendPrivacyFooter(fullHtml);
  const snippet = html; // 쿠팡용 스니펫은 div wrapper만

  return NextResponse.json({ success: true, html: withPrivacy, snippet }, { status: 200 });
}
```

- [ ] **Step 2: curl로 동작 확인**

```bash
curl -s -X POST http://localhost:3000/api/detail-page/render \
  -H "Content-Type: application/json" \
  -d '{"sections":[{"id":"1","type":"hero","order":0,"content":{"headline":"테스트","subheadline":"서브"},"attachedImages":[]}],"theme":{"palette":"warm_cream","primaryColor":"#F5F0E8","accentColor":"#8B6914","fontStyle":"mixed","imageLayout":"fullbleed"}}' | grep -o '"success":[a-z]*'
```

Expected: `"success":true` (인증 없이는 401 — 브라우저 세션이 필요)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/detail-page/render/route.ts
git commit -m "feat(detail-page): /api/detail-page/render 엔드포인트 추가"
```

---

## Task 6: SectionCard + ThemeBar 컴포넌트

**Files:**
- Create: `src/components/listing/detail-editor/SectionCard.tsx`
- Create: `src/components/listing/detail-editor/ThemeBar.tsx`
- Create: `src/components/listing/detail-editor/SectionInstructionPanel.tsx`

- [ ] **Step 1: `SectionCard.tsx` 생성**

```tsx
// src/components/listing/detail-editor/SectionCard.tsx
'use client';
import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Sparkles, Trash2, ChevronDown, ChevronUp, Paperclip } from 'lucide-react';
import type { DetailSection } from '@/types/detail-page';
import { C } from '@/lib/design-tokens';
import SectionInstructionPanel from './SectionInstructionPanel';

const SECTION_LABELS: Record<DetailSection['type'], string> = {
  hero: '히어로',
  selling_points: '셀링 포인트',
  features: '특징 상세',
  stats: '통계 수치',
  spec_table: '제품 사양',
  usage_steps: '사용 방법',
  warning: '주의사항',
  cta: '구매 유도',
};

function getSectionPreview(section: DetailSection): string {
  const c = section.content;
  if ('headline' in c) return c.headline;
  if ('points' in c) return (c as { points: Array<{title: string}> }).points.map(p => p.title).join(' · ');
  if ('items' in c) return (c as { items: Array<{title: string}> }).items.map(i => i.title).join(' · ');
  if ('stats' in c) return (c as { stats: Array<{value: string; label: string}> }).stats.map(s => `${s.value} ${s.label}`).join(' / ');
  if ('specs' in c) return `${(c as { specs: Array<{label: string}> }).specs.length}개 항목`;
  if ('steps' in c) return `${(c as { steps: string[] }).steps.length}단계`;
  if ('warnings' in c) return `${(c as { warnings: string[] }).warnings.length}개 주의사항`;
  if ('text' in c) return (c as { text: string }).text;
  return '';
}

interface SectionCardProps {
  section: DetailSection;
  isEditingSection: boolean;
  onEditStart: () => void;
  onEditEnd: () => void;
  onDelete: () => void;
  onSectionUpdate: (updates: Partial<DetailSection>) => void;
  onAiEdit: (instruction: string) => Promise<void>;
  isAiLoading: boolean;
}

export default function SectionCard({
  section,
  isEditingSection,
  onEditStart,
  onEditEnd,
  onDelete,
  onSectionUpdate,
  onAiEdit,
  isAiLoading,
}: SectionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const [showInstruction, setShowInstruction] = useState(false);
  const [showDeleteUndo, setShowDeleteUndo] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleDelete = () => {
    setShowDeleteUndo(true);
    setTimeout(() => {
      setShowDeleteUndo(false);
      onDelete();
    }, 3000);
  };

  return (
    <div ref={setNodeRef} style={{ ...style, backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', marginBottom: '8px', overflow: 'hidden' }}>
      {/* 카드 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: C.tableHeader }}>
        {/* 드래그 핸들 */}
        <div {...attributes} {...listeners} style={{ cursor: 'grab', color: '#aaa', display: 'flex' }}>
          <GripVertical size={16} />
        </div>

        {/* 섹션 타입 레이블 */}
        <span style={{ fontSize: '11px', fontWeight: 700, color: C.accent, background: '#fff0f0', padding: '2px 8px', borderRadius: '4px' }}>
          {SECTION_LABELS[section.type]}
        </span>

        {/* 미리보기 텍스트 */}
        <span style={{ fontSize: '12px', color: C.textSub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {getSectionPreview(section)}
        </span>

        {/* 이미지 첨부 */}
        <button
          onClick={() => {/* TODO Task 9에서 구현 */}}
          title="이미지 첨부"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: section.attachedImages.length > 0 ? C.accent : '#bbb', padding: '2px' }}
        >
          <Paperclip size={14} />
          {section.attachedImages.length > 0 && (
            <span style={{ fontSize: '10px', marginLeft: '2px' }}>{section.attachedImages.length}</span>
          )}
        </button>

        {/* AI 수정 토글 */}
        <button
          onClick={() => setShowInstruction(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: '3px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '5px', color: '#7c3aed', cursor: 'pointer', padding: '3px 8px', fontSize: '11px', fontWeight: 600 }}
        >
          <Sparkles size={11} />
          AI 수정
          {showInstruction ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>

        {/* 삭제 */}
        {showDeleteUndo ? (
          <button onClick={() => setShowDeleteUndo(false)} style={{ fontSize: '11px', color: '#15803d', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '5px', padding: '3px 8px', cursor: 'pointer' }}>
            되돌리기
          </button>
        ) : (
          <button onClick={handleDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: '2px' }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* AI 지시어 패널 */}
      {showInstruction && (
        <SectionInstructionPanel
          sectionType={section.type}
          instruction={section.aiInstruction ?? ''}
          onChange={(val) => onSectionUpdate({ aiInstruction: val })}
          onSubmit={onAiEdit}
          isLoading={isAiLoading}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: `SectionInstructionPanel.tsx` 생성**

```tsx
// src/components/listing/detail-editor/SectionInstructionPanel.tsx
'use client';
import React from 'react';
import { Loader2 } from 'lucide-react';
import type { SectionType } from '@/types/detail-page';
import { C } from '@/lib/design-tokens';

const CHIPS: Record<SectionType, string[]> = {
  hero: ['더 임팩트 있게', '감성적인 톤으로', '심플하게'],
  selling_points: ['포인트 추가', '가성비 강조', '간결하게'],
  features: ['이미지 설명 추가', '더 자세하게', '설명 줄이기'],
  stats: ['수치 강조', '설명 보강'],
  spec_table: ['항목 추가', '단위 통일'],
  usage_steps: ['단계 추가', '더 쉽게 설명'],
  warning: ['항목 추가', '간결하게'],
  cta: ['더 강하게', '감성적으로', '혜택 강조'],
};

interface Props {
  sectionType: SectionType;
  instruction: string;
  onChange: (val: string) => void;
  onSubmit: (instruction: string) => Promise<void>;
  isLoading: boolean;
}

export default function SectionInstructionPanel({ sectionType, instruction, onChange, onSubmit, isLoading }: Props) {
  const chips = CHIPS[sectionType] ?? [];
  return (
    <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.border}`, background: '#faf5ff' }}>
      {/* 칩 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
        {chips.map(chip => (
          <button
            key={chip}
            onClick={() => onChange(chip)}
            style={{
              padding: '3px 10px', fontSize: '11px', fontWeight: 500,
              backgroundColor: instruction === chip ? '#ede9fe' : '#f5f3ff',
              color: '#7c3aed',
              border: `1px solid ${instruction === chip ? '#8b5cf6' : '#ddd6fe'}`,
              borderRadius: '100px', cursor: 'pointer',
            }}
          >
            {chip}
          </button>
        ))}
      </div>
      {/* 텍스트 입력 */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <textarea
          rows={2}
          value={instruction}
          onChange={e => onChange(e.target.value)}
          placeholder="수정 요청을 입력하세요..."
          style={{ flex: 1, fontSize: '12px', padding: '8px 10px', border: `1px solid #ddd6fe`, borderRadius: '6px', resize: 'none', fontFamily: 'inherit' }}
        />
        <button
          onClick={() => onSubmit(instruction)}
          disabled={isLoading || !instruction.trim()}
          style={{ padding: '0 14px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '6px', cursor: isLoading || !instruction.trim() ? 'not-allowed' : 'pointer', opacity: isLoading || !instruction.trim() ? 0.6 : 1, fontSize: '12px', fontWeight: 600 }}
        >
          {isLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'AI 수정'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `ThemeBar.tsx` 생성**

```tsx
// src/components/listing/detail-editor/ThemeBar.tsx
'use client';
import React from 'react';
import type { DetailPageTheme, PaletteName, ImageLayout } from '@/types/detail-page';
import { PALETTES, PALETTE_LABELS } from '@/lib/detail-page/palette-config';
import { C } from '@/lib/design-tokens';

interface Props {
  theme: DetailPageTheme;
  onChange: (theme: DetailPageTheme) => void;
}

const LAYOUT_LABELS: Record<ImageLayout, string> = {
  fullbleed: '풀블리드',
  composed: '배경합성',
  split: '좌우분할',
};

export default function ThemeBar({ theme, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '10px 12px', background: C.tableHeader, borderRadius: '8px', marginBottom: '12px', border: `1px solid ${C.border}` }}>
      {/* 팔레트 선택 */}
      <span style={{ fontSize: '11px', fontWeight: 600, color: C.textSub }}>🎨 팔레트</span>
      <div style={{ display: 'flex', gap: '4px' }}>
        {(Object.keys(PALETTES) as PaletteName[]).map(name => {
          const p = PALETTES[name];
          return (
            <button
              key={name}
              title={PALETTE_LABELS[name]}
              onClick={() => onChange({ ...theme, palette: name, primaryColor: p.bg, accentColor: p.accent })}
              style={{
                width: 24, height: 24, borderRadius: '50%',
                background: p.bg,
                border: theme.palette === name ? `3px solid ${p.accent}` : `2px solid ${p.border}`,
                cursor: 'pointer',
              }}
            />
          );
        })}
      </div>

      {/* 레이아웃 선택 */}
      <span style={{ fontSize: '11px', fontWeight: 600, color: C.textSub, marginLeft: '8px' }}>레이아웃</span>
      <div style={{ display: 'flex', gap: '4px' }}>
        {(['fullbleed', 'composed', 'split'] as ImageLayout[]).map(layout => (
          <button
            key={layout}
            onClick={() => onChange({ ...theme, imageLayout: layout })}
            style={{
              padding: '3px 8px', fontSize: '11px', fontWeight: 500,
              background: theme.imageLayout === layout ? C.accent : C.card,
              color: theme.imageLayout === layout ? '#fff' : C.text,
              border: `1px solid ${theme.imageLayout === layout ? C.accent : C.border}`,
              borderRadius: '4px', cursor: 'pointer',
            }}
          >
            {LAYOUT_LABELS[layout]}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "detail-editor" | head -10
```

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/detail-editor/
git commit -m "feat(detail-page): SectionCard, ThemeBar, SectionInstructionPanel 컴포넌트"
```

---

## Task 7: DetailPageEditor 메인 컴포넌트

**Files:**
- Create: `src/components/listing/detail-editor/DetailPageEditor.tsx`

- [ ] **Step 1: `DetailPageEditor.tsx` 생성**

```tsx
// src/components/listing/detail-editor/DetailPageEditor.tsx
'use client';
import React, { useState, useCallback } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Copy, Download, RefreshCw, CheckCheck } from 'lucide-react';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import { C } from '@/lib/design-tokens';
import SectionCard from './SectionCard';
import ThemeBar from './ThemeBar';

interface Props {
  sections: DetailSection[];
  theme: DetailPageTheme;
  onSectionsChange: (sections: DetailSection[]) => void;
  onThemeChange: (theme: DetailPageTheme) => void;
  onRegenerateAll: () => Promise<void>;
  isRegenerating: boolean;
  /** 최종 HTML (렌더링된 것) — 복사/다운로드용 */
  renderedHtml: string;
  /** 섹션 하나를 AI로 재생성할 때 호출되는 함수 (Task 8에서 구현) */
  onEditSection: (sectionId: string, instruction: string) => Promise<void>;
}

export default function DetailPageEditor({
  sections,
  theme,
  onSectionsChange,
  onThemeChange,
  onRegenerateAll,
  isRegenerating,
  renderedHtml,
  onEditSection,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sections.findIndex(s => s.id === active.id);
    const newIdx = sections.findIndex(s => s.id === over.id);
    const reordered = [...sections];
    const [moved] = reordered.splice(oldIdx, 1);
    reordered.splice(newIdx, 0, moved);
    onSectionsChange(reordered.map((s, i) => ({ ...s, order: i })));
  }, [sections, onSectionsChange]);

  const handleDelete = useCallback((id: string) => {
    onSectionsChange(sections.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i })));
  }, [sections, onSectionsChange]);

  const handleSectionUpdate = useCallback((id: string, updates: Partial<DetailSection>) => {
    onSectionsChange(sections.map(s => s.id === id ? { ...s, ...updates } : s));
  }, [sections, onSectionsChange]);

  const handleAiEdit = useCallback(async (id: string, instruction: string) => {
    setAiLoadingId(id);
    try {
      await onEditSection(id, instruction);
    } finally {
      setAiLoadingId(null);
    }
  }, [onEditSection]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(renderedHtml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [renderedHtml]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([renderedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'detail-page.html';
    a.click();
    URL.revokeObjectURL(url);
  }, [renderedHtml]);

  const sorted = [...sections].sort((a, b) => a.order - b.order);

  return (
    <div>
      {/* 테마 바 */}
      <ThemeBar theme={theme} onChange={onThemeChange} />

      {/* 섹션 리스트 */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sorted.map(s => s.id)} strategy={verticalListSortingStrategy}>
          {sorted.map(section => (
            <SectionCard
              key={section.id}
              section={section}
              isEditingSection={editingId === section.id}
              onEditStart={() => setEditingId(section.id)}
              onEditEnd={() => setEditingId(null)}
              onDelete={() => handleDelete(section.id)}
              onSectionUpdate={(updates) => handleSectionUpdate(section.id, updates)}
              onAiEdit={(instruction) => handleAiEdit(section.id, instruction)}
              isAiLoading={aiLoadingId === section.id}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* 하단 액션 버튼 */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={onRegenerateAll}
          disabled={isRegenerating}
          style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: C.tableHeader, color: C.text, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: isRegenerating ? 'not-allowed' : 'pointer', opacity: isRegenerating ? 0.6 : 1 }}
        >
          <RefreshCw size={12} style={isRegenerating ? { animation: 'spin 1s linear infinite' } : {}} />
          전체 재생성
        </button>
        <button
          onClick={handleCopy}
          style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'pointer' }}
        >
          {copied ? <><CheckCheck size={12} color="#15803d" />복사됨</> : <><Copy size={12} />HTML 복사</>}
        </button>
        <button
          onClick={handleDownload}
          style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: C.text, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          <Download size={12} />다운로드
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "DetailPageEditor" | head -10
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/detail-editor/DetailPageEditor.tsx
git commit -m "feat(detail-page): DetailPageEditor 메인 컴포넌트 (dnd-kit 드래그 포함)"
```

---

## Task 8: /api/detail-page/edit-section 엔드포인트

**Files:**
- Create: `src/app/api/detail-page/edit-section/route.ts`

- [ ] **Step 1: `route.ts` 생성**

```typescript
// src/app/api/detail-page/edit-section/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getAnthropicClient } from '@/lib/ai/claude';
import { withRetry } from '@/lib/ai/resilience';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import type { DetailSection, SectionType } from '@/types/detail-page';

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };

const SECTION_PROMPTS: Record<SectionType, string> = {
  hero: '히어로 섹션의 headline(20자 이내)과 subheadline(40자 이내)을 수정합니다. JSON: {"headline":"...","subheadline":"..."}',
  selling_points: '셀링포인트 배열을 수정합니다. JSON: {"points":[{"icon":"이모지","title":"...","description":"..."},...]}',
  features: '특징 상세 배열을 수정합니다. JSON: {"items":[{"title":"...","description":"..."},...]}',
  stats: '통계 수치 배열을 수정합니다. JSON: {"stats":[{"value":"92%","label":"먼지 포집률"},...]}',
  spec_table: '사양 테이블을 수정합니다. JSON: {"specs":[{"label":"...","value":"..."},...]}',
  usage_steps: '사용법 단계 배열을 수정합니다. JSON: {"steps":["단계1","단계2",...]}',
  warning: '주의사항 배열을 수정합니다. JSON: {"warnings":["주의1","주의2",...]}',
  cta: '구매 유도 문구를 수정합니다. JSON: {"text":"..."}',
};

const RequestSchema = z.object({
  section: z.object({
    id: z.string(),
    type: z.enum(['hero','selling_points','features','stats','spec_table','usage_steps','warning','cta']),
    order: z.number(),
    content: z.record(z.unknown()),
    attachedImages: z.array(z.object({ url: z.string(), order: z.number(), processingMode: z.string() })),
    aiInstruction: z.string().optional(),
  }),
  instruction: z.string().min(1).max(500),
  productContext: z.string().optional(), // 상품명 등 컨텍스트
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'edit-section'), RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ success: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: '요청 파싱 실패' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '입력값 오류' }, { status: 400 });
  }

  const { section, instruction, productContext } = parsed.data;
  const sectionType = section.type as SectionType;

  const systemPrompt =
    '당신은 한국 이커머스 상세페이지 카피라이터입니다. ' +
    '제공된 섹션 JSON 데이터를 사용자 지시에 따라 수정하고, 수정된 섹션 content JSON만 출력합니다. ' +
    '코드 블록, 마크다운, 설명 텍스트 금지. JSON만 출력. ' +
    '과대광고(최초, 1위, 유일, 혁명적) 사용 금지. 쿠팡 광고 정책 준수.';

  const userPrompt =
    `${SECTION_PROMPTS[sectionType]}\n\n` +
    `현재 섹션 내용:\n${JSON.stringify(section.content, null, 2)}\n\n` +
    `수정 지시: ${instruction}\n` +
    (productContext ? `상품 컨텍스트: ${productContext}\n` : '') +
    '위 지시에 따라 섹션 content를 수정한 JSON을 출력하세요.';

  let responseText: string;
  try {
    const client = getAnthropicClient();
    const resp = await withRetry(
      () => client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      { label: 'Claude edit-section' },
    );
    responseText = resp.content.filter(b => b.type === 'text').map(b => (b as {text: string}).text).join('');
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '섹션 수정 실패' }, { status: 502 });
  }

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return NextResponse.json({ success: false, error: 'AI 응답에서 JSON을 찾을 수 없습니다.' }, { status: 502 });

  let newContent: unknown;
  try { newContent = JSON.parse(jsonMatch[0]); } catch {
    return NextResponse.json({ success: false, error: 'JSON 파싱 실패' }, { status: 502 });
  }

  const updatedSection: DetailSection = { ...(section as DetailSection), content: newContent as DetailSection['content'] };
  return NextResponse.json({ success: true, section: updatedSection }, { status: 200 });
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/detail-page/edit-section/route.ts
git commit -m "feat(detail-page): /api/detail-page/edit-section 엔드포인트"
```

---

## Task 9: Step3ReviewRegister에 DetailPageEditor 통합

**Files:**
- Modify: `src/components/listing/workflow/Step3ReviewRegister.tsx`

기존 "AI로 상세페이지 수정" 패널과 iframe 미리보기를 `DetailPageEditor`로 교체한다.

- [ ] **Step 1: Step3ReviewRegister.tsx 상단 import 교체**

파일 상단에 추가:
```typescript
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import { contentToSections, attachImagesToSections } from '@/lib/detail-page/section-parser';
import { renderAllSections } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';
```

- [ ] **Step 2: 컴포넌트 내부 state 추가**

`Step3ReviewRegister` 함수 내부에 추가:
```typescript
const {
  detailPageSections,
  detailPageTheme,
  setDetailPageSections,
  setDetailPageTheme,
  updateDetailPageSection,
} = useListingStore();

// sections가 비어있고 HTML이 있으면 파싱해서 초기화
React.useEffect(() => {
  if (detailPageSections.length === 0 && sharedDraft.detailPageContent) {
    const parsed = contentToSections(sharedDraft.detailPageContent);
    const withImages = attachImagesToSections(
      parsed,
      (sharedDraft.pickedImageUrls ?? []).filter(Boolean) as string[],
    );
    setDetailPageSections(withImages);
    setDetailPageTheme(DEFAULT_THEME);
  }
}, [sharedDraft.detailPageContent]);

// sections 변경 시 HTML 재렌더링
const [renderedHtml, setRenderedHtml] = React.useState(detailPageFullHtml ?? '');
const renderSections = React.useCallback(async () => {
  if (detailPageSections.length === 0) return;
  try {
    const res = await fetch('/api/detail-page/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections: detailPageSections, theme: detailPageTheme }),
    });
    const data = await res.json() as { success: boolean; html?: string };
    if (data.success && data.html) setRenderedHtml(data.html);
  } catch { /* silent */ }
}, [detailPageSections, detailPageTheme]);

React.useEffect(() => { renderSections(); }, [detailPageSections, detailPageTheme]);

const handleEditSection = React.useCallback(async (sectionId: string, instruction: string) => {
  const section = detailPageSections.find(s => s.id === sectionId);
  if (!section) return;
  const res = await fetch('/api/detail-page/edit-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, instruction, productContext: sharedDraft.productName }),
  });
  const data = await res.json() as { success: boolean; section?: DetailSection };
  if (data.success && data.section) {
    updateDetailPageSection(sectionId, data.section);
  }
}, [detailPageSections, sharedDraft.productName]);
```

- [ ] **Step 3: 기존 미리보기 iframe + AI 수정 패널을 DetailPageEditor로 교체**

기존 코드에서 `{/* AI 생성 상세페이지 미리보기 */}` 블록 (line ~394)부터 `{/* AI 수정 패널 */}` 블록 끝까지 제거하고 다음으로 교체:

```tsx
{/* 상세페이지 에디터 */}
{detailPageSections.length > 0 ? (
  <DetailPageEditor
    sections={detailPageSections}
    theme={detailPageTheme}
    onSectionsChange={setDetailPageSections}
    onThemeChange={setDetailPageTheme}
    onRegenerateAll={async () => { await generateDetailPageFromPicked(); }}
    isRegenerating={detailPageStatus === 'generating'}
    renderedHtml={renderedHtml}
    onEditSection={handleEditSection}
  />
) : hasHtml ? (
  // fallback: sections 파싱 전 또는 실패 시 기존 iframe
  <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
    <div style={{ padding: '11px 14px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.tableHeader }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: C.text }}>상세페이지 미리보기</span>
    </div>
    <iframe srcDoc={detailPageFullHtml!} title="상세 페이지 미리보기" style={{ width: '100%', height: '480px', border: 'none', display: 'block' }} sandbox="allow-same-origin" />
  </div>
) : null}
```

- [ ] **Step 4: 개발 서버에서 동작 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npm run dev
```

브라우저에서 http://localhost:3000/listing → 임시저장 불러오기 → Step 3에서:
- [ ] 섹션 카드가 표시되는지 확인
- [ ] 드래그로 섹션 순서 변경 가능한지 확인
- [ ] "AI 수정" 버튼 클릭 시 지시어 패널 펼침 확인
- [ ] 테마 바 팔레트 변경 시 미리보기 색상 변경 확인

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/workflow/Step3ReviewRegister.tsx
git commit -m "feat(detail-page): Step3ReviewRegister에 DetailPageEditor 통합"
```

---

## Task 10: AssetsResultPanel에 DetailPageEditor 통합

**Files:**
- Modify: `src/components/listing/assets/AssetsResultPanel.tsx`

Step 9와 동일한 방식으로 AssetsResultPanel의 AI 수정 패널을 교체한다.

- [ ] **Step 1: AssetsResultPanel.tsx 수정**

파일 상단 import에 추가:
```typescript
import DetailPageEditor from '@/components/listing/detail-editor/DetailPageEditor';
import { contentToSections, attachImagesToSections } from '@/lib/detail-page/section-parser';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';
```

컴포넌트 내부에 state 추가:
```typescript
const [sections, setSections] = React.useState<DetailSection[]>([]);
const [editorTheme, setEditorTheme] = React.useState<DetailPageTheme>(DEFAULT_THEME);
const [renderedHtml, setRenderedHtml] = React.useState(generatedDetailHtml);
const [isRegenerating, setIsRegenerating] = React.useState(false);

// generatedDetailHtml이 생기면 섹션으로 파싱
// AssetsTab에서 assetsDraft.detailPageContent (DetailPageContent 타입)를 저장해야 함
// 현재는 HTML만 있으므로 일단 기존 iframe fallback 사용
```

> **참고:** AssetsTab은 현재 상세페이지를 `generatedDetailHtml` (HTML string)만 저장하며 `DetailPageContent` 구조체는 저장하지 않는다. Task 10에서는 `AssetsTab.tsx`의 `generateDetailHtml` 함수가 `DetailPageContent`도 함께 반환하도록 `/api/ai/generate-detail-html` 응답에 `content` 필드를 추가하는 작업이 선행되어야 한다. 이 선행 작업을 Task 10의 Step 1에서 먼저 처리한다.

- [ ] **Step 2: generate-detail-html API 응답에 content 필드 추가**

`src/app/api/ai/generate-detail-html/route.ts`에서 응답 부분 수정:

```typescript
// 기존
return NextResponse.json({
  success: true,
  html: appendPrivacyFooter(html),
  snippet: appendPrivacyFooter(snippet),
  naverSnippet: appendPrivacyFooter(naverSnippet),
}, { status: 200 });

// 변경 후
return NextResponse.json({
  success: true,
  html: appendPrivacyFooter(html),
  snippet: appendPrivacyFooter(snippet),
  naverSnippet: appendPrivacyFooter(naverSnippet),
  content,  // DetailPageContent — 섹션 에디터 초기화용
}, { status: 200 });
```

- [ ] **Step 3: AssetsTab.tsx에서 content 저장**

`AssetsTab.tsx`의 `generateDetailHtml` 함수에서 응답을 받은 뒤:
```typescript
const data = (await res.json()) as { html?: string; content?: DetailPageContent; error?: string };
// assetsDraft에 detailPageContent 저장
updateAssetsDraft({ generatedDetailHtml: data.html ?? '', detailPageContent: data.content ?? null });
```

`useListingStore.ts`의 `AssetsDraft` 타입에 `detailPageContent: import('@/lib/ai/prompts/detail-page').DetailPageContent | null` 필드 추가 및 초기값 `null` 설정.

- [ ] **Step 4: AssetsResultPanel에서 DetailPageEditor 사용**

기존 `generatedDetailHtml`이 있는 섹션에서 AI 수정 패널을 DetailPageEditor로 교체한다. Step 9와 동일한 패턴.

```tsx
{assetsDraft.detailPageContent && sections.length > 0 ? (
  <DetailPageEditor
    sections={sections}
    theme={editorTheme}
    onSectionsChange={setSections}
    onThemeChange={setEditorTheme}
    onRegenerateAll={async () => { setIsRegenerating(true); /* ... */ setIsRegenerating(false); }}
    isRegenerating={isRegenerating}
    renderedHtml={renderedHtml}
    onEditSection={handleEditSection}
  />
) : (
  // fallback iframe
  <iframe srcDoc={generatedDetailHtml} title="상세페이지 미리보기" style={{ width: '100%', height: '480px', border: 'none', display: 'block' }} sandbox="allow-same-origin" />
)}
```

- [ ] **Step 5: 브라우저에서 확인**

http://localhost:3000/listing?tab=assets → URL 입력 → 자산 생성 후:
- [ ] 섹션 카드 표시 확인
- [ ] 팔레트 변경 동작 확인

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/assets/ src/app/api/ai/generate-detail-html/route.ts src/store/useListingStore.ts
git commit -m "feat(detail-page): AssetsResultPanel에 DetailPageEditor 통합"
```

---

## Task 11: /api/detail-page/analyze-product (제품 분석 → 테마 추천)

**Files:**
- Create: `src/app/api/detail-page/analyze-product/route.ts`

- [ ] **Step 1: `route.ts` 생성**

```typescript
// src/app/api/detail-page/analyze-product/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getAnthropicClient } from '@/lib/ai/claude';
import { withRetry } from '@/lib/ai/resilience';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import type { PaletteName, ImageLayout } from '@/types/detail-page';

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

const RequestSchema = z.object({
  imageUrls: z.array(z.string().url()).max(3).optional(),
  productName: z.string().max(100).optional(),
  categoryCode: z.string().optional(),
});

const ANALYSIS_PROMPT = `당신은 한국 이커머스 상세페이지 디자인 전문가입니다.
제공된 상품 이미지와 정보를 분석하여 최적의 디자인 테마를 추천하세요.
아래 JSON만 출력하세요. 코드 블록, 마크다운, 설명 텍스트 금지.

{
  "recommendedPalette": "warm_cream|cool_white|deep_dark|nature_green|tech_navy",
  "recommendedLayout": "fullbleed|composed|split",
  "recommendedFontStyle": "serif|sans|mixed",
  "accentColor": "#RRGGBB (제품 주요 색상에서 추출)",
  "suggestedSections": ["hero","selling_points","stats","features","spec_table","cta"],
  "reasoning": "한국어로 2문장 추천 이유"
}

팔레트 선택 기준:
- warm_cream: 뷰티/생활용품/식품 (따뜻하고 자연스러운 느낌)
- cool_white: 패션/의류/액세서리 (깔끔하고 모던한 느낌)  
- deep_dark: 전자제품/가전/프리미엄 (고급스럽고 강렬한 느낌)
- nature_green: 건강/아웃도어/유기농 (자연친화적인 느낌)
- tech_navy: IT기기/스포츠/남성용품 (테크니컬하고 전문적인 느낌)`;

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'analyze-product'), RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ success: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: '요청 파싱 실패' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '입력값 오류' }, { status: 400 });

  const { imageUrls, productName, categoryCode } = parsed.data;

  // 이미지 다운로드 (있을 경우)
  const imageBlocks: Array<{ type: 'image'; source: { type: 'url'; url: string } }> = (imageUrls ?? []).slice(0, 2).map(url => ({
    type: 'image',
    source: { type: 'url', url },
  }));

  const userContent = [
    ...imageBlocks,
    {
      type: 'text' as const,
      text: `상품명: ${productName ?? '미제공'}\n카테고리 코드: ${categoryCode ?? '미제공'}\n\n위 상품에 최적화된 디자인 테마를 추천해주세요.`,
    },
  ];

  let responseText: string;
  try {
    const client = getAnthropicClient();
    const resp = await withRetry(
      () => client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: ANALYSIS_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
      { label: 'Claude analyze-product' },
    );
    responseText = resp.content.filter(b => b.type === 'text').map(b => (b as {text:string}).text).join('');
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '분석 실패' }, { status: 502 });
  }

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return NextResponse.json({ success: false, error: 'AI 응답 파싱 실패' }, { status: 502 });

  let result: unknown;
  try { result = JSON.parse(jsonMatch[0]); } catch {
    return NextResponse.json({ success: false, error: 'JSON 파싱 실패' }, { status: 502 });
  }

  const r = result as Record<string, unknown>;
  return NextResponse.json({
    success: true,
    recommendedPalette: (r.recommendedPalette ?? 'warm_cream') as PaletteName,
    recommendedLayout: (r.recommendedLayout ?? 'fullbleed') as ImageLayout,
    recommendedFontStyle: (r.recommendedFontStyle ?? 'mixed') as string,
    accentColor: (r.accentColor ?? '#8B6914') as string,
    suggestedSections: (r.suggestedSections ?? ['hero','selling_points','features','cta']) as string[],
    reasoning: (r.reasoning ?? '') as string,
  }, { status: 200 });
}
```

- [ ] **Step 2: ThemeBar에 "AI 추천" 버튼 연결**

`ThemeBar.tsx`에 props 추가:
```typescript
interface Props {
  theme: DetailPageTheme;
  onChange: (theme: DetailPageTheme) => void;
  onAnalyze?: () => Promise<void>;  // 추가
  isAnalyzing?: boolean;            // 추가
}
```

ThemeBar UI에 버튼 추가:
```tsx
{onAnalyze && (
  <button
    onClick={onAnalyze}
    disabled={isAnalyzing}
    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: '5px', cursor: 'pointer' }}
  >
    <Sparkles size={11} />{isAnalyzing ? '분석 중...' : 'AI 추천'}
  </button>
)}
```

`DetailPageEditor.tsx` props에 `onAnalyze`와 `isAnalyzing` 추가하여 ThemeBar로 전달.

Step3ReviewRegister에서 `onAnalyze` 구현:
```typescript
const handleAnalyze = async () => {
  const res = await fetch('/api/detail-page/analyze-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrls: (sharedDraft.pickedImageUrls ?? []).slice(0, 2),
      productName: sharedDraft.productName,
      categoryCode: sharedDraft.categoryCode,
    }),
  });
  const data = await res.json() as { success: boolean; recommendedPalette?: string; recommendedLayout?: string; accentColor?: string };
  if (data.success) {
    setDetailPageTheme(prev => ({
      ...prev,
      palette: (data.recommendedPalette ?? prev.palette) as DetailPageTheme['palette'],
      imageLayout: (data.recommendedLayout ?? prev.imageLayout) as DetailPageTheme['imageLayout'],
      accentColor: data.accentColor ?? prev.accentColor,
    }));
  }
};
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/detail-page/analyze-product/ src/components/listing/detail-editor/ThemeBar.tsx src/components/listing/detail-editor/DetailPageEditor.tsx src/components/listing/workflow/Step3ReviewRegister.tsx
git commit -m "feat(detail-page): 제품 분석 API + ThemeBar AI 추천 버튼"
```

---

## Task 12: /api/detail-page/process-image (배경제거 + 합성)

**Files:**
- Create: `src/app/api/detail-page/process-image/route.ts`

> **참고:** remove.bg API 키가 필요하다. 환경변수 `REMOVE_BG_API_KEY`를 `.env.local`에 추가해야 한다. API 키 없이는 `bg_removed` 모드 호출 시 501 응답을 반환한다.

- [ ] **Step 1: `route.ts` 생성**

```typescript
// src/app/api/detail-page/process-image/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { uploadToStorage } from '@/lib/supabase/server';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import type { PaletteName } from '@/types/detail-page';
import { PALETTES } from '@/lib/detail-page/palette-config';

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

const RequestSchema = z.object({
  imageUrl: z.string().url(),
  mode: z.enum(['original', 'bg_removed', 'bg_composed']),
  palette: z.enum(['warm_cream','cool_white','deep_dark','nature_green','tech_navy']).optional(),
  outputSize: z.object({ width: z.number().int().max(2000), height: z.number().int().max(2000) }).optional(),
});

async function removeBackground(imageBuffer: Buffer): Promise<Buffer> {
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) throw new Error('REMOVE_BG_API_KEY 환경변수가 설정되지 않았습니다.');

  const formData = new FormData();
  formData.append('image_file', new Blob([imageBuffer], { type: 'image/png' }), 'image.png');
  formData.append('size', 'auto');

  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`remove.bg API 오류: ${res.status} ${err.slice(0, 100)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function composeBackground(fgBuffer: Buffer, palette: PaletteName, size: { width: number; height: number }): Promise<Buffer> {
  const colors = PALETTES[palette];
  // 배경: palette.bg 색상의 단색 배경
  const bgHex = colors.bg.replace('#', '');
  const r = parseInt(bgHex.slice(0, 2), 16);
  const g = parseInt(bgHex.slice(2, 4), 16);
  const b = parseInt(bgHex.slice(4, 6), 16);

  const bg = await sharp({
    create: { width: size.width, height: size.height, channels: 3, background: { r, g, b } },
  }).png().toBuffer();

  // 전경 이미지를 85% 크기로 중앙 배치
  const fgMeta = await sharp(fgBuffer).metadata();
  const fgW = fgMeta.width ?? size.width;
  const fgH = fgMeta.height ?? size.height;
  const scale = Math.min((size.width * 0.85) / fgW, (size.height * 0.85) / fgH);
  const newW = Math.round(fgW * scale);
  const newH = Math.round(fgH * scale);
  const left = Math.round((size.width - newW) / 2);
  const top = Math.round((size.height - newH) / 2);

  const resizedFg = await sharp(fgBuffer).resize(newW, newH).png().toBuffer();

  return sharp(bg)
    .composite([{ input: resizedFg, left, top }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'process-image'), RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ success: false, error: '요청이 너무 많습니다.' }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: '요청 파싱 실패' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '입력값 오류' }, { status: 400 });

  const { imageUrl, mode, palette, outputSize } = parsed.data;
  const size = outputSize ?? { width: 780, height: 780 };

  if (mode === 'original') {
    return NextResponse.json({ success: true, processedUrl: imageUrl }, { status: 200 });
  }

  if (!process.env.REMOVE_BG_API_KEY) {
    return NextResponse.json({ success: false, error: 'remove.bg API 키가 설정되지 않았습니다. REMOVE_BG_API_KEY 환경변수를 추가하세요.' }, { status: 501 });
  }

  // 원본 이미지 다운로드
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return NextResponse.json({ success: false, error: '이미지 다운로드 실패' }, { status: 502 });
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

  let resultBuffer: Buffer;
  try {
    const noBgBuffer = await removeBackground(imgBuffer);
    if (mode === 'bg_removed') {
      resultBuffer = noBgBuffer;
    } else {
      // bg_composed
      resultBuffer = await composeBackground(noBgBuffer, (palette ?? 'warm_cream') as PaletteName, size);
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '이미지 처리 실패' }, { status: 502 });
  }

  const ext = mode === 'bg_removed' ? 'png' : 'jpg';
  const mimeType = mode === 'bg_removed' ? 'image/png' : 'image/jpeg';
  const path = `detail-pages/processed-${Date.now()}.${ext}`;
  const ab = resultBuffer.buffer.slice(resultBuffer.byteOffset, resultBuffer.byteOffset + resultBuffer.byteLength) as ArrayBuffer;
  const { url } = await uploadToStorage(path, ab, mimeType, resultBuffer.byteLength);

  return NextResponse.json({ success: true, processedUrl: url }, { status: 200 });
}
```

- [ ] **Step 2: SectionCard에 이미지 첨부 UI 연결**

`SectionCard.tsx`의 Paperclip 버튼 onClick에 파일 입력 로직 추가:

```typescript
const fileInputRef = React.useRef<HTMLInputElement>(null);
const [isProcessing, setIsProcessing] = React.useState(false);

const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setIsProcessing(true);
  try {
    // 1. 파일을 FormData로 업로드 (기존 upload-image API 활용)
    const fd = new FormData();
    fd.append('file', file);
    const uploadRes = await fetch('/api/upload-image', { method: 'POST', body: fd });
    const uploadData = await uploadRes.json() as { url?: string };
    if (!uploadData.url) throw new Error('업로드 실패');

    // 2. 섹션에 이미지 추가
    onSectionUpdate({
      attachedImages: [
        ...section.attachedImages,
        { url: uploadData.url, order: section.attachedImages.length, processingMode: 'original' },
      ],
    });
  } finally {
    setIsProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
};
```

> **참고:** `/api/upload-image` 엔드포인트가 없으면 기존 Supabase Storage 업로드 방식(base64 변환 후 전송)으로 대체한다. 기존 `AssetsTab.tsx`의 파일 업로드 패턴을 참고한다.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/detail-page/process-image/ src/components/listing/detail-editor/SectionCard.tsx
git commit -m "feat(detail-page): process-image API (배경제거/합성) + 섹션 이미지 첨부 UI"
```

---

## 셀프 리뷰

**스펙 커버리지 체크:**

| 스펙 요구사항 | 담당 태스크 |
|-------------|-----------|
| 섹션별 카드 리스트 + 드래그 순서 변경 | Task 6, 7 |
| 섹션별 AI 지시어 입력창 | Task 6, 8 |
| 섹션별 이미지 첨부 | Task 12 |
| 테마 팔레트/레이아웃 선택 | Task 6 (ThemeBar) |
| AI 테마 추천 (제품 분석) | Task 11 |
| /api/detail-page/render | Task 5 |
| /api/detail-page/edit-section | Task 8 |
| /api/detail-page/analyze-product | Task 11 |
| /api/detail-page/process-image | Task 12 |
| Step3ReviewRegister 통합 | Task 9 |
| AssetsResultPanel 통합 | Task 10 |
| DetailPageEditor 공통 컴포넌트 | Task 7 |
| 팔레트별 WCAG AA 대비 준수 | Task 1, 2 (palette-config의 색상값) |
| 개인정보 고지 이미지 고정 | Task 5 (render API에서 appendPrivacyFooter) |
| 쿠팡 금지어 필터 유지 | Task 8 (edit-section 시스템 프롬프트) |
| 인라인 스타일만 사용 | Task 2 (section-renderer 전체) |

**플레이스홀더 스캔:** 없음.

**타입 일관성:**
- `DetailSection.content` 타입은 `SectionContent` union — 모든 태스크에서 동일하게 사용
- `DetailPageTheme.palette`는 `PaletteName` — Task 1에서 정의, 이후 동일하게 사용
- `renderSection` / `renderAllSections` — Task 2에서 정의, Task 5 API에서 사용
- `contentToSections` — Task 3에서 정의, Task 9/10에서 사용
